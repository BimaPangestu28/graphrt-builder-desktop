//! "Retry from the start": the inputs a new run of the same agent gets.
//!
//! Runs do not store their inputs in a column. graphrt places run inputs under
//! the `start` node, which outputs them (with defaults applied), so they are
//! read back from that node's `node_succeeded` event. When the event log is
//! gone (pruned after 30 days), a scheduled run falls back to its schedule's
//! inputs and a flow without required inputs to none; otherwise the retry is
//! refused with a reason instead of guessing.

use serde_json::{Map, Value as Json};

use crate::engine::RunManager;
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

const START_NODE_KIND: &str = "start";

/// The start node's outputs, i.e. the run's inputs, from the event log.
fn inputs_from_events(events: &[Json]) -> Option<Json> {
    let start_node_id = events.iter().find_map(|event| {
        let is_start = event.get("type").and_then(Json::as_str) == Some("node_started")
            && event.get("kind").and_then(Json::as_str) == Some(START_NODE_KIND);
        is_start.then(|| event.get("node_id").and_then(Json::as_str)).flatten()
    })?;
    events.iter().find_map(|event| {
        let is_start_success = event.get("type").and_then(Json::as_str) == Some("node_succeeded")
            && event.get("node_id").and_then(Json::as_str) == Some(start_node_id);
        is_start_success.then(|| without_empty_values(event.get("outputs")))
    })
}

/// Optional inputs left out of the run come back as `null`; leave them out again.
fn without_empty_values(outputs: Option<&Json>) -> Json {
    let fields = outputs.and_then(Json::as_object).cloned().unwrap_or_default();
    Json::Object(fields.into_iter().filter(|(_, value)| !value.is_null()).collect())
}

fn inputs_from_schedule(db: &Database, run: &Run) -> AppResult<Option<Json>> {
    if run.trigger != RunTrigger::Schedule {
        return Ok(None);
    }
    Ok(db.list_triggers(Some(&run.agent_id))?.into_iter().next().map(|trigger| trigger.inputs))
}

fn flow_needs_inputs(flow_yaml: &str) -> bool {
    match flow::summarize_flow(flow_yaml) {
        Ok(summary) => summary.inputs.iter().any(|input| input.required),
        // A flow that does not compile cannot run either; let `start_run` report why.
        Err(_) => false,
    }
}

/// The inputs to start the retry with.
///
/// @throws AppError::InvalidInput - when the run has not finished, or its inputs are no longer known
/// @throws AppError::NotFound - when the agent was deleted
/// @throws AppError::Database - when storage fails
pub fn inputs_for_retry(db: &Database, run: &Run) -> AppResult<Json> {
    if matches!(run.status, RunStatus::Running | RunStatus::Paused) {
        return Err(AppError::InvalidInput("this run has not finished yet".into()));
    }
    let agent = db.get_agent(&run.agent_id)?;
    let events: Vec<Json> = db.list_run_events(&run.id)?.into_iter().map(|record| record.event).collect();
    if let Some(inputs) = inputs_from_events(&events) {
        return Ok(inputs);
    }
    if let Some(inputs) = inputs_from_schedule(db, run)? {
        return Ok(inputs);
    }
    if !flow_needs_inputs(&agent.flow_yaml) {
        return Ok(Json::Object(Map::new()));
    }
    Err(AppError::InvalidInput(
        "the details this run started with are no longer stored; start it again from the Test screen".into(),
    ))
}

/// Starts a new manual run of the run's agent (current version) with the same inputs.
///
/// @throws AppError::InvalidInput - see [`inputs_for_retry`]
/// @throws AppError::MissingCredentials - when a key the flow needs is still not set
pub async fn retry_run(db: &Database, runs: &RunManager, run_id: &str) -> AppResult<Run> {
    let run = db.get_run(run_id)?;
    let inputs = inputs_for_retry(db, &run)?;
    log::info!("retrying run {run_id} of agent {} from the start", run.agent_id);
    runs.start_run(&run.agent_id, RunTrigger::Manual, inputs).await
}
