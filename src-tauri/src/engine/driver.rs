//! The task that consumes one graphrt event stream (a start or a resume).
//!
//! For every event other than `node_chunk`: store the chunk still buffered (so
//! it precedes this event), persist the event, apply the status change a
//! terminal event implies, send it to the UI, then send `status_changed` if the
//! status moved. A `node_chunk` is sent to the UI at once but stored through
//! the [`ChunkBuffer`]; the task also wakes up at the buffer's deadline while
//! the stream is quiet. See [`super::RunEventPayload`] for the seq live chunks carry.
//!
//! The task unregisters from `active_runs` only after a terminal event and its
//! status are stored; see [`super::RunManager::abort_run`] for why.
//!
//! Storage errors are logged, never fatal: the task always tries to leave the
//! run `Paused` or terminal in the database.

use std::sync::Arc;

use futures::StreamExt;
use graphrt_core::{Event, RunStream};
use serde_json::{json, Value as Json};
use tokio::time::Instant;

use super::chunk_buffer::{ChunkBuffer, ChunkBufferLimits, ChunkPosition};
use super::{ActiveRuns, RunEventPayload, RunEventSink};
use crate::storage::models::{AgentStatus, RunStatus, RunTrigger};
use crate::storage::Database;

/// Recorded when graphrt ends a stream without a terminal event (should not happen).
const MISSING_TERMINAL_EVENT_MESSAGE: &str = "The run stopped without reporting a result";

/// Everything a driver task needs; cheap to clone from the `RunManager`.
#[derive(Debug, Clone)]
pub(super) struct RunDriver {
    pub(super) db: Arc<Database>,
    pub(super) sink: Arc<dyn RunEventSink>,
    pub(super) active_runs: Arc<ActiveRuns>,
    pub(super) agent_id: String,
    pub(super) trigger: RunTrigger,
    pub(super) chunk_buffer_limits: ChunkBufferLimits,
}

/// State of one drive (one graphrt stream).
#[derive(Debug)]
struct DriveState {
    run_id: String,
    /// This task's entry in `active_runs`.
    drive_id: u64,
    /// Seq of the latest event this task stored (0 before the first). graphrt
    /// emits `run_started` first, so it is set before any chunk needs it.
    last_seq: i64,
    chunk_buffer: ChunkBuffer,
    reached_terminal_event: bool,
}

/// What the task does next.
enum NextStep {
    Handle(Box<Event>),
    StoreDueChunk,
    StreamEnded,
}

/// Waits for the next event, or for the buffered chunk's deadline if there is one.
async fn next_step(stream: &mut RunStream, chunk_deadline: Option<Instant>) -> NextStep {
    let into_step =
        |event: Option<Event>| event.map_or(NextStep::StreamEnded, |event| NextStep::Handle(Box::new(event)));
    let Some(chunk_deadline) = chunk_deadline else {
        return into_step(stream.next().await);
    };
    tokio::select! {
        event = stream.next() => into_step(event),
        () = tokio::time::sleep_until(chunk_deadline) => NextStep::StoreDueChunk,
    }
}

impl RunDriver {
    /// Drives `stream` to its end. `drive_id` is this task's entry in `active_runs`.
    pub(super) async fn drive(self, run_id: String, drive_id: u64, mut stream: RunStream) {
        let mut state = DriveState {
            run_id,
            drive_id,
            last_seq: 0,
            chunk_buffer: ChunkBuffer::new(self.chunk_buffer_limits),
            reached_terminal_event: false,
        };
        loop {
            match next_step(&mut stream, state.chunk_buffer.deadline()).await {
                NextStep::Handle(event) => self.handle_event(&mut state, *event),
                NextStep::StoreDueChunk => {
                    let due_chunks = state.chunk_buffer.take_due(Instant::now());
                    self.store_events(&mut state, &due_chunks);
                }
                NextStep::StreamEnded => break,
            }
        }
        self.store_buffered_chunks(&mut state);
        self.active_runs.remove(&state.run_id, drive_id);
        if !state.reached_terminal_event {
            self.fail_run(&state.run_id, MISSING_TERMINAL_EVENT_MESSAGE);
        }
    }

    fn handle_event(&self, state: &mut DriveState, event: Event) {
        if matches!(event, Event::NodeChunk { .. }) {
            self.handle_chunk(state, &event);
            return;
        }
        self.store_buffered_chunks(state);
        let is_terminal = event.is_terminal();
        let event_json = event_to_json(&event);
        self.store_event(state, &event_json);
        let new_status = self.apply_terminal_event(&state.run_id, event);
        let status = new_status.unwrap_or(RunStatus::Running);
        self.sink.send(self.payload(&state.run_id, state.last_seq, status, event_json));
        if let Some(status) = new_status {
            self.send_status_with_seq(&state.run_id, state.last_seq, status);
        }
        if is_terminal {
            state.reached_terminal_event = true;
            self.unregister_after_terminal_event(state, new_status);
        }
    }

    /// Sends the chunk live and buffers it for storage. The live payload carries
    /// the seq of the row that holds (or will hold) the chunk's text.
    fn handle_chunk(&self, state: &mut DriveState, event: &Event) {
        let event_json = event_to_json(event);
        let Some(pushed) = state.chunk_buffer.push(event, event_json.clone(), Instant::now()) else {
            return;
        };
        let stored_seqs = self.store_events(state, &pushed.ready);
        let chunk_seq = match pushed.position {
            ChunkPosition::Ready(index) => stored_seqs.get(index).copied().flatten().unwrap_or(state.last_seq),
            ChunkPosition::Pending(rows_ahead) => state.last_seq + 1 + i64::try_from(rows_ahead).unwrap_or(0),
        };
        self.sink.send(self.payload(&state.run_id, chunk_seq, RunStatus::Running, event_json));
    }

    /// Unregisters once the terminal event and its status are stored. An abort
    /// requested meanwhile only overrides a pause; a graphrt success or failure wins.
    fn unregister_after_terminal_event(&self, state: &DriveState, new_status: Option<RunStatus>) {
        let abort_requested = self.active_runs.remove(&state.run_id, state.drive_id);
        if abort_requested && new_status == Some(RunStatus::Paused) {
            if let Some(status) = self.finish(&state.run_id, RunStatus::Aborted, None, None) {
                self.send_status_with_seq(&state.run_id, state.last_seq, status);
            }
        }
    }

    fn store_buffered_chunks(&self, state: &mut DriveState) {
        let buffered_chunks = state.chunk_buffer.take_all();
        self.store_events(state, &buffered_chunks);
    }

    /// Persists the events in order; returns each one's seq (`None` when storage failed).
    fn store_events(&self, state: &mut DriveState, events_json: &[Json]) -> Vec<Option<i64>> {
        events_json.iter().map(|event_json| self.store_event(state, event_json)).collect()
    }

    /// Persists the event and advances `last_seq` (unchanged when storage failed).
    fn store_event(&self, state: &mut DriveState, event_json: &Json) -> Option<i64> {
        let seq = self.persist_event(&state.run_id, event_json);
        state.last_seq = seq.unwrap_or(state.last_seq);
        seq
    }

    /// Appends the event; returns its seq, or `None` (logged) when storage failed.
    fn persist_event(&self, run_id: &str, event_json: &Json) -> Option<i64> {
        match self.db.append_run_event(run_id, event_json) {
            Ok(seq) => Some(seq),
            Err(error) => {
                log::warn!("could not store an event of run {run_id}: {error}");
                None
            }
        }
    }

    /// Records the status a terminal event implies. Returns the new status, or
    /// `None` for non-terminal events and when the database refused the change
    /// (e.g. the run was already aborted).
    fn apply_terminal_event(&self, run_id: &str, event: Event) -> Option<RunStatus> {
        match event {
            Event::RunPaused { reasons, snapshot } => self.record_pause(run_id, &reasons, &snapshot),
            Event::RunSucceeded { outputs, .. } => {
                let outputs_json = serde_json::to_value(&outputs).unwrap_or_else(|_| json!({}));
                let status = self.finish(run_id, RunStatus::Succeeded, Some(&outputs_json), None)?;
                self.mark_agent_tested();
                Some(status)
            }
            Event::RunFailed { error, .. } => self.finish(run_id, RunStatus::Failed, None, Some(&error)),
            Event::RunAborted { .. } => self.finish(run_id, RunStatus::Aborted, None, None),
            _ => None,
        }
    }

    /// Stores the snapshot; a snapshot that cannot be stored fails the run instead,
    /// since a paused run without a snapshot could never be resumed.
    fn record_pause(
        &self,
        run_id: &str,
        reasons: &[graphrt_core::event::PauseReason],
        snapshot: &graphrt_core::Snapshot,
    ) -> Option<RunStatus> {
        let stored = snapshot.to_json().map_err(crate::error::AppError::from).and_then(|snapshot_json| {
            let reasons_json = serde_json::to_value(reasons)?;
            self.db.mark_run_paused(run_id, &snapshot_json, &reasons_json)
        });
        match stored {
            Ok(()) => Some(RunStatus::Paused),
            Err(error) => {
                log::warn!("could not store the pause of run {run_id}: {error}");
                self.finish(run_id, RunStatus::Failed, None, Some(&format!("could not save the paused run: {error}")))
            }
        }
    }

    fn finish(
        &self,
        run_id: &str,
        status: RunStatus,
        outputs: Option<&Json>,
        error_message: Option<&str>,
    ) -> Option<RunStatus> {
        match self.db.finish_run(run_id, status, outputs, error_message) {
            Ok(()) => Some(status),
            Err(error) => {
                log::warn!("could not record the end of run {run_id}: {error}");
                None
            }
        }
    }

    /// Marks the run failed (if it is still open) and tells the UI.
    pub(super) fn fail_run(&self, run_id: &str, message: &str) {
        if let Some(status) = self.finish(run_id, RunStatus::Failed, None, Some(message)) {
            self.send_status(run_id, status);
        }
    }

    /// A successful test run promotes a `Draft` agent to `Tested`.
    fn mark_agent_tested(&self) {
        if self.trigger != RunTrigger::Test {
            return;
        }
        let promoted = self.db.get_agent(&self.agent_id).and_then(|agent| {
            if agent.status == AgentStatus::Draft {
                self.db.set_agent_status(&self.agent_id, AgentStatus::Tested)?;
            }
            Ok(())
        });
        if let Err(error) = promoted {
            log::warn!("could not mark agent {} as tested: {error}", self.agent_id);
        }
    }

    /// Sends `status_changed` with the seq of the run's latest stored event.
    pub(super) fn send_status(&self, run_id: &str, status: RunStatus) {
        let last_seq = match self.db.list_run_events(run_id) {
            Ok(events) => events.last().map_or(0, |event| event.seq),
            Err(error) => {
                log::warn!("could not read the events of run {run_id}: {error}");
                0
            }
        };
        self.send_status_with_seq(run_id, last_seq, status);
    }

    fn send_status_with_seq(&self, run_id: &str, seq: i64, status: RunStatus) {
        self.sink.send(self.payload(run_id, seq, status, json!({"type": "status_changed"})));
    }

    fn payload(&self, run_id: &str, seq: i64, status: RunStatus, event: Json) -> RunEventPayload {
        RunEventPayload { run_id: run_id.to_owned(), agent_id: self.agent_id.clone(), seq, status, event }
    }
}

/// The event as stored and sent to the UI. `run_paused` drops its snapshot:
/// the snapshot is kept once in the run row and is internal resume state.
fn event_to_json(event: &Event) -> Json {
    let mut event_json = match serde_json::to_value(event) {
        Ok(event_json) => event_json,
        Err(error) => {
            log::warn!("could not serialize a run event: {error}");
            return json!({"type": "unserializable_event", "error": error.to_string()});
        }
    };
    if let (Event::RunPaused { .. }, Some(fields)) = (event, event_json.as_object_mut()) {
        fields.remove("snapshot");
    }
    event_json
}
