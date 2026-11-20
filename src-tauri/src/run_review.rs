//! What a paused run is waiting for, for the "Review a run" screen (19).
//!
//! A [`RunReview`] is read from one stored run:
//! - `pending`: every `human_input` pause reason graphrt reported, with the
//!   rendered prompt, form fields and actions exactly as the `human-input` node
//!   sent them (`{prompt, fields, actions, timeout_ms}`) plus the desktop's
//!   deadline and timeout action (`engine::approval_pauses`); and one entry per
//!   tool call of every `tool_approval` pause (a "Run an agent" step whose
//!   tools ask first), answered Allow / Decline with `{"approvals": {id: bool}}`;
//! - for a pause inside an `iteration` / `loop` body, the item position read
//!   from the pause reason's `frame` (`each_place[3]`, nested frames joined by
//!   `/`) and, best effort, from the paused run's snapshot: how many items the
//!   iteration has, how many are finished and the current `item` value;
//! - `answered`: the human-input answers already given in this run, read from
//!   `node_succeeded` events (`outputs.action`).
//!
//! graphrt limits worth knowing (see `graphrt-core/src/nodes/iteration.rs`):
//! - A sequential iteration (`is_parallel: false`) pauses on one item at a
//!   time: the next item's question exists only after the current one is
//!   answered and the run resumed. A parallel iteration pauses on every item
//!   that was in flight, so several questions can wait at once.
//! - Answers are keyed `"<frame>/<node id>"` (falls back to the plain node id),
//!   so `resume_key` answers exactly one question.
//! - The iteration's resume state (`total`, `results`, `paused`) is graphrt's
//!   internal snapshot format, not a documented API: reading it is best effort
//!   and every value derived from it is optional.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value as Json;

use crate::engine::approval_pauses::{
    redact_secrets, TimeoutAction, EXPIRES_AT_KEY, HUMAN_INPUT_PAUSE_KIND, ON_TIMEOUT_KEY, TOOL_APPROVAL_PAUSE_KIND,
};
use crate::error::AppResult;
use crate::flow::FlowStep;
use crate::storage::models::{Agent, Run, RunEventRecord, RunFilter, RunStatus, RunTrigger};
use crate::storage::Database;

/// Buttons of a tool call question; the answer is `{"approvals": {<call id>: true|false}}`.
const ALLOW_ACTION_ID: &str = "allow";
const DECLINE_ACTION_ID: &str = "decline";
const HUMAN_INPUT_NODE_KIND: &str = "human-input";
const ITERATION_NODE_KIND: &str = "iteration";
/// Paused runs looked at when no run id is given.
const LATEST_PAUSED_RUNS_LIMIT: i64 = 50;

/// One form field of a `human-input` pause (`data.fields[]`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalField {
    pub name: String,
    pub label: String,
    /// The field's `type` as written in the workflow (`text` when omitted).
    pub field_type: String,
    pub required: bool,
    /// The rendered default (`null` when none).
    pub default_value: Json,
}

/// One action (button) of a `human-input` pause (`data.actions[]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalAction {
    pub id: String,
    pub title: String,
}

/// Where a pause sits inside a container (`iteration` or `loop`) body.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerPosition {
    /// The container node id, e.g. `each_place`.
    pub node_id: String,
    /// `iteration`, `loop`, or `None` when the flow could not be read.
    pub node_type: Option<String>,
    /// The container step's title from the flow.
    pub title: Option<String>,
    /// 0-based item index (iteration) or round (loop).
    pub index: u64,
    /// Items the iteration goes through (snapshot, best effort).
    pub total: Option<u64>,
    /// Items already finished (snapshot, best effort).
    pub finished: Option<u64>,
    /// The current item (`<iteration>.item`, snapshot, best effort; secrets are masked).
    pub item: Option<Json>,
}

/// What kind of question a [`PendingApproval`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingApprovalKind {
    /// An "Ask me before continuing" (`human-input`) step: `{action, values}`.
    Form,
    /// One tool call an agent step waits to make: Allow / Decline.
    ToolCall,
}

/// The tool call a `ToolCall` question is about (`data.calls[]` of a `tool_approval` pause).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingToolCall {
    /// graphrt's call id, the key of the answer.
    pub call_id: String,
    /// The name the model called (graphrt's model-safe tool name).
    pub name: String,
    /// The tool's provider (plugin, MCP server or `agents`) when the step's `tools` list names it.
    pub provider: Option<String>,
    pub tool: Option<String>,
    /// The arguments, with secret-looking values hidden.
    pub arguments: Json,
    /// Why the agent wants to make the call. graphrt does not send one yet, so always `None` for now.
    pub reason: Option<String>,
}

/// A question the run waits on right now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    /// Unique among the run's questions: the resume key, plus `#<call id>` for tool calls.
    pub id: String,
    pub kind: PendingApprovalKind,
    pub node_id: String,
    /// graphrt frame of the paused node (`""` at the top level).
    pub frame: String,
    /// Key to answer this question with in `resume_run`'s `nodeInputs`.
    pub resume_key: String,
    /// The paused step's title from the flow.
    pub step_title: Option<String>,
    /// The rendered `prompt`, if the node has one.
    pub prompt: Option<String>,
    pub fields: Vec<ApprovalField>,
    pub actions: Vec<ApprovalAction>,
    pub timeout_ms: Option<u64>,
    /// When the question expires (RFC 3339); `None` waits until answered.
    pub expires_at: Option<String>,
    /// What happens on expiry; `None` without a deadline.
    pub on_timeout: Option<TimeoutAction>,
    /// The call a `ToolCall` question is about.
    pub tool_call: Option<PendingToolCall>,
    /// Innermost container the node runs in; `None` at the top level.
    pub container: Option<ContainerPosition>,
}

/// An answer already given in this run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnsweredApproval {
    pub node_id: String,
    pub frame: String,
    pub action: String,
    /// Item index when the node runs in a container.
    pub index: Option<u64>,
    pub answered_at: String,
}

/// What screen 19 shows for one run. Keep `src/api/runReviewTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReview {
    pub run_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub trigger: RunTrigger,
    pub status: RunStatus,
    pub started_at: String,
    /// Questions to answer now (empty unless the run is paused on human input or tool approval).
    pub pending: Vec<PendingApproval>,
    /// Pause kinds this screen cannot answer (e.g. an external pause).
    pub other_pause_kinds: Vec<String>,
    pub answered: Vec<AnsweredApproval>,
}

/// Review of one run.
///
/// # Errors
/// `AppError::NotFound` when the run or its agent does not exist; `AppError::Database` when storage fails.
pub fn get_run_review(db: &Database, run_id: &str) -> AppResult<RunReview> {
    let run = db.get_run(run_id)?;
    build_review(db, &run)
}

/// Review of the most recently started run that waits on human input or a tool approval, if any.
///
/// # Errors
/// `AppError::Database` when storage fails.
pub fn latest_pending_review(db: &Database) -> AppResult<Option<RunReview>> {
    let filter = RunFilter { agent_id: None, status: Some(RunStatus::Paused), limit: Some(LATEST_PAUSED_RUNS_LIMIT) };
    let Some(run) = db.list_runs(&filter)?.into_iter().find(waits_on_human_input) else {
        return Ok(None);
    };
    build_review(db, &run).map(Some)
}

fn waits_on_human_input(run: &Run) -> bool {
    pause_reasons(run)
        .iter()
        .any(|reason| matches!(reason_kind(reason), Some(HUMAN_INPUT_PAUSE_KIND | TOOL_APPROVAL_PAUSE_KIND)))
}

fn build_review(db: &Database, run: &Run) -> AppResult<RunReview> {
    let agent = db.get_agent(&run.agent_id)?;
    let steps = read_flow_steps(db, &agent, run.agent_version);
    let snapshot = read_snapshot(db, run);
    let events = db.list_run_events(&run.id)?;
    let mut pending = Vec::new();
    let mut other_pause_kinds = Vec::new();
    if run.status == RunStatus::Paused {
        for reason in pause_reasons(run) {
            match reason_kind(reason) {
                Some(HUMAN_INPUT_PAUSE_KIND) => {
                    pending.extend(read_pending(reason, &steps, snapshot.as_ref()));
                }
                Some(TOOL_APPROVAL_PAUSE_KIND) => {
                    pending.extend(read_tool_call_questions(reason, &steps, snapshot.as_ref()));
                }
                kind => other_pause_kinds.push(kind.unwrap_or("unknown").to_owned()),
            }
        }
    }
    Ok(RunReview {
        run_id: run.id.clone(),
        agent_id: run.agent_id.clone(),
        agent_name: agent.name,
        trigger: run.trigger,
        status: run.status,
        started_at: run.started_at.clone(),
        pending,
        other_pause_kinds,
        answered: read_answered(&events, &steps),
    })
}

/// Steps of the version the run uses, keyed by node id; empty (logged) when the flow cannot be read.
fn read_flow_steps(db: &Database, agent: &Agent, version: i64) -> HashMap<String, FlowStep> {
    let summary = crate::engine::flow_for_version(db, agent, version)
        .and_then(|flow_yaml| crate::flow::summarize_flow(&flow_yaml));
    match summary {
        Ok(summary) => summary.steps.into_iter().map(|step| (step.id.clone(), step)).collect(),
        Err(error) => {
            log::warn!("could not read the flow of agent {} version {version}: {error}", agent.id);
            HashMap::new()
        }
    }
}

/// The paused run's snapshot as JSON; `None` (logged) when it is missing or unreadable.
fn read_snapshot(db: &Database, run: &Run) -> Option<Json> {
    if run.status != RunStatus::Paused {
        return None;
    }
    let parsed =
        db.get_run_snapshot(&run.id).and_then(|text| serde_json::from_str(&text).map_err(crate::error::AppError::from));
    match parsed {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            log::warn!("could not read the snapshot of run {}: {error}", run.id);
            None
        }
    }
}

fn pause_reasons(run: &Run) -> &[Json] {
    run.pause_reasons.as_ref().and_then(Json::as_array).map_or(&[], Vec::as_slice)
}

fn reason_kind(reason: &Json) -> Option<&str> {
    reason.get("kind").and_then(Json::as_str)
}

fn text_field<'a>(value: &'a Json, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Json::as_str)
}

fn read_pending(reason: &Json, steps: &HashMap<String, FlowStep>, snapshot: Option<&Json>) -> Option<PendingApproval> {
    let node_id = text_field(reason, "node_id")?.to_owned();
    let frame = text_field(reason, "frame").unwrap_or_default().to_owned();
    let data = reason.get("data").unwrap_or(&Json::Null);
    let resume_key = resume_key(&frame, &node_id);
    Some(PendingApproval {
        id: resume_key.clone(),
        kind: PendingApprovalKind::Form,
        resume_key,
        step_title: steps.get(&node_id).map(|step| step.title.clone()),
        prompt: text_field(data, "prompt").map(str::to_owned).filter(|prompt| !prompt.trim().is_empty()),
        fields: read_fields(data),
        actions: read_actions(data),
        timeout_ms: data.get("timeout_ms").and_then(Json::as_u64),
        expires_at: text_field(reason, EXPIRES_AT_KEY).map(str::to_owned),
        on_timeout: reason.get(ON_TIMEOUT_KEY).and_then(|choice| serde_json::from_value(choice.clone()).ok()),
        tool_call: None,
        container: read_container(&frame, steps, snapshot),
        node_id,
        frame,
    })
}

/// One Allow / Decline question per call of a `tool_approval` pause (`data.calls[]`).
fn read_tool_call_questions(
    reason: &Json,
    steps: &HashMap<String, FlowStep>,
    snapshot: Option<&Json>,
) -> Vec<PendingApproval> {
    let Some(node_id) = text_field(reason, "node_id") else { return Vec::new() };
    let frame = text_field(reason, "frame").unwrap_or_default();
    let calls = reason.get("data").and_then(|data| data.get("calls")).and_then(Json::as_array);
    let resume_key = resume_key(frame, node_id);
    calls
        .into_iter()
        .flatten()
        .filter_map(|call| {
            let call_id = text_field(call, "id")?.to_owned();
            let tool_call = PendingToolCall {
                name: text_field(call, "name").unwrap_or(&call_id).to_owned(),
                provider: text_field(call, "provider").map(str::to_owned),
                tool: text_field(call, "tool").map(str::to_owned),
                arguments: call.get("arguments").map(redact_secrets).unwrap_or(Json::Null),
                reason: text_field(call, "reason").map(str::to_owned),
                call_id,
            };
            Some(PendingApproval {
                id: format!("{resume_key}#{}", tool_call.call_id),
                kind: PendingApprovalKind::ToolCall,
                node_id: node_id.to_owned(),
                frame: frame.to_owned(),
                resume_key: resume_key.clone(),
                step_title: steps.get(node_id).map(|step| step.title.clone()),
                prompt: None,
                fields: Vec::new(),
                actions: vec![
                    ApprovalAction { id: ALLOW_ACTION_ID.to_owned(), title: "Allow".to_owned() },
                    ApprovalAction { id: DECLINE_ACTION_ID.to_owned(), title: "Decline".to_owned() },
                ],
                timeout_ms: None,
                expires_at: None,
                on_timeout: None,
                tool_call: Some(tool_call),
                container: read_container(frame, steps, snapshot),
            })
        })
        .collect()
}

/// `resume_run` key for a node: frame-qualified inside containers (graphrt prefers it).
pub(crate) fn resume_key(frame: &str, node_id: &str) -> String {
    if frame.is_empty() {
        node_id.to_owned()
    } else {
        format!("{frame}/{node_id}")
    }
}

fn read_fields(data: &Json) -> Vec<ApprovalField> {
    let Some(fields) = data.get("fields").and_then(Json::as_array) else {
        return Vec::new();
    };
    fields
        .iter()
        .filter_map(|field| {
            let name = text_field(field, "name")?.to_owned();
            Some(ApprovalField {
                label: text_field(field, "label").unwrap_or(&name).to_owned(),
                field_type: text_field(field, "type").unwrap_or("text").to_owned(),
                required: field.get("required").and_then(Json::as_bool).unwrap_or(false),
                default_value: field.get("default").cloned().unwrap_or(Json::Null),
                name,
            })
        })
        .collect()
}

fn read_actions(data: &Json) -> Vec<ApprovalAction> {
    let Some(actions) = data.get("actions").and_then(Json::as_array) else {
        return Vec::new();
    };
    actions
        .iter()
        .filter_map(|action| {
            let id = text_field(action, "id")?.to_owned();
            Some(ApprovalAction { title: text_field(action, "title").unwrap_or(&id).to_owned(), id })
        })
        .collect()
}

/// One `owner[index]` segment of a graphrt frame id.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FrameSegment {
    owner: String,
    index: u64,
}

/// `"outer[1]/each[3]"` → `[outer 1, each 3]`; `None` when the id has another shape.
fn parse_frame(frame: &str) -> Option<Vec<FrameSegment>> {
    if frame.is_empty() {
        return Some(Vec::new());
    }
    frame
        .split('/')
        .map(|segment| {
            let (owner, rest) = segment.split_once('[')?;
            let index = rest.strip_suffix(']')?.parse().ok()?;
            Some(FrameSegment { owner: owner.to_owned(), index })
        })
        .collect()
}

fn read_container(
    frame: &str,
    steps: &HashMap<String, FlowStep>,
    snapshot: Option<&Json>,
) -> Option<ContainerPosition> {
    let segments = parse_frame(frame)?;
    let innermost = segments.last()?;
    let step = steps.get(&innermost.owner);
    let node_type = step.map(|step| step.node_type.clone());
    let mut position = ContainerPosition {
        node_id: innermost.owner.clone(),
        node_type: node_type.clone(),
        title: step.map(|step| step.title.clone()),
        index: innermost.index,
        total: None,
        finished: None,
        item: None,
    };
    if node_type.as_deref() == Some(ITERATION_NODE_KIND) {
        if let Some(state) = snapshot.and_then(|snapshot| innermost_container_state(snapshot, &segments)) {
            position.total = state.get("total").and_then(Json::as_u64);
            position.finished = state.get("results").and_then(Json::as_object).map(|results| results.len() as u64);
            position.item = state
                .get("paused")
                .and_then(|paused| paused.get(innermost.index.to_string()))
                .and_then(|child_frame| child_frame.get("pool"))
                .and_then(|pool| pool.get(&innermost.owner))
                .and_then(|namespace| namespace.get("item"))
                .cloned();
        }
    }
    Some(position)
}

/// Walks the snapshot down the frame segments and returns the innermost container's resume state.
fn innermost_container_state<'a>(snapshot: &'a Json, segments: &[FrameSegment]) -> Option<&'a Json> {
    let mut frame = snapshot.get("root")?;
    let (last, outer) = segments.split_last()?;
    for segment in outer {
        frame = container_resume_state(frame, &segment.owner)?.get("paused")?.get(segment.index.to_string())?;
    }
    container_resume_state(frame, &last.owner)
}

fn container_resume_state<'a>(frame: &'a Json, owner: &str) -> Option<&'a Json> {
    frame.get("nodes")?.get(owner)?.get("resume_state")
}

fn read_answered(records: &[RunEventRecord], steps: &HashMap<String, FlowStep>) -> Vec<AnsweredApproval> {
    records
        .iter()
        .filter(|record| text_field(&record.event, "type") == Some("node_succeeded"))
        .filter_map(|record| {
            let event = &record.event;
            let node_id = text_field(event, "node_id")?;
            let is_human_input = steps.get(node_id).is_some_and(|step| step.node_type == HUMAN_INPUT_NODE_KIND);
            if !is_human_input {
                return None;
            }
            let action = event.get("outputs").and_then(|outputs| text_field(outputs, "action"))?;
            let frame = text_field(event, "frame").unwrap_or_default();
            Some(AnsweredApproval {
                node_id: node_id.to_owned(),
                frame: frame.to_owned(),
                action: action.to_owned(),
                index: parse_frame(frame).and_then(|segments| segments.last().map(|segment| segment.index)),
                answered_at: record.created_at.clone(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn frames_parse_into_owner_and_index_segments() {
        assert_eq!(parse_frame(""), Some(vec![]));
        assert_eq!(
            parse_frame("outer[1]/each[3]"),
            Some(vec![
                FrameSegment { owner: "outer".into(), index: 1 },
                FrameSegment { owner: "each".into(), index: 3 }
            ])
        );
        assert_eq!(parse_frame("weird"), None);
        assert_eq!(parse_frame("each[x]"), None);
        assert_eq!(resume_key("", "approve"), "approve");
        assert_eq!(resume_key("each[2]", "approve"), "each[2]/approve");
    }

    #[test]
    fn pending_reads_prompt_fields_actions_and_snapshot_position() {
        let steps: HashMap<String, FlowStep> = [
            FlowStep {
                id: "each".into(),
                node_type: "iteration".into(),
                title: "For each place".into(),
                detail: String::new(),
                needs_approval: false,
                depth: 0,
            },
            FlowStep {
                id: "approve".into(),
                node_type: "human-input".into(),
                title: "Ask me".into(),
                detail: String::new(),
                needs_approval: true,
                depth: 1,
            },
        ]
        .into_iter()
        .map(|step| (step.id.clone(), step))
        .collect();
        let reason = json!({
            "frame": "each[1]",
            "node_id": "approve",
            "kind": "human_input",
            "data": {
                "prompt": "Send to [PLACE]?",
                "fields": [{"name": "message", "label": "Message", "type": "paragraph", "required": true, "default": "Hi"}],
                "actions": [{"id": "send", "title": "Send"}, {"id": "skip"}],
                "timeout_ms": null
            }
        });
        let snapshot = json!({"root": {"nodes": {"each": {"resume_state": {
            "total": 3,
            "results": {"0": {"status": "done", "value": "send"}},
            "paused": {"1": {"pool": {"each": {"item": {"name": "[PLACE]"}, "index": 1}}}}
        }}}}});

        let pending = read_pending(&reason, &steps, Some(&snapshot)).unwrap();
        assert_eq!(pending.resume_key, "each[1]/approve");
        assert_eq!(pending.step_title.as_deref(), Some("Ask me"));
        assert_eq!(pending.prompt.as_deref(), Some("Send to [PLACE]?"));
        assert_eq!(pending.fields[0].field_type, "paragraph");
        assert_eq!(pending.fields[0].default_value, json!("Hi"));
        assert_eq!(
            pending.actions,
            [
                ApprovalAction { id: "send".into(), title: "Send".into() },
                ApprovalAction { id: "skip".into(), title: "skip".into() }
            ]
        );
        let container = pending.container.unwrap();
        assert_eq!(container.title.as_deref(), Some("For each place"));
        assert_eq!((container.index, container.total, container.finished), (1, Some(3), Some(1)));
        assert_eq!(container.item, Some(json!({"name": "[PLACE]"})));
    }

    #[test]
    fn unreadable_snapshot_leaves_position_partial() {
        let reason = json!({"frame": "each[4]", "node_id": "approve", "kind": "human_input", "data": {}});
        let pending = read_pending(&reason, &HashMap::new(), Some(&json!({"root": {}}))).unwrap();
        let container = pending.container.unwrap();
        assert_eq!((container.index, container.total, container.item.clone()), (4, None, None));
        assert!(pending.fields.is_empty() && pending.actions.is_empty() && pending.prompt.is_none());
    }
}
