//! Runs agents on the graphrt engine and streams their events to the UI.
//!
//! A run is a task that drives the graphrt event stream, persists its events
//! (`storage::runs`; streamed `node_chunk`s are coalesced first) and emits
//! every event to the frontend as the Tauri event [`RUN_EVENT`]. When graphrt
//! pauses (approval / human input) the snapshot is stored and the task ends;
//! `resume_run` continues it from the snapshot.
//!
//! Layout:
//! - [`RunManager`] (this file): the public start / resume / abort API.
//! - `preparation`: everything checked and built before a run exists
//!   (workflow, credentials, graphrt services, inputs).
//! - `driver`: the task that consumes one graphrt stream and records it.
//! - `chunk_buffer`: combines streamed chunks into few stored rows.
//! - `active_runs`: handles of running tasks and abort requests.
//! - [`ModelRegistrySource`]: where model clients come from (keychain in the
//!   app, scripted mock models in tests).
//!
//! Workflow `env.*` values: graphrt never stores them in snapshots, so they
//! must be supplied on every start AND resume. Both paths get them from
//! `preparation::workflow_env`, which currently returns an empty map; a future
//! env/secret provider plugs in there and nowhere else.

mod active_runs;
pub mod agent_tools;
mod chunk_buffer;
mod driver;
mod preparation;
pub mod tauri_sink;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use graphrt_core::{RunInput, Snapshot};
use serde::{Deserialize, Serialize};

use self::active_runs::ActiveRuns;
use self::chunk_buffer::ChunkBufferLimits;
use self::driver::RunDriver;
pub(crate) use self::preparation::flow_for_version;
pub(crate) use self::preparation::prepare_engine_and_env;

/// Other agents as tools for a workflow of `agent_id` that is not a `RunManager`
/// run (e.g. a chatbot turn); refuses calls back into `agent_id`.
pub(crate) fn agent_tools_for(
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    model_source: Arc<dyn ModelRegistrySource>,
    agent_id: &str,
) -> graphrt_core::tool::ToolRegistry {
    let dependencies = agent_tools::EngineDependencies { db, credentials, model_source };
    agent_tools::agent_tool_registry(&dependencies, vec![agent_id.to_owned()])
}
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Name of the Tauri event carrying [`RunEventPayload`].
pub const RUN_EVENT: &str = "run-event";

/// Reason graphrt records on the `run_aborted` event when the user stops a run.
const USER_ABORT_REASON: &str = "Stopped by the user";

/// Sent to the frontend for every graphrt event of a run, and once more when
/// the run's status changes (then `event` is `{"type": "status_changed"}`).
///
/// `seq` is the stored row the event belongs to. Every streamed `node_chunk`
/// is sent live, but chunks are stored coalesced (see `chunk_buffer`): a live
/// chunk carries the seq its combined row gets (or got), so all live chunks
/// of one combined row share a seq, and the row read back later with
/// `list_run_events` holds their concatenated text (plus `coalesced`). This
/// relies on the driver being the only writer of a running run's events; if
/// storing an event fails, later seqs can be off by the failed rows.
/// `status_changed` carries the seq of the latest stored event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPayload {
    pub run_id: String,
    pub agent_id: String,
    pub seq: i64,
    pub status: RunStatus,
    pub event: serde_json::Value,
}

/// Delivers run events to the UI. The app uses a Tauri emitter; tests collect them.
pub trait RunEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, payload: RunEventPayload);
}

/// Provides the graphrt model registry for each run.
///
/// The app uses [`KeychainModelRegistrySource`]; tests inject scripted
/// `graphrt_llm::mock::MockModel`s through [`RunManager::with_model_registry_source`].
pub trait ModelRegistrySource: Send + Sync + std::fmt::Debug {
    /// Builds the registry for one run (called on every start and resume).
    ///
    /// # Errors
    /// Any `AppError`; the run is then not started.
    fn build_registry(&self, credentials: &CredentialStore, db: &Database) -> AppResult<graphrt_llm::ModelRegistry>;
}

/// Model clients built from the API keys in the OS keychain.
#[derive(Debug, Default)]
pub struct KeychainModelRegistrySource;

impl ModelRegistrySource for KeychainModelRegistrySource {
    fn build_registry(&self, credentials: &CredentialStore, db: &Database) -> AppResult<graphrt_llm::ModelRegistry> {
        crate::credentials::build_model_registry(credentials, db)
    }
}

/// Starts, resumes and aborts agent runs. One per app, shared as `Arc<RunManager>`.
#[derive(Debug)]
pub struct RunManager {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    sink: Arc<dyn RunEventSink>,
    model_source: Arc<dyn ModelRegistrySource>,
    active_runs: Arc<ActiveRuns>,
    chunk_buffer_limits: ChunkBufferLimits,
}

fn already_finished(run_id: &str, status: RunStatus) -> AppError {
    AppError::InvalidInput(format!("run {run_id} has already finished ({})", status.as_db_text()))
}

impl RunManager {
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>, sink: Arc<dyn RunEventSink>) -> Self {
        Self {
            db,
            credentials,
            sink,
            model_source: Arc::new(KeychainModelRegistrySource),
            active_runs: Arc::new(ActiveRuns::default()),
            chunk_buffer_limits: ChunkBufferLimits::default(),
        }
    }

    /// Replaces when buffered `node_chunk` events are stored (tests use tiny limits).
    #[cfg(test)]
    fn with_chunk_buffer_limits(mut self, chunk_buffer_limits: ChunkBufferLimits) -> Self {
        self.chunk_buffer_limits = chunk_buffer_limits;
        self
    }

    /// Replaces where model clients come from (tests use scripted mock models).
    /// The provider-key check in `start_run` / `resume_run` still applies.
    pub fn with_model_registry_source(mut self, model_source: Arc<dyn ModelRegistrySource>) -> Self {
        self.model_source = model_source;
        self
    }

    /// Starts the agent's current version with workflow inputs (JSON object) and
    /// returns the run right away (status `Running`); events follow on the sink.
    ///
    /// # Errors
    /// - `NotFound` when the agent does not exist.
    /// - `InvalidInput` / `Workflow` when the flow does not compile or `inputs` is not an object.
    /// - `MissingCredentials` when a model provider used by the flow has no key,
    ///   or an `env.*` value it declares has neither a stored value nor a default;
    ///   no run is recorded in that case.
    pub async fn start_run(&self, agent_id: &str, trigger: RunTrigger, inputs: serde_json::Value) -> AppResult<Run> {
        let agent = self.db.get_agent(agent_id)?;
        let tools = self.agent_tools(&agent.id);
        let engine =
            preparation::build_engine(&agent.flow_yaml, &self.credentials, &self.db, &*self.model_source, tools)?;
        let mut run_input = RunInput::new();
        let stored_inputs = inputs.clone();
        run_input.inputs = preparation::json_object_to_value_map(inputs, "run inputs")?;
        run_input.env = preparation::workflow_env(&agent.flow_yaml, &self.credentials)?;

        let run = self.db.insert_run(agent_id, agent.current_version, trigger)?;
        // Kept only to prefill the next run; a failure must not stop this one.
        if let Err(error) = self.db.save_run_inputs(&run.id, &stored_inputs) {
            log::warn!("could not store the inputs of run {}: {error}", run.id);
        }
        self.driver_for(&run).send_status(&run.id, RunStatus::Running);
        self.spawn_driver(&run, engine.run(run_input))?;
        Ok(run)
    }

    /// Resumes a paused run. `node_inputs` maps the paused node id to the user's
    /// answer, e.g. `{"approve_message": {"action": "approve", "values": {"message": "..."}}}`.
    ///
    /// The run resumes on the agent version it started with, even if the agent
    /// was edited meanwhile (graphrt rejects snapshots from a different graph).
    ///
    /// # Errors
    /// - `NotFound` for an unknown run, or when its agent version no longer exists.
    /// - `InvalidInput` when the run is not paused or `node_inputs` is not an object.
    /// - `MissingCredentials` when a model provider used by the flow has no key.
    pub async fn resume_run(&self, run_id: &str, node_inputs: serde_json::Value) -> AppResult<Run> {
        let run = self.db.get_run(run_id)?;
        if run.status != RunStatus::Paused {
            return Err(AppError::InvalidInput(format!("run {run_id} is not paused")));
        }
        let agent = self.db.get_agent(&run.agent_id)?;
        let flow_yaml = preparation::flow_for_version(&self.db, &agent, run.agent_version)?;
        let tools = self.agent_tools(&agent.id);
        let engine = preparation::build_engine(&flow_yaml, &self.credentials, &self.db, &*self.model_source, tools)?;
        let snapshot = Snapshot::from_json(&self.db.get_run_snapshot(run_id)?)?;
        let resume_inputs = preparation::json_object_to_value_map(node_inputs, "node inputs")?;
        let mut run_input = RunInput::new().resume(snapshot, resume_inputs);
        run_input.env = preparation::workflow_env(&flow_yaml, &self.credentials)?;

        // Validates the Paused → Running transition atomically, so two
        // concurrent resumes cannot both start a task.
        self.db.mark_run_resumed(run_id)?;
        self.driver_for(&run).send_status(run_id, RunStatus::Running);
        self.spawn_driver(&run, engine.run(run_input))?;
        self.db.get_run(run_id)
    }

    /// Stops a running or paused run (status `Aborted`).
    ///
    /// A running run is aborted through its graphrt handle and its task records
    /// whatever terminal event graphrt then emits; a paused run (no task) is
    /// finished directly.
    ///
    /// # Abort racing the end of a run
    /// The run's status and its event log must agree, so the outcome graphrt
    /// reports wins over an abort requested at the same moment:
    /// - A task keeps its handle registered until it has stored the terminal
    ///   event AND the status it implies. An abort meanwhile only signals
    ///   graphrt (a no-op once graphrt has finished) and flags the request; a
    ///   `run_succeeded` / `run_failed` is still recorded as `Succeeded` /
    ///   `Failed`, never `Aborted`.
    /// - If graphrt paused instead, the task honours the flagged request after
    ///   storing the pause: `Paused → Aborted`, as when aborting a paused run.
    /// - With no registered task, the run is finished here. That is refused
    ///   ("already finished") when the task stored a terminal status first,
    ///   since storage never changes a terminal run. A task that has not
    ///   registered yet (start / resume in progress) finds the remembered abort
    ///   when it registers and aborts graphrt, so its log ends with `run_aborted`.
    ///
    /// # Errors
    /// - `NotFound` for an unknown run.
    /// - `InvalidInput` when the run has already finished.
    pub fn abort_run(&self, run_id: &str) -> AppResult<()> {
        let run = self.db.get_run(run_id)?;
        match run.status {
            RunStatus::Running => {
                if self.active_runs.request_abort(run_id)? {
                    return Ok(());
                }
                let finished = self.finish_aborted(&run);
                if finished.is_err() {
                    self.active_runs.cancel_pending_abort(run_id);
                }
                finished.map_err(|error| self.already_finished_error(run_id).unwrap_or(error))
            }
            RunStatus::Paused => self.finish_aborted(&run),
            finished => Err(already_finished(run_id, finished)),
        }
    }

    /// The "already finished" error when the run has reached a terminal status.
    fn already_finished_error(&self, run_id: &str) -> Option<AppError> {
        match self.db.get_run(run_id).ok()?.status {
            RunStatus::Running | RunStatus::Paused => None,
            finished => Some(already_finished(run_id, finished)),
        }
    }

    /// Tool registry for a top-level run of `agent_id`: other agents as tools.
    fn agent_tools(&self, agent_id: &str) -> graphrt_core::tool::ToolRegistry {
        let dependencies = agent_tools::EngineDependencies {
            db: self.db.clone(),
            credentials: self.credentials.clone(),
            model_source: self.model_source.clone(),
        };
        agent_tools::agent_tool_registry(&dependencies, vec![agent_id.to_owned()])
    }

    fn finish_aborted(&self, run: &Run) -> AppResult<()> {
        self.db.finish_run(&run.id, RunStatus::Aborted, None, None)?;
        self.driver_for(run).send_status(&run.id, RunStatus::Aborted);
        Ok(())
    }

    fn driver_for(&self, run: &Run) -> RunDriver {
        RunDriver {
            db: self.db.clone(),
            sink: self.sink.clone(),
            active_runs: self.active_runs.clone(),
            agent_id: run.agent_id.clone(),
            trigger: run.trigger,
            chunk_buffer_limits: self.chunk_buffer_limits,
        }
    }

    /// Registers the stream's handle and spawns the task driving it.
    ///
    /// If registration fails the run is marked failed, so it never stays `Running`.
    fn spawn_driver(&self, run: &Run, stream: graphrt_core::RunStream) -> AppResult<()> {
        let driver = self.driver_for(run);
        let drive_id = match self.active_runs.register(&run.id, stream.handle()) {
            Ok(drive_id) => drive_id,
            Err(error) => {
                driver.fail_run(&run.id, &format!("could not start the run: {error}"));
                return Err(error);
            }
        };
        let run_id = run.id.clone();
        tauri::async_runtime::spawn(async move { driver.drive(run_id, drive_id, stream).await });
        Ok(())
    }
}
