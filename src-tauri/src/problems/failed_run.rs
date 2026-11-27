//! Explains one failed run: which step failed, graphrt's error in plain words,
//! the step list and whether it can be retried.
//!
//! graphrt only keeps a snapshot of a *paused* run (storage drops it when a run
//! finishes), so a failed run cannot be resumed from the failing step: a retry
//! always starts a new run from the beginning (see [`super::retry`]).

use std::collections::HashMap;

use serde_json::Value as Json;

use super::models::{
    FailedRunReport, FailedRunStep, FailedRunStepState, ProblemAction, ProblemActionKind, RetryAvailability,
};
use super::retry;
use super::texts::ProblemTexts;
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::{Agent, Run};
use crate::storage::Database;

/// Error stored by `fail_interrupted_runs` for runs cut off by a quit or crash.
const INTERRUPTED_RUN_MESSAGE: &str = "The app closed while this run was in progress";
/// Words in graphrt / provider errors that mean a sign-in or key was refused.
/// graphrt's error when a plugin process cannot start because the plugin runtime is not
/// installed yet: `cannot run `<app data>/runtime/node-<version>/node`: No such file...`.
const PLUGIN_RUNTIME_MARKERS: &[&str] = &["runtime/node-", "runtime\\node-"];

/// Whether `lowered` (a lowercased error) says a plugin could not start because Node is missing.
fn is_missing_plugin_runtime(lowered: &str) -> bool {
    lowered.contains("cannot run `") && contains_any(lowered, PLUGIN_RUNTIME_MARKERS)
}

const SIGNED_OUT_MARKERS: &[&str] = &[
    "401",
    "403",
    "unauthorized",
    "unauthorised",
    "forbidden",
    "invalid_grant",
    "invalid api key",
    "invalid_api_key",
    "incorrect api key",
    "authentication",
    "token expired",
    "expired token",
    "not authenticated",
];
const TIMEOUT_MARKERS: &[&str] = &["timed out", "timeout", "deadline"];

/// Error kinds of a key or sign-in the service refused (plugins' `auth_error`, the model
/// providers' `model_auth`), whatever their message says.
const SIGNED_OUT_ERROR_TYPES: &[&str] = &["auth_error", "model_auth"];
const RETRY_NOTE: &str = "graphrt keeps no snapshot of a failed run, so it cannot resume from the failed step";

/// What the event log says about the failure.
#[derive(Debug, Default)]
pub(super) struct FailureFacts {
    /// The step that failed (unhandled `node_failed`, or the step running when the run stopped).
    pub failed_node_id: Option<String>,
    pub failed_node_kind: Option<String>,
    pub failed_node_title: Option<String>,
    /// The step's own error, falling back to `run_failed.error`.
    pub step_error: Option<String>,
    /// `run_failed.error_type` (or the node's), e.g. `timeout`, `http`, `model`.
    pub error_type: Option<String>,
    pub retry_count: u32,
    /// Final state per node id.
    pub node_states: HashMap<String, FailedRunStepState>,
    /// `(node id, title)` in the order steps started, for flows that no longer compile.
    pub started_nodes: Vec<(String, String)>,
}

fn text_field<'a>(event: &'a Json, field: &str) -> Option<&'a str> {
    event.get(field).and_then(Json::as_str)
}

impl FailureFacts {
    /// Reads graphrt events (as JSON, in order).
    pub(super) fn from_events(events: &[Json]) -> Self {
        let mut facts = Self::default();
        let mut node_kinds: HashMap<String, (String, String)> = HashMap::new();
        let mut last_started: Option<String> = None;
        for event in events {
            let node_id = text_field(event, "node_id").map(str::to_owned);
            match text_field(event, "type").unwrap_or_default() {
                "node_started" => {
                    let Some(node_id) = node_id else { continue };
                    let kind = text_field(event, "kind").unwrap_or_default().to_owned();
                    let title = text_field(event, "title").filter(|title| !title.is_empty()).unwrap_or(&node_id);
                    if !node_kinds.contains_key(&node_id) {
                        facts.started_nodes.push((node_id.clone(), title.to_owned()));
                    }
                    node_kinds.insert(node_id.clone(), (kind, title.to_owned()));
                    last_started = Some(node_id);
                }
                "node_succeeded" | "node_skipped" => {
                    if let Some(node_id) = node_id {
                        let state = if text_field(event, "type") == Some("node_succeeded") {
                            FailedRunStepState::Done
                        } else {
                            FailedRunStepState::Pending
                        };
                        facts.node_states.insert(node_id, state);
                    }
                }
                "node_retry" => facts.retry_count += 1,
                "node_failed" => facts.record_node_failure(event, node_id),
                "run_failed" => {
                    if facts.step_error.is_none() {
                        facts.step_error = text_field(event, "error").map(str::to_owned);
                    }
                    let run_error_type = text_field(event, "error_type").filter(|text| !text.is_empty());
                    if let Some(run_error_type) = run_error_type {
                        facts.error_type = Some(run_error_type.to_owned());
                    }
                }
                _ => {}
            }
        }
        facts.finish(last_started, &node_kinds);
        facts
    }

    fn record_node_failure(&mut self, event: &Json, node_id: Option<String>) {
        let Some(node_id) = node_id else { return };
        if event.get("handled").and_then(Json::as_bool) == Some(true) {
            self.node_states.insert(node_id, FailedRunStepState::Done);
            return;
        }
        self.node_states.insert(node_id.clone(), FailedRunStepState::Failed);
        self.failed_node_id = Some(node_id);
        self.step_error = text_field(event, "error").map(str::to_owned);
        self.error_type = text_field(event, "error_type").filter(|text| !text.is_empty()).map(str::to_owned);
    }

    /// A run cut off mid-step (quit, crash) has no `node_failed`: blame the step that was running.
    fn finish(&mut self, last_started: Option<String>, node_kinds: &HashMap<String, (String, String)>) {
        if self.failed_node_id.is_none() {
            if let Some(node_id) = last_started.filter(|node_id| !self.node_states.contains_key(node_id)) {
                self.node_states.insert(node_id.clone(), FailedRunStepState::Failed);
                self.failed_node_id = Some(node_id);
            }
        }
        if let Some((kind, title)) = self.failed_node_id.as_ref().and_then(|node_id| node_kinds.get(node_id)) {
            self.failed_node_kind = Some(kind.clone());
            self.failed_node_title = Some(title.clone());
        }
    }
}

/// The cause in plain words, and how to fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FailureExplanation {
    pub title: String,
    pub explanation: String,
    pub fix_steps: Vec<String>,
    pub fix_action: Option<ProblemAction>,
}

fn contains_any(text: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| text.contains(marker))
}

/// Turns graphrt's error into a title, an explanation and fix steps.
pub(super) fn explain_failure(texts: ProblemTexts, run: &Run, facts: &FailureFacts) -> FailureExplanation {
    let error = facts.step_error.clone().or_else(|| run.error_message.clone()).unwrap_or_default();
    let lowered = error.to_lowercase();
    let error_type = facts.error_type.as_deref().unwrap_or_default();
    let step = facts.failed_node_title.clone().unwrap_or_else(|| texts.a_step());
    let nothing_after = texts.nothing_after();
    let nothing_after = nothing_after.as_str();
    let retry_step = texts.retry_once_fixed();

    if run.error_message.as_deref() == Some(INTERRUPTED_RUN_MESSAGE) {
        return FailureExplanation {
            title: texts.app_closed_title(),
            explanation: texts.app_closed_detail(&step.to_lowercase(), nothing_after),
            fix_steps: vec![texts.retry_from_start()],
            fix_action: None,
        };
    }
    if is_missing_plugin_runtime(&lowered) {
        return FailureExplanation {
            title: texts.plugin_runtime_missing_title(),
            explanation: texts.runtime_missing_detail(&step, nothing_after),
            fix_steps: vec![texts.install_plugin_runtime(), retry_step],
            fix_action: Some(ProblemAction::new(
                ProblemActionKind::InstallPluginRuntime,
                &texts.install_plugin_runtime(),
            )),
        };
    }
    if SIGNED_OUT_ERROR_TYPES.contains(&error_type) || contains_any(&lowered, SIGNED_OUT_MARKERS) {
        return FailureExplanation {
            title: texts.signed_out_title(),
            explanation: texts.signed_out_detail(&step, nothing_after),
            fix_steps: vec![texts.signed_out_fix(), retry_step],
            fix_action: Some(ProblemAction::new(ProblemActionKind::OpenConnections, &texts.reconnect())),
        };
    }
    if error_type == "timeout" || contains_any(&lowered, TIMEOUT_MARKERS) {
        return FailureExplanation {
            title: texts.timeout_title(),
            explanation: texts.timeout_detail(&step, nothing_after),
            fix_steps: vec![texts.timeout_fix(), retry_step],
            fix_action: Some(ProblemAction::for_agent(
                ProblemActionKind::OpenBuilder,
                &texts.open_step(),
                &run.agent_id,
            )),
        };
    }
    let (title, fix_step, fix_action) = match error_type {
        "model" => (
            texts.model_title(),
            texts.model_fix(),
            Some(ProblemAction::new(ProblemActionKind::OpenConnections, &texts.open_connections())),
        ),
        "http" => (
            texts.http_title(),
            texts.http_fix(),
            Some(ProblemAction::for_agent(ProblemActionKind::OpenBuilder, &texts.open_step(), &run.agent_id)),
        ),
        "limit_exceeded" => (
            texts.limit_title(),
            texts.limit_fix(),
            Some(ProblemAction::for_agent(ProblemActionKind::OpenBuilder, &texts.open_builder(), &run.agent_id)),
        ),
        "setup_required" => (
            texts.plugin_setup_title(),
            texts.plugin_setup_fix(),
            Some(ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugin_settings())),
        ),
        "not_found" | "permission_denied" => (
            texts.plugin_refused_title(),
            texts.plugin_refused_fix(),
            Some(ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugin_settings())),
        ),
        "rate_limited" | "model_rate_limit" => (
            texts.rate_limited_title(),
            texts.rate_limited_fix(),
            Some(ProblemAction::for_agent(ProblemActionKind::OpenBuilder, &texts.open_step(), &run.agent_id)),
        ),
        "invalid_input" => (
            texts.invalid_input_title(),
            texts.invalid_input_fix(),
            Some(ProblemAction::for_agent(ProblemActionKind::OpenBuilder, &texts.open_builder(), &run.agent_id)),
        ),
        _ => (
            texts.step_failed_title(&step),
            texts.step_failed_fix(),
            Some(ProblemAction::for_agent(ProblemActionKind::OpenBuilder, &texts.open_step(), &run.agent_id)),
        ),
    };
    let reason = if error.is_empty() { String::new() } else { texts.graphrt_said(&error) };
    FailureExplanation {
        title,
        explanation: texts.stopped_at(&step.to_lowercase(), &reason, nothing_after),
        fix_steps: vec![fix_step, retry_step],
        fix_action,
    }
}

/// The flow the run used (its version may be older than the agent's current one).
fn flow_of_run(db: &Database, agent: &Agent, run: &Run) -> AppResult<Option<String>> {
    if agent.current_version == run.agent_version {
        return Ok(Some(agent.flow_yaml.clone()));
    }
    Ok(db
        .list_agent_versions(&agent.id)?
        .into_iter()
        .find(|version| version.version == run.agent_version)
        .map(|version| version.flow_yaml))
}

fn failure_note(facts: &FailureFacts, texts: ProblemTexts) -> String {
    if facts.retry_count > 0 {
        texts.failed_after_tries(facts.retry_count + 1)
    } else {
        texts.failed()
    }
}

/// Steps in workflow order with their outcome. Falls back to the steps that
/// started when the flow no longer compiles (for example a removed plugin).
fn build_steps(flow_yaml: Option<&str>, facts: &FailureFacts, texts: ProblemTexts) -> Vec<FailedRunStep> {
    let ordered: Vec<(String, String)> = match flow_yaml.map(flow::summarize_flow) {
        Some(Ok(summary)) => summary.steps.into_iter().map(|step| (step.id, step.title)).collect(),
        _ => facts.started_nodes.clone(),
    };
    let mut steps: Vec<FailedRunStep> = ordered
        .into_iter()
        .map(|(id, name)| {
            let state = facts.node_states.get(&id).copied().unwrap_or(FailedRunStepState::Pending);
            let note = (state == FailedRunStepState::Failed).then(|| failure_note(facts, texts));
            FailedRunStep { id, name, state, note }
        })
        .collect();
    // The failing node may be a bookkeeping node the summary hides (e.g. `start`).
    if let Some(failed_id) = &facts.failed_node_id {
        if !steps.iter().any(|step| &step.id == failed_id) {
            let name = facts.failed_node_title.clone().unwrap_or_else(|| failed_id.clone());
            let note = Some(failure_note(facts, texts));
            steps.insert(0, FailedRunStep { id: failed_id.clone(), name, state: FailedRunStepState::Failed, note });
        }
    }
    steps
}

fn technical_details(run: &Run, facts: &FailureFacts) -> String {
    let mut lines = Vec::new();
    if let Some(node_id) = &facts.failed_node_id {
        let kind = facts.failed_node_kind.as_deref().unwrap_or("unknown");
        lines.push(format!("node: {node_id} ({kind})"));
    }
    let error = facts.step_error.as_deref().or(run.error_message.as_deref()).unwrap_or("no error message");
    match facts.error_type.as_deref() {
        Some(error_type) => lines.push(format!("error: {error_type} · {error}")),
        None => lines.push(format!("error: {error}")),
    }
    if facts.retry_count > 0 {
        lines.push(format!("retries: {}", facts.retry_count));
    }
    lines.push(format!("run: {} · agent version {}", run.id, run.agent_version));
    lines.push(format!("resume: not possible, {RETRY_NOTE}; a retry starts a new run"));
    lines.join("\n")
}

/// Builds the report of a failed (or aborted) run.
///
/// @throws AppError::NotFound - when the run or its agent does not exist
/// @throws AppError::Database - when storage fails
pub fn failed_run_report(db: &Database, run_id: &str) -> AppResult<FailedRunReport> {
    let run = db.get_run(run_id)?;
    let agent = db.get_agent(&run.agent_id)?;
    let events: Vec<Json> = db.list_run_events(run_id)?.into_iter().map(|record| record.event).collect();
    let facts = FailureFacts::from_events(&events);
    let texts = ProblemTexts::for_database(db);
    let explanation = explain_failure(texts, &run, &facts);
    let flow_yaml = flow_of_run(db, &agent, &run)?;
    let retry = match retry::inputs_for_retry(db, &run) {
        Ok(_) => RetryAvailability { can_retry: true, reason: None },
        Err(AppError::InvalidInput(reason)) => RetryAvailability { can_retry: false, reason: Some(reason) },
        Err(error) => RetryAvailability { can_retry: false, reason: Some(error.to_string()) },
    };
    Ok(FailedRunReport {
        run_id: run.id.clone(),
        agent_id: agent.id.clone(),
        agent_name: agent.name.clone(),
        status: run.status,
        started_at: run.started_at.clone(),
        title: explanation.title,
        explanation: explanation.explanation,
        fix_steps: explanation.fix_steps,
        fix_action: explanation.fix_action,
        steps: build_steps(flow_yaml.as_deref(), &facts, texts),
        failed_step_id: facts.failed_node_id.clone(),
        technical_details: technical_details(&run, &facts),
        retry,
    })
}
