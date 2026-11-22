//! Checks the product promise "it asks you before anything is sent": every step
//! that sends data out must sit behind a `human-input` step on every path that
//! reaches it.
//!
//! Which steps "send data out" is decided in [`super::sending`]: writing HTTP
//! methods, HTTP requests that carry values, plugin and tool steps that send,
//! and agents with sending tools they do not ask about first.
//!
//! The check walks backwards from each sending step along incoming edges and
//! stops at `human-input` nodes. Reaching a scope entry (e.g. `iteration-start`)
//! continues from the container that owns the scope, so an approval placed
//! before a loop also covers the steps inside it. Reaching the workflow entry
//! without passing an approval means the step is unprotected.
//!
//! An approval only protects when a person answers it: an approval whose
//! `on_timeout` answers with a button that leads to a sending step (without
//! another approval in between) sends without asking once the time runs out.
//! [`timeouts_that_send`] finds those; only `on_timeout: stop` or a button
//! that does not lead to a send is allowed.

use std::collections::HashSet;

use graphrt_core::graph::{GraphNode, NodeIx};
use graphrt_core::Graph;
use serde_json::Value as Json;

const APPROVAL_KIND: &str = "human-input";
const ON_TIMEOUT_KEY: &str = "on_timeout";
const STOP_ON_TIMEOUT: &str = "stop";
/// The button graphrt's `human-input` node offers when the step sets none.
const DEFAULT_ACTION: &str = "submit";

/// What an approval step's `on_timeout` setting says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TimeoutChoice {
    /// `on_timeout: stop`, or no setting: the run stops.
    Stop,
    /// Answer with this button of the step.
    Answer(String),
    /// Names something that is not a button of the step (the run stops).
    UnknownAction,
}

/// An approval step whose time limit answers with a button that leads to a send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TimeoutSend {
    pub approval_node_id: String,
    pub approval_label: String,
    pub action: String,
    /// Title (or id) of the first sending step that button leads to.
    pub sending_step_label: String,
}

/// Titles (or ids) of sending steps that some path reaches without an approval.
pub(super) fn unapproved_sending_steps(graph: &Graph) -> Vec<String> {
    unapproved_sending_nodes(graph).into_iter().map(step_label).collect()
}

/// Node ids of the sending steps that some path reaches without an approval.
pub(super) fn unapproved_sending_node_ids(graph: &Graph) -> Vec<String> {
    unapproved_sending_nodes(graph).into_iter().map(|node| node.id.to_string()).collect()
}

/// Whether a node kind (with its config) sends data out, so it must sit behind an approval.
pub(super) fn is_sending_kind(kind: &str, config: &serde_json::Map<String, Json>) -> bool {
    super::sending::is_sending_kind(kind, config)
}

/// `on_timeout: stop`, `on_timeout: { action: <id> }` or `on_timeout: <id>` of a `human-input` config.
pub(crate) fn read_timeout_choice(config: &serde_json::Map<String, Json>) -> TimeoutChoice {
    let action_id = match config.get(ON_TIMEOUT_KEY) {
        None | Some(Json::Null) => return TimeoutChoice::Stop,
        Some(Json::String(text)) if text.trim() == STOP_ON_TIMEOUT => return TimeoutChoice::Stop,
        Some(Json::String(text)) => Some(text.as_str()),
        Some(Json::Object(choice)) => choice.get("action").and_then(Json::as_str),
        Some(_) => None,
    };
    match action_id {
        Some(action_id) if read_action_ids(config).iter().any(|known_id| known_id == action_id) => {
            TimeoutChoice::Answer(action_id.to_owned())
        }
        _ => TimeoutChoice::UnknownAction,
    }
}

/// Button ids of a `human-input` step; graphrt adds `submit` when none are set.
fn read_action_ids(config: &serde_json::Map<String, Json>) -> Vec<String> {
    let action_ids: Vec<String> = config
        .get("actions")
        .and_then(Json::as_array)
        .map(|actions| {
            actions.iter().filter_map(|action| action.get("id").and_then(Json::as_str).map(str::to_owned)).collect()
        })
        .unwrap_or_default();
    if action_ids.is_empty() {
        vec![DEFAULT_ACTION.to_owned()]
    } else {
        action_ids
    }
}

/// Approval steps whose `on_timeout` answer leads to a sending step.
pub(crate) fn timeouts_that_send(graph: &Graph) -> Vec<TimeoutSend> {
    (0..graph.nodes().len())
        .filter_map(|node_index| graph.node(node_index).map(|node| (node_index, node)))
        .filter(|(_, node)| node.kind == APPROVAL_KIND)
        .filter_map(|(node_index, node)| {
            let TimeoutChoice::Answer(action) = read_timeout_choice(&node.doc.config) else { return None };
            let sending_step = first_send_after_action(graph, node_index, &action)?;
            Some(TimeoutSend {
                approval_node_id: node.id.to_string(),
                approval_label: step_label(node),
                action,
                sending_step_label: step_label(sending_step),
            })
        })
        .collect()
}

/// The first sending step reached forwards from the `action` exit of `approval`,
/// stopping at other approvals (they are checked on their own). Entering a loop
/// visits its body; any step inside a loop also continues after the loop.
fn first_send_after_action<'graph>(graph: &'graph Graph, approval: NodeIx, action: &str) -> Option<&'graph GraphNode> {
    let unvetted = super::sending::unvetted_output_node_ids(graph);
    let mut pending: Vec<NodeIx> = targets_of(graph, approval, Some(action));
    let mut visited = HashSet::new();
    while let Some(node_index) = pending.pop() {
        if !visited.insert(node_index) {
            continue;
        }
        let node = graph.node(node_index)?;
        if node.kind == APPROVAL_KIND {
            continue;
        }
        if is_sending_step(node, &unvetted) {
            return Some(node);
        }
        pending.extend(targets_of(graph, node_index, None));
        if let Some(scope) = graph.scope_of(node_index) {
            pending.extend(scope.nodes.iter().copied());
        }
        if let Some(container) = node.parent {
            pending.extend(targets_of(graph, container, None));
        }
    }
    None
}

/// Targets of the edges leaving `node_index`, only those of exit `handle` when given.
fn targets_of(graph: &Graph, node_index: NodeIx, handle: Option<&str>) -> Vec<NodeIx> {
    graph
        .outgoing(node_index)
        .iter()
        .filter_map(|&edge_index| graph.edge(edge_index))
        .filter(|edge| handle.is_none_or(|handle| &*edge.handle == handle))
        .map(|edge| edge.target)
        .collect()
}

fn unapproved_sending_nodes(graph: &Graph) -> Vec<&GraphNode> {
    let unvetted = super::sending::unvetted_output_node_ids(graph);
    (0..graph.nodes().len())
        .filter_map(|node_index| graph.node(node_index).map(|node| (node_index, node)))
        .filter(|(_, node)| is_sending_step(node, &unvetted))
        .filter(|(node_index, _)| reachable_without_approval(graph, *node_index))
        .map(|(_, node)| node)
        .collect()
}

/// A sending kind, or a step reaching outside that passes on `unvetted` output (see [`super::sending`]).
fn is_sending_step(node: &GraphNode, unvetted: &HashSet<String>) -> bool {
    is_sending_kind(&node.kind, &node.doc.config)
        || super::sending::passes_on_unvetted_output(&node.kind, &node.doc.config, unvetted)
}

/// True when walking backwards from `target` can reach the workflow entry
/// without passing a `human-input` node.
fn reachable_without_approval(graph: &Graph, target: NodeIx) -> bool {
    let mut pending = vec![target];
    let mut visited = HashSet::new();
    while let Some(node_index) = pending.pop() {
        if !visited.insert(node_index) {
            continue;
        }
        let Some(node) = graph.node(node_index) else {
            continue;
        };
        if node_index != target && node.kind == APPROVAL_KIND {
            continue;
        }
        let predecessors: Vec<NodeIx> = graph
            .incoming(node_index)
            .iter()
            .filter_map(|&edge_index| graph.edge(edge_index))
            .map(|edge| edge.source)
            .collect();
        if !predecessors.is_empty() {
            pending.extend(predecessors);
            continue;
        }
        // No incoming edge: either a scope entry (keep walking from its
        // container) or the workflow entry (an unprotected path).
        match node.parent {
            Some(container) => pending.push(container),
            None => return true,
        }
    }
    false
}

fn step_label(node: &GraphNode) -> String {
    node.doc
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map_or_else(|| node.id.to_string(), str::to_owned)
}
