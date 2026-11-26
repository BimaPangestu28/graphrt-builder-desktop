//! How run events are stored: coalesced `node_chunk`s and the abort race.

use std::collections::VecDeque;

use graphrt_llm::{ChatDelta, FinishReason};
use serde_json::Value as Json;

use super::*;
use crate::engine::chunk_buffer::ChunkBufferLimits;
use crate::storage::models::RunEventRecord;

/// Two model calls on parallel branches, so their chunk streams can interleave.
const PARALLEL_ANSWERS: &str = r#"
version: "1"
name: parallel-answers
graph:
  nodes:
    - { id: start, type: start, variables: [] }
    - id: first_answer
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "First" }
    - id: second_answer
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Second" }
    - id: end
      type: end
      outputs:
        - { variable: first, value_selector: [first_answer, text] }
        - { variable: second, value_selector: [second_answer, text] }
  edges:
    - { source: start, target: first_answer }
    - { source: start, target: second_answer }
    - { source: first_answer, target: end }
    - { source: second_answer, target: end }
"#;

/// Streams the same text pieces for every call, `gap` apart, then finishes
/// (or never finishes when `hang_after_pieces` is set).
#[derive(Debug)]
struct PacedModel {
    pieces: Vec<String>,
    gap: Duration,
    hang_after_pieces: bool,
}

impl ChatModel for PacedModel {
    fn chat(&self, _request: ChatRequest) -> BoxFuture<'_, Result<ChatStream, LlmError>> {
        let mut deltas: VecDeque<ChatDelta> = self.pieces.iter().cloned().map(ChatDelta::Text).collect();
        if !self.hang_after_pieces {
            deltas.push_back(ChatDelta::Finish(FinishReason::Stop));
        }
        let gap = self.gap;
        let hang_after_pieces = self.hang_after_pieces;
        let paced = futures::stream::unfold(deltas, move |mut remaining| async move {
            let delta = remaining.pop_front()?;
            tokio::time::sleep(gap).await;
            Some((Ok(delta), remaining))
        });
        let stream: ChatStream = if hang_after_pieces {
            Box::pin(futures::StreamExt::chain(paced, futures::stream::pending()))
        } else {
            Box::pin(paced)
        };
        Box::pin(async move { Ok(stream) })
    }
}

fn numbered_pieces(count: usize) -> Vec<String> {
    (0..count).map(|index| format!("t{index} ")).collect()
}

fn streaming_answer(pieces: &[String]) -> Vec<ChatDelta> {
    let mut deltas: Vec<ChatDelta> = pieces.iter().cloned().map(ChatDelta::Text).collect();
    deltas.push(ChatDelta::Finish(FinishReason::Stop));
    deltas
}

fn with_chunk_limits(harness: Harness, max_bytes: usize, max_age: Duration) -> Harness {
    let limits = ChunkBufferLimits { max_bytes, max_age };
    Harness { runs: harness.runs.with_chunk_buffer_limits(limits), ..harness }
}

fn is_chunk_of(event: &Json, node_id: &str) -> bool {
    event["type"] == "node_chunk" && event["node_id"] == node_id
}

fn stored_chunks_of(records: &[RunEventRecord], node_id: &str) -> Vec<RunEventRecord> {
    records.iter().filter(|record| is_chunk_of(&record.event, node_id)).cloned().collect()
}

fn live_chunks_of(sink: &CollectingSink, run_id: &str, node_id: &str) -> Vec<RunEventPayload> {
    sink.payloads_for(run_id).into_iter().filter(|payload| is_chunk_of(&payload.event, node_id)).collect()
}

fn joined_chunk_text<'a>(events: impl Iterator<Item = &'a Json>) -> String {
    events.map(|event| event["chunk"].as_str().unwrap()).collect()
}

/// What the stored log must look like (ignoring `coalesced`) when no size or
/// age limit was hit: the live events without status changes, where the chunks
/// between two other events become one row per stream, in first-chunk order.
fn expected_stored_log(payloads: &[RunEventPayload]) -> Vec<Json> {
    let mut expected: Vec<Json> = Vec::new();
    let mut chunk_rows: Vec<Json> = Vec::new();
    for event in payloads.iter().map(|payload| &payload.event).filter(|event| event["type"] != "status_changed") {
        if event["type"] != "node_chunk" {
            expected.append(&mut chunk_rows);
            expected.push(event.clone());
            continue;
        }
        match chunk_rows.iter_mut().find(|row| same_chunk_stream(row, event)) {
            Some(row) => {
                let joined = format!("{}{}", row["chunk"].as_str().unwrap(), event["chunk"].as_str().unwrap());
                row["chunk"] = Json::String(joined);
            }
            None => chunk_rows.push(event.clone()),
        }
    }
    expected.append(&mut chunk_rows);
    expected
}

fn same_chunk_stream(row: &Json, event: &Json) -> bool {
    ["frame", "node_id", "exec_id", "field"].iter().all(|key| row[*key] == event[*key])
}

/// Every live chunk carries the seq of the stored row that holds its text.
fn assert_live_chunks_name_their_rows(records: &[RunEventRecord], live_chunks: &[RunEventPayload]) {
    for payload in live_chunks {
        let row = records.iter().find(|record| record.seq == payload.seq).unwrap();
        assert!(same_chunk_stream(&row.event, &payload.event), "seq {} holds another stream", payload.seq);
        assert!(row.event["chunk"].as_str().unwrap().contains(payload.event["chunk"].as_str().unwrap()));
    }
}

fn without_coalesced_count(records: &[RunEventRecord]) -> Vec<Json> {
    records
        .iter()
        .map(|record| {
            let mut event = record.event.clone();
            if let Some(fields) = event.as_object_mut() {
                fields.remove("coalesced");
            }
            event
        })
        .collect()
}

#[tokio::test]
async fn streamed_answer_is_stored_in_few_rows_while_every_chunk_is_sent_live() {
    let pieces = numbered_pieces(300);
    let full_answer: String = pieces.concat();
    let harness = harness_with_model(Arc::new(MockModel::new(vec![streaming_answer(&pieces)])));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "Long?"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let records = harness.db.list_run_events(&run.id).unwrap();
    let live_chunks = live_chunks_of(&harness.sink, &run.id, "answer_question");
    assert_eq!(live_chunks.len(), 300);
    assert_eq!(joined_chunk_text(live_chunks.iter().map(|payload| &payload.event)), full_answer);

    let stored_chunks = stored_chunks_of(&records, "answer_question");
    assert!(stored_chunks.len() <= 2, "expected 1-2 combined rows, got {}", stored_chunks.len());
    assert_eq!(joined_chunk_text(stored_chunks.iter().map(|record| &record.event)), full_answer);
    let coalesced_total: u64 = stored_chunks.iter().map(|record| record.event["coalesced"].as_u64().unwrap()).sum();
    assert_eq!(coalesced_total, 300);
    assert!(records.len() < 30, "the whole run should need few rows, got {}", records.len());

    assert_live_chunks_name_their_rows(&records, &live_chunks);
    assert_eq!(without_coalesced_count(&records), expected_stored_log(&harness.sink.payloads_for(&run.id)));
    assert_eq!(harness.db.get_run(&run.id).unwrap().outputs.unwrap()["result"], json!(full_answer));
}

#[tokio::test]
async fn buffered_text_reaching_the_size_limit_is_stored() {
    let pieces: Vec<String> = (0..40).map(|_| "abcd".to_owned()).collect();
    let harness = harness_with_model(Arc::new(MockModel::new(vec![streaming_answer(&pieces)])));
    let harness = with_chunk_limits(harness, 16, Duration::from_secs(60));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "?"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let records = harness.db.list_run_events(&run.id).unwrap();
    let stored_chunks = stored_chunks_of(&records, "answer_question");
    assert_eq!(stored_chunks.len(), 10);
    for record in &stored_chunks {
        assert_eq!(record.event["chunk"], "abcd".repeat(4));
        assert_eq!(record.event["coalesced"], 4);
    }
    // Four consecutive live chunks share the seq of the row holding them.
    let live_seqs: Vec<i64> =
        live_chunks_of(&harness.sink, &run.id, "answer_question").iter().map(|payload| payload.seq).collect();
    let expected_seqs: Vec<i64> = stored_chunks.iter().flat_map(|record| [record.seq; 4]).collect();
    assert_eq!(live_seqs, expected_seqs);
}

#[tokio::test]
async fn buffered_chunk_is_stored_after_the_age_limit_while_the_stream_is_quiet() {
    let model = PacedModel { pieces: vec!["Hel".into(), "lo".into()], gap: Duration::ZERO, hang_after_pieces: true };
    let harness = with_chunk_limits(harness_with_model(Arc::new(model)), usize::MAX, Duration::from_millis(30));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "?"})).await.unwrap();
    // The model now hangs, so only the age limit can store the buffered text.
    wait_for_event(&harness.db, &run.id, "node_chunk").await;
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Running);
    let stored_chunks = stored_chunks_of(&harness.db.list_run_events(&run.id).unwrap(), "answer_question");
    assert_eq!(joined_chunk_text(stored_chunks.iter().map(|record| &record.event)), "Hello");

    harness.runs.abort_run(&run.id).unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Aborted).await;
    assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("run_aborted"));
}

#[tokio::test]
async fn interleaved_streams_and_node_events_keep_their_stored_order() {
    let model = PacedModel { pieces: numbered_pieces(20), gap: Duration::from_millis(1), hang_after_pieces: false };
    let harness = harness_with_model(Arc::new(model));
    let agent = create_agent(&harness.db, PARALLEL_ANSWERS);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let records = harness.db.list_run_events(&run.id).unwrap();
    assert_eq!(without_coalesced_count(&records), expected_stored_log(&harness.sink.payloads_for(&run.id)));
    for node_id in ["first_answer", "second_answer"] {
        let position = |event_type: &str| {
            records.iter().position(|record| record.event["type"] == event_type && record.event["node_id"] == node_id)
        };
        let started_at = position("node_started").unwrap();
        let succeeded_at = position("node_succeeded").unwrap();
        for (index, record) in records.iter().enumerate().filter(|(_, record)| is_chunk_of(&record.event, node_id)) {
            assert!(started_at < index && index < succeeded_at, "chunk row {} of {node_id} out of order", record.seq);
        }
        // The two streams interleave live, yet each is stored as one row.
        let stored_chunks = stored_chunks_of(&records, node_id);
        assert_eq!(stored_chunks.len(), 1, "{node_id} should have one combined row");
        assert_eq!(stored_chunks[0].event["chunk"], json!(numbered_pieces(20).concat()));
        assert_eq!(stored_chunks[0].event["coalesced"], 20);
        assert_live_chunks_name_their_rows(&records, &live_chunks_of(&harness.sink, &run.id, node_id));
    }
    assert_eq!(records.last().unwrap().event["type"], "run_succeeded");
}

/// Status and log must agree when an abort lands at any moment around the end of a run.
#[tokio::test]
async fn abort_racing_the_end_of_a_run_keeps_status_and_log_consistent() {
    const ATTEMPTS: usize = 40;
    let answers = (0..ATTEMPTS).map(|_| MockModel::text("Done.")).collect();
    let harness = harness_with_model(Arc::new(MockModel::new(answers)));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    for attempt in 0..ATTEMPTS {
        let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "?"})).await.unwrap();
        // Land the abort at a different point of the run on every attempt.
        for _ in 0..attempt * 2_000 {
            std::hint::spin_loop();
        }
        let abort_result = harness.runs.abort_run(&run.id);
        let final_status = wait_until_settled(&harness, &run.id).await;

        let last_event_type = stored_event_types(&harness.db, &run.id).pop().unwrap();
        let expected_last_event = match final_status {
            RunStatus::Succeeded => "run_succeeded",
            RunStatus::Aborted => "run_aborted",
            other => panic!("attempt {attempt}: unexpected final status {other:?}"),
        };
        assert_eq!(last_event_type, expected_last_event, "attempt {attempt}: status {final_status:?}");
        if final_status == RunStatus::Succeeded {
            // Either graphrt ignored the abort or abort_run reported the run as finished.
            assert!(abort_result.is_ok() || matches!(abort_result, Err(AppError::InvalidInput(_))));
        }
    }
}

/// Forwards to a [`CollectingSink`] and, when it receives `abort_on_event_type`,
/// requests an abort exactly as `abort_run` does for a registered run: while
/// the driver is still handling that terminal event.
#[derive(Debug)]
struct AbortingSink {
    collected: CollectingSink,
    abort_on_event_type: &'static str,
    active_runs: std::sync::OnceLock<Arc<ActiveRuns>>,
    abort_accepted: Mutex<Option<bool>>,
}

impl RunEventSink for AbortingSink {
    fn send(&self, payload: RunEventPayload) {
        if payload.event["type"] == self.abort_on_event_type {
            let active_runs = self.active_runs.get().unwrap();
            *self.abort_accepted.lock().unwrap() = Some(active_runs.request_abort(&payload.run_id).unwrap());
        }
        self.collected.send(payload);
    }
}

/// Starts `flow_yaml` with a sink that aborts when the driver sends `abort_on_event_type`.
async fn run_with_abort_on(
    abort_on_event_type: &'static str,
    flow_yaml: &str,
    inputs: Json,
) -> (Harness, Arc<AbortingSink>, Run) {
    let harness = harness_with_answers(&["Done."]);
    let sink = Arc::new(AbortingSink {
        collected: CollectingSink::default(),
        abort_on_event_type,
        active_runs: std::sync::OnceLock::new(),
        abort_accepted: Mutex::new(None),
    });
    let model = Arc::new(MockModel::new(vec![MockModel::text("Done.")]));
    let runs = RunManager::new(harness.db.clone(), harness.credentials.clone(), sink.clone())
        .with_model_registry_source(Arc::new(FixedModelSource { model }));
    sink.active_runs.set(runs.active_runs.clone()).unwrap();
    let harness = Harness { runs, ..harness };
    let agent = create_agent(&harness.db, flow_yaml);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, inputs).await.unwrap();
    (harness, sink, run)
}

/// The task is still registered while it handles `run_succeeded`, so an abort
/// landing then is only a request, and the success graphrt reported wins.
#[tokio::test]
async fn abort_while_success_is_being_recorded_keeps_the_success() {
    let (harness, sink, run) = run_with_abort_on("run_succeeded", SIMPLE_ANSWER, json!({"question": "?"})).await;
    wait_for_status(&sink.collected, &run.id, RunStatus::Succeeded).await;
    wait_until_unregistered(&harness, &run.id).await;

    assert_eq!(*sink.abort_accepted.lock().unwrap(), Some(true));
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Succeeded);
    assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("run_succeeded"));
    // abort_run on the finished run reports it as finished and changes nothing.
    assert!(matches!(harness.runs.abort_run(&run.id), Err(AppError::InvalidInput(_))));
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Succeeded);
}

/// A pause cannot honour an abort inside graphrt, so the task does it after
/// storing the pause: the same result as aborting a paused run.
#[tokio::test]
async fn abort_while_pause_is_being_recorded_aborts_the_paused_run() {
    let (harness, sink, run) = run_with_abort_on("run_paused", DRAFT_AND_APPROVE, json!({"topic": "tea"})).await;
    wait_for_status(&sink.collected, &run.id, RunStatus::Aborted).await;
    wait_until_unregistered(&harness, &run.id).await;

    assert_eq!(*sink.abort_accepted.lock().unwrap(), Some(true));
    let aborted = harness.db.get_run(&run.id).unwrap();
    assert_eq!(aborted.status, RunStatus::Aborted);
    assert!(matches!(harness.db.get_run_snapshot(&run.id), Err(AppError::InvalidInput(_))));
    assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("run_paused"));
}

/// An abort that arrives before the task registers (start / resume in progress)
/// aborts graphrt as soon as the task registers.
#[tokio::test]
async fn abort_before_the_task_registers_aborts_the_graphrt_run() {
    let harness = harness_with_model(Arc::new(HangingModel));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    let run = harness.db.insert_run(&agent.id, agent.current_version, RunTrigger::Manual).unwrap();

    harness.runs.abort_run(&run.id).unwrap();
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Aborted);

    let engine = preparation::build_engine(
        &agent.flow_yaml,
        &crate::flow::TrustedHosts::none(),
        &harness.credentials,
        &harness.db,
        &*harness.runs.model_source,
        graphrt_core::tool::ToolRegistry::new(),
    )
    .unwrap();
    let mut run_input = graphrt_core::RunInput::new();
    run_input.inputs = preparation::json_object_to_value_map(json!({"question": "?"}), "run inputs").unwrap();
    harness.runs.spawn_driver(&run, engine.run(run_input), PauseContext::default()).unwrap();

    wait_for_event(&harness.db, &run.id, "run_aborted").await;
    wait_until_unregistered(&harness, &run.id).await;
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Aborted);
    assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("run_aborted"));
}

/// Waits until the run is terminal and its task is gone; returns the status.
async fn wait_until_settled(harness: &Harness, run_id: &str) -> RunStatus {
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    loop {
        let status = harness.db.get_run(run_id).unwrap().status;
        let is_terminal = !matches!(status, RunStatus::Running | RunStatus::Paused);
        if is_terminal && !harness.runs.active_runs.is_registered(run_id) {
            return status;
        }
        assert!(tokio::time::Instant::now() < deadline, "run {run_id} never settled");
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}
