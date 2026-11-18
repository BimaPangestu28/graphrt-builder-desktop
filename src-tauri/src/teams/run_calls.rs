//! Reads, from a team run's stored events, which member agents it called.
//!
//! Nested agent runs are not recorded as runs (`engine::agent_tools`); the
//! caller's events hold the calls instead:
//! - an `agent` node emits `node_progress` events `tool_call`
//!   (`{id, name, arguments}`) and `tool_result` (`{id, name, is_error}`),
//!   where `name` is the tool name shown to the model: the member's agent id,
//!   or `agents_<id>` when that name was taken;
//! - a `tool` node calling the `agents` provider has `node_started` and
//!   `node_succeeded` / `node_failed` events; which agent it calls comes from
//!   the node's config in the run's flow version.

use std::collections::HashMap;

use serde_json::Value as Json;

use crate::agent_steps::references::node_references;
use crate::agent_steps::AGENT_TOOL_PROVIDER;
use crate::flow;
use crate::storage::models::RunEventRecord;

/// Longest task text kept from a call's arguments, in characters.
const MAX_TASK_CHARS: usize = 120;

/// How a member call ended, as far as the events tell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallOutcome {
    /// No result event yet (the run is still going, or stopped mid-call).
    Pending,
    Succeeded,
    Failed(Option<String>),
}

/// One call from the team to a member agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberCall {
    pub member_agent_id: String,
    /// What it was asked: the first text argument, shortened. Empty when none.
    pub task: String,
    pub called_at: String,
    pub finished_at: Option<String>,
    pub outcome: CallOutcome,
}

/// `tool` node id → called agent id, for the nodes of `flow_yaml` that call one agent.
pub fn tool_node_agents(flow_yaml: &str) -> HashMap<String, String> {
    let Ok(graph) = flow::compile_flow(flow_yaml) else { return HashMap::new() };
    graph
        .nodes()
        .iter()
        .filter(|node| node.kind == "tool")
        .filter_map(|node| {
            let references = node_references(node);
            match references.agent_ids.as_slice() {
                [agent_id] => Some((node.id.to_string(), agent_id.clone())),
                _ => None,
            }
        })
        .collect()
}

/// The member calls in `events`, in call order. `known_agent_ids` are the
/// agents that exist; tool calls to anything else (plugins) are ignored.
pub fn member_calls(
    events: &[RunEventRecord],
    tool_nodes: &HashMap<String, String>,
    known_agent_ids: &[String],
) -> Vec<MemberCall> {
    let mut calls: Vec<MemberCall> = Vec::new();
    // Open calls by agent-node call id, or by tool node id.
    let mut open_calls: HashMap<String, usize> = HashMap::new();
    for record in events {
        let event = &record.event;
        let node_id = text_field(event, "node_id").unwrap_or_default();
        match text_field(event, "type").unwrap_or_default() {
            "node_progress" => {
                let data = event.get("data").unwrap_or(&Json::Null);
                let call_id = text_field(data, "id").unwrap_or_default().to_owned();
                match text_field(event, "name").unwrap_or_default() {
                    "tool_call" => {
                        let Some(agent_id) =
                            text_field(data, "name").and_then(|name| resolve_tool_name(name, known_agent_ids))
                        else {
                            continue;
                        };
                        open_calls.insert(format!("call:{call_id}"), calls.len());
                        calls.push(new_call(agent_id, data.get("arguments"), &record.created_at));
                    }
                    "tool_result" => {
                        if let Some(index) = open_calls.remove(&format!("call:{call_id}")) {
                            let is_error = data.get("is_error").and_then(Json::as_bool).unwrap_or(false);
                            finish_call(&mut calls[index], !is_error, None, &record.created_at);
                        }
                    }
                    _ => {}
                }
            }
            "node_started" => {
                if let Some(agent_id) = tool_nodes.get(node_id) {
                    open_calls.insert(format!("node:{node_id}"), calls.len());
                    calls.push(new_call(agent_id.clone(), None, &record.created_at));
                }
            }
            "node_succeeded" | "node_failed" => {
                if let Some(index) = open_calls.remove(&format!("node:{node_id}")) {
                    let tool_failed = event.pointer("/outputs/is_error").and_then(Json::as_bool).unwrap_or(false);
                    let succeeded = text_field(event, "type") == Some("node_succeeded") && !tool_failed;
                    let error = text_field(event, "error").map(str::to_owned);
                    finish_call(&mut calls[index], succeeded, error, &record.created_at);
                }
            }
            _ => {}
        }
    }
    calls
}

/// The run's start inputs: the outputs of its `start` node.
pub fn start_inputs(events: &[RunEventRecord]) -> Option<serde_json::Map<String, Json>> {
    let start_node_id = events.iter().find_map(|record| {
        let event = &record.event;
        (text_field(event, "type") == Some("node_started") && text_field(event, "kind") == Some("start"))
            .then(|| text_field(event, "node_id"))
            .flatten()
    })?;
    events.iter().find_map(|record| {
        let event = &record.event;
        (text_field(event, "type") == Some("node_succeeded") && text_field(event, "node_id") == Some(start_node_id))
            .then(|| event.get("outputs").and_then(Json::as_object).cloned())
            .flatten()
    })
}

fn text_field<'a>(value: &'a Json, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Json::as_str)
}

fn resolve_tool_name(tool_name: &str, known_agent_ids: &[String]) -> Option<String> {
    let prefixed = format!("{AGENT_TOOL_PROVIDER}_");
    known_agent_ids
        .iter()
        .find(|agent_id| tool_name == agent_id.as_str() || tool_name.strip_prefix(&prefixed) == Some(agent_id.as_str()))
        .cloned()
}

fn new_call(member_agent_id: String, arguments: Option<&Json>, called_at: &str) -> MemberCall {
    MemberCall {
        member_agent_id,
        task: arguments.map(first_text_argument).unwrap_or_default(),
        called_at: called_at.to_owned(),
        finished_at: None,
        outcome: CallOutcome::Pending,
    }
}

fn finish_call(call: &mut MemberCall, succeeded: bool, error: Option<String>, finished_at: &str) {
    call.outcome = if succeeded { CallOutcome::Succeeded } else { CallOutcome::Failed(error) };
    call.finished_at = Some(finished_at.to_owned());
}

fn first_text_argument(arguments: &Json) -> String {
    let text =
        arguments.as_object().and_then(|fields| fields.values().find_map(Json::as_str)).unwrap_or_default().trim();
    shorten(text, MAX_TASK_CHARS)
}

/// `text` cut to `max_chars` characters, with an ellipsis when cut.
pub fn shorten(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}
