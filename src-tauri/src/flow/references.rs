//! Steps that read the output of a step that never runs before them.
//!
//! graphrt compiles a document whose step reads `{{#answer_hours.text#}}` even when
//! no path runs `answer_hours` first: the value is then simply empty at run time. A
//! chatbot built like that answers nothing at all (its `answer` step renders an empty
//! text), so the builder sends such a draft back to the model to fix.
//!
//! A step may read another step when that step is one of its ancestors: reachable by
//! walking backwards along incoming edges, where a scope entry (e.g.
//! `iteration-start`) continues from the container that owns the scope, like the
//! approval check in [`super::approval`]. Only top-level steps are checked as the step
//! being read: steps inside a container are left alone, their outputs reach the
//! outside through the container. References to `sys`, `env`, `conversation` and other
//! names that are not steps are ignored, and so is a step that nothing leads to.

use std::collections::HashSet;

use graphrt_core::graph::NodeIx;
use graphrt_core::Graph;
use serde_json::{Map, Value as Json};

/// One step reading a step that does not run before it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnrunReference {
    /// Id of the step that reads.
    pub reader_id: String,
    /// Id of the step it reads, which never runs before it.
    pub read_id: String,
}

impl UnrunReference {
    /// The repair message for the model.
    pub fn message(&self) -> String {
        format!(
            "step `{reader}` reads `{read}`, but `{read}` never runs before `{reader}` on any path, so the value is \
             empty",
            reader = self.reader_id,
            read = self.read_id
        )
    }
}

/// Every step of `graph` that reads (`{{#id.…#}}` or an `[id, output]` selector) a
/// top-level step that is not one of its ancestors, each pair once, in node order.
pub(super) fn unrun_references(graph: &Graph) -> Vec<UnrunReference> {
    let mut found = Vec::new();
    for reader_index in 0..graph.nodes().len() {
        let Some(reader) = graph.node(reader_index) else {
            continue;
        };
        let mut read_ids: Vec<String> = Vec::new();
        collect_read_ids(&reader.doc.config, &mut read_ids);
        if read_ids.is_empty() {
            continue;
        }
        let ancestors = ancestors_of(graph, reader_index);
        // A step nothing leads to never runs itself (e.g. a model step the draft left
        // unconnected): what reads *its* output is the finding, not what it reads.
        if ancestors.is_empty() {
            continue;
        }
        for read_id in read_ids {
            let Some(read_index) = graph.index_of(&read_id) else {
                continue;
            };
            let is_top_level = graph.node(read_index).is_some_and(|node| node.parent.is_none());
            if read_index != reader_index && is_top_level && !ancestors.contains(&read_index) {
                found.push(UnrunReference { reader_id: reader.id.to_string(), read_id });
            }
        }
    }
    found
}

/// Node ids named by the references in `config`, each once, in order of appearance.
fn collect_read_ids(config: &Map<String, Json>, read_ids: &mut Vec<String>) {
    for value in config.values() {
        collect_from_value(value, read_ids);
    }
}

fn collect_from_value(value: &Json, read_ids: &mut Vec<String>) {
    match value {
        Json::String(text) => {
            for node_id in super::sending::referenced_node_ids(text) {
                push_once(read_ids, node_id);
            }
        }
        Json::Array(items) => {
            let is_selector = items.len() >= 2 && items.iter().all(Json::is_string);
            if let (true, Some(node_id)) = (is_selector, items.first().and_then(Json::as_str)) {
                push_once(read_ids, node_id);
            }
            for item in items {
                collect_from_value(item, read_ids);
            }
        }
        Json::Object(fields) => {
            for field in fields.values() {
                collect_from_value(field, read_ids);
            }
        }
        _ => {}
    }
}

fn push_once(read_ids: &mut Vec<String>, node_id: &str) {
    if !read_ids.iter().any(|known| known == node_id) {
        read_ids.push(node_id.to_owned());
    }
}

/// Nodes that run before `target` on some path (walking incoming edges, and from a
/// scope entry on to its container).
fn ancestors_of(graph: &Graph, target: NodeIx) -> HashSet<NodeIx> {
    let mut visited = HashSet::new();
    let mut pending = vec![target];
    while let Some(node_index) = pending.pop() {
        if !visited.insert(node_index) {
            continue;
        }
        let predecessors: Vec<NodeIx> = graph
            .incoming(node_index)
            .iter()
            .filter_map(|&edge_index| graph.edge(edge_index))
            .map(|edge| edge.source)
            .collect();
        if predecessors.is_empty() {
            if let Some(container) = graph.node(node_index).and_then(|node| node.parent) {
                pending.push(container);
            }
        } else {
            pending.extend(predecessors);
        }
    }
    visited.remove(&target);
    visited
}
