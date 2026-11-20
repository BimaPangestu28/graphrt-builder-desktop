//! Checks the product promise "it asks you before anything is sent": every step
//! that sends data out must sit behind a `human-input` step on every path that
//! reaches it.
//!
//! A step "sends data out" when it is an `http-request` with a writing method
//! (POST, PUT, PATCH, DELETE). Reading steps (GET search calls) need no approval.
//!
//! The check walks backwards from each sending step along incoming edges and
//! stops at `human-input` nodes. Reaching a scope entry (e.g. `iteration-start`)
//! continues from the container that owns the scope, so an approval placed
//! before a loop also covers the steps inside it. Reaching the workflow entry
//! without passing an approval means the step is unprotected.

use std::collections::HashSet;

use graphrt_core::graph::{GraphNode, NodeIx};
use graphrt_core::Graph;
use serde_json::Value as Json;

const APPROVAL_KIND: &str = "human-input";
const WRITING_METHODS: &[&str] = &["POST", "PUT", "PATCH", "DELETE"];

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
    if crate::plugins::is_sending_plugin_kind(kind) {
        return true;
    }
    if kind != "http-request" {
        return false;
    }
    let method = config.get("method").and_then(Json::as_str).unwrap_or("GET");
    WRITING_METHODS.iter().any(|writing_method| method.eq_ignore_ascii_case(writing_method))
}

fn unapproved_sending_nodes(graph: &Graph) -> Vec<&GraphNode> {
    (0..graph.nodes().len())
        .filter_map(|node_index| graph.node(node_index).map(|node| (node_index, node)))
        .filter(|(_, node)| is_sending_step(node))
        .filter(|(node_index, _)| reachable_without_approval(graph, *node_index))
        .map(|(_, node)| node)
        .collect()
}

fn is_sending_step(node: &GraphNode) -> bool {
    // Plugin steps that send or change something (`whatsapp-api.send_text`) count too.
    is_sending_kind(&node.kind, &node.doc.config)
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
