//! Reading a workflow document for the Nodes view and writing an edited graph back.
//!
//! Nodes and edges go through graphrt-core's own types ([`Workflow`], [`NodeDoc`],
//! whose `config` keeps every node key graphrt does not handle itself), so a
//! node survives a round trip unchanged. Everything outside `graph.nodes` /
//! `graph.edges` (name, description, env, conversation, unknown top-level and
//! graph-level keys) is copied from the raw document as it was. What is lost:
//! YAML comments inside the document (its leading comment block is kept), key
//! spelling graphrt normalizes (`error_strategy` becomes `on_error`, `data`
//! wrappers are flattened), and canvas-only keys graphrt drops (`position`,
//! note nodes).

use std::collections::HashSet;

use graphrt_core::dsl::{EdgeDoc, ErrorStrategy, NodeDoc, NodePolicy, RetryPolicy};
use graphrt_core::graph::SOURCE_HANDLE;
use graphrt_core::{IndexMap, Value, Workflow};
use serde_json::{Map, Value as Json};

use super::model::{EdgeEdit, GraphEdit, NodeEdit, OnErrorStrategy, OnErrorView, RetryView};
use crate::error::{AppError, AppResult};

/// Node keys that are not part of `config` (graphrt reads them itself).
const RESERVED_CONFIG_KEYS: &[&str] = &[
    "id",
    "type",
    "title",
    "parent",
    "parentId",
    "data",
    "on_error",
    "error_strategy",
    "default_value",
    "retry",
    "retry_config",
    "timeout_ms",
    "timeout",
];

/// Container kind → the body marker kind graphrt expects inside it.
const BODY_MARKERS: &[(&str, &str)] = &[("iteration", "iteration-start"), ("loop", "loop-start")];

/// A parsed document: graphrt's view plus the raw top level it came from.
#[derive(Debug, Clone)]
pub(super) struct EditableDocument {
    /// Top-level keys as written (a `workflow` wrapper flattened, like graphrt does).
    raw: Map<String, Json>,
    /// The comment lines before the first key, kept when writing.
    leading_comments: String,
    pub workflow: Workflow,
}

impl EditableDocument {
    /// Parses JSON or YAML the way graphrt does (YAML 1.2 booleans).
    ///
    /// # Errors
    /// `InvalidInput` for a blank document; `Workflow` when graphrt cannot read it.
    pub fn parse(text: &str) -> AppResult<Self> {
        if text.lines().map(str::trim).all(|line| line.is_empty() || line.starts_with('#')) {
            return Err(AppError::InvalidInput("the workflow document is empty".into()));
        }
        let raw_value = parse_raw(text)?;
        let mut workflow =
            Workflow::from_value(raw_value.clone()).map_err(|error| AppError::Workflow(error.to_string()))?;
        let Json::Object(mut raw) = raw_value else {
            return Err(AppError::Workflow("the workflow document must be a mapping".into()));
        };
        if let Some(Json::Object(inner)) = raw.remove("workflow") {
            for (key, value) in inner {
                raw.entry(key).or_insert(value);
            }
        }
        restore_config_order(&mut workflow, &raw);
        Ok(Self { raw, leading_comments: leading_comment_block(text), workflow })
    }

    /// The document with `edit`'s nodes and edges in place of its own, as graphrt types.
    ///
    /// # Errors
    /// `InvalidInput` when a node has no id or kind, uses a reserved config key, or an
    /// id is used twice; `Workflow` when an `on_error` default value is not valid.
    pub fn apply_edit(&self, edit: &GraphEdit) -> AppResult<Workflow> {
        let mut nodes = edit.nodes.iter().map(node_doc_from_edit).collect::<AppResult<Vec<_>>>()?;
        let mut edges: Vec<EdgeDoc> = edit.edges.iter().map(edge_doc_from_edit).collect();
        ensure_unique_ids(&nodes)?;
        ensure_body_markers(&mut nodes, &mut edges);
        let mut workflow = self.workflow.clone();
        workflow.graph.nodes = nodes;
        workflow.graph.edges = edges;
        Ok(workflow)
    }

    /// Writes `workflow`'s nodes and edges into this document and returns it as YAML.
    ///
    /// # Errors
    /// `Workflow` when a node cannot be serialized (reserved key in its config) or
    /// the YAML writer fails.
    pub fn to_yaml(&self, workflow: &Workflow) -> AppResult<String> {
        let mut document = self.raw.clone();
        let mut graph = match document.remove("graph") {
            Some(Json::Object(graph)) => graph,
            _ => Map::new(),
        };
        let nodes =
            serde_json::to_value(&workflow.graph.nodes).map_err(|error| AppError::Workflow(error.to_string()))?;
        graph.insert("nodes".into(), nodes);
        graph.insert("edges".into(), Json::Array(workflow.graph.edges.iter().map(edge_json).collect()));
        document.insert("graph".into(), Json::Object(graph));
        let yaml = serde_saphyr::to_string(&Json::Object(document))
            .map_err(|error| AppError::Workflow(format!("could not write the workflow document: {error}")))?;
        Ok(format!("{}{yaml}", self.leading_comments))
    }
}

fn parse_raw(text: &str) -> AppResult<Json> {
    if text.trim_start().starts_with('{') {
        return serde_json::from_str(text).map_err(|error| AppError::Workflow(error.to_string()));
    }
    // Same options graphrt-core reads YAML with, so both see the same values.
    let options = serde_saphyr::options! { strict_booleans: true };
    serde_saphyr::from_str_with_options(text, options)
        .map_err(|error| AppError::Workflow(format!("invalid YAML workflow document: {error}")))
}

/// Puts each node's config keys back in document order. graphrt removes the keys it
/// handles itself with `swap_remove`, which moves the last key into their place; the
/// written document would otherwise shuffle keys on every save.
fn restore_config_order(workflow: &mut Workflow, raw: &Map<String, Json>) {
    let Some(raw_nodes) = raw.get("graph").and_then(|graph| graph.get("nodes")).and_then(Json::as_array) else {
        return;
    };
    for node in &mut workflow.graph.nodes {
        let raw_node = raw_nodes
            .iter()
            .filter_map(Json::as_object)
            .find(|raw_node| raw_node.get("id").and_then(Json::as_str) == Some(node.id.as_str()));
        let Some(raw_node) = raw_node else { continue };
        let mut config = std::mem::take(&mut node.config);
        let mut ordered = Map::new();
        for key in raw_node.keys() {
            if let Some((key, value)) = config.remove_entry(key) {
                ordered.insert(key, value);
            }
        }
        // Keys that came from a `data` wrapper keep graphrt's order, after the others.
        ordered.extend(config);
        node.config = ordered;
    }
}

/// Comment lines (and blank lines between them) before the document's first key.
fn leading_comment_block(text: &str) -> String {
    let mut block = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            block.push_str(line.trim_end());
            block.push('\n');
        } else if !trimmed.is_empty() {
            break;
        }
    }
    block
}

fn node_doc_from_edit(edit: &NodeEdit) -> AppResult<NodeDoc> {
    let id = edit.id.trim();
    let kind = edit.kind.trim();
    if id.is_empty() || kind.is_empty() {
        return Err(AppError::InvalidInput("every node needs an id and a kind".into()));
    }
    if let Some(key) = edit.config.keys().find(|key| RESERVED_CONFIG_KEYS.contains(&key.as_str())) {
        return Err(AppError::InvalidInput(format!(
            "node `{id}`: `{key}` is set through its own field, not in config"
        )));
    }
    let title = edit.title.as_deref().map(str::trim).filter(|title| !title.is_empty()).map(str::to_owned);
    let parent = edit.parent.as_deref().map(str::trim).filter(|parent| !parent.is_empty()).map(str::to_owned);
    let policy = NodePolicy {
        on_error: error_strategy(&edit.on_error),
        retry: RetryPolicy {
            max_retries: edit.retry.max_retries,
            interval_ms: edit.retry.interval_ms,
            backoff: if edit.retry.backoff.is_finite() { edit.retry.backoff.max(1.0) } else { 1.0 },
        },
        timeout_ms: edit.timeout_ms,
    };
    Ok(NodeDoc { id: id.to_owned(), kind: kind.to_owned(), title, parent, policy, config: edit.config.clone() })
}

fn error_strategy(view: &OnErrorView) -> ErrorStrategy {
    match view.strategy {
        OnErrorStrategy::Fail => ErrorStrategy::Fail,
        OnErrorStrategy::FailBranch => ErrorStrategy::FailBranch,
        OnErrorStrategy::DefaultValue => ErrorStrategy::DefaultValue {
            values: view
                .values
                .iter()
                .map(|(key, value)| (key.clone(), Value::from_json(value.clone())))
                .collect::<IndexMap<_, _>>(),
        },
    }
}

/// The UI form of a node's `on_error`.
pub(super) fn on_error_view(strategy: &ErrorStrategy) -> OnErrorView {
    match strategy {
        ErrorStrategy::FailBranch => OnErrorView { strategy: OnErrorStrategy::FailBranch, values: Map::new() },
        ErrorStrategy::DefaultValue { values } => OnErrorView {
            strategy: OnErrorStrategy::DefaultValue,
            values: values.iter().map(|(key, value)| (key.clone(), value.to_json())).collect(),
        },
        _ => OnErrorView::default(),
    }
}

/// The UI form of a node's `retry`.
pub(super) fn retry_view(retry: &RetryPolicy) -> RetryView {
    RetryView { max_retries: retry.max_retries, interval_ms: retry.interval_ms, backoff: retry.backoff }
}

fn edge_doc_from_edit(edit: &EdgeEdit) -> EdgeDoc {
    let handle = edit
        .source_handle
        .as_deref()
        .map(str::trim)
        .filter(|handle| !handle.is_empty() && *handle != SOURCE_HANDLE)
        .map(str::to_owned);
    let id = edit.document_id.as_deref().map(str::trim).filter(|id| !id.is_empty()).map(str::to_owned);
    EdgeDoc { id, source: edit.source.trim().to_owned(), target: edit.target.trim().to_owned(), handle }
}

/// `{source, target, handle?, id?}`: the compact edge form the builder writes.
fn edge_json(edge: &EdgeDoc) -> Json {
    let mut map = Map::new();
    map.insert("source".into(), Json::String(edge.source.clone()));
    map.insert("target".into(), Json::String(edge.target.clone()));
    if let Some(handle) = edge.handle.as_deref().filter(|handle| *handle != SOURCE_HANDLE) {
        map.insert("handle".into(), Json::String(handle.to_owned()));
    }
    if let Some(id) = &edge.id {
        map.insert("id".into(), Json::String(id.clone()));
    }
    Json::Object(map)
}

fn ensure_unique_ids(nodes: &[NodeDoc]) -> AppResult<()> {
    let mut seen = HashSet::new();
    match nodes.iter().find(|node| !seen.insert(node.id.as_str())) {
        Some(node) => Err(AppError::InvalidInput(format!("two nodes are called `{}`", node.id))),
        None => Ok(()),
    }
}

/// Gives every iteration / loop container its hidden body marker (`<id>_start`)
/// when it has none, and connects a marker without arrows to the body steps that
/// have no incoming arrow, so a step dropped into an empty body runs first.
pub(super) fn ensure_body_markers(nodes: &mut Vec<NodeDoc>, edges: &mut Vec<EdgeDoc>) {
    let containers: Vec<(String, &str)> = nodes
        .iter()
        .filter_map(|node| {
            let marker_kind = BODY_MARKERS.iter().find(|(kind, _)| *kind == node.kind).map(|(_, marker)| *marker)?;
            Some((node.id.clone(), marker_kind))
        })
        .collect();
    for (container_id, marker_kind) in containers {
        let marker_id = match nodes
            .iter()
            .find(|node| node.kind == marker_kind && node.parent.as_deref() == Some(container_id.as_str()))
        {
            Some(marker) => marker.id.clone(),
            None => insert_marker(nodes, &container_id, marker_kind),
        };
        connect_marker(nodes, edges, &container_id, &marker_id);
    }
}

fn insert_marker(nodes: &mut Vec<NodeDoc>, container_id: &str, marker_kind: &str) -> String {
    let taken: HashSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
    let mut marker_id = format!("{container_id}_start");
    let mut suffix = 2;
    while taken.contains(marker_id.as_str()) {
        marker_id = format!("{container_id}_start_{suffix}");
        suffix += 1;
    }
    let marker = NodeDoc::new(marker_id.clone(), marker_kind, Json::Object(Map::new())).with_parent(container_id);
    let insert_at = nodes.iter().position(|node| node.id == container_id).map_or(nodes.len(), |index| index + 1);
    nodes.insert(insert_at, marker);
    marker_id
}

fn connect_marker(nodes: &[NodeDoc], edges: &mut Vec<EdgeDoc>, container_id: &str, marker_id: &str) {
    if edges.iter().any(|edge| edge.source == marker_id) {
        return;
    }
    let body_roots: Vec<String> = nodes
        .iter()
        .filter(|node| node.parent.as_deref() == Some(container_id) && node.id != marker_id)
        .filter(|node| !edges.iter().any(|edge| edge.target == node.id))
        .map(|node| node.id.clone())
        .collect();
    edges.extend(body_roots.into_iter().map(|root| EdgeDoc::new(marker_id, root)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leading_comments_are_kept_and_inner_ones_are_not() {
        let text = "# One\n#\n# Two\nversion: \"1\"\n# inner\ngraph: {}\n";
        assert_eq!(leading_comment_block(text), "# One\n#\n# Two\n");
    }

    #[test]
    fn a_container_without_marker_gets_one_connected_to_its_body() {
        let mut nodes = vec![
            NodeDoc::new("each", "iteration", serde_json::json!({})),
            NodeDoc::new("write", "llm", serde_json::json!({})).with_parent("each"),
            NodeDoc::new("send", "http-request", serde_json::json!({})).with_parent("each"),
        ];
        let mut edges = vec![EdgeDoc::new("write", "send")];
        ensure_body_markers(&mut nodes, &mut edges);

        let ids: Vec<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
        assert_eq!(ids, ["each", "each_start", "write", "send"]);
        assert_eq!(nodes[1].kind, "iteration-start");
        assert_eq!(nodes[1].parent.as_deref(), Some("each"));
        assert!(edges.iter().any(|edge| edge.source == "each_start" && edge.target == "write"));
        assert!(!edges.iter().any(|edge| edge.source == "each_start" && edge.target == "send"));
    }

    #[test]
    fn existing_markers_are_left_alone() {
        let mut nodes = vec![
            NodeDoc::new("again", "loop", serde_json::json!({})),
            NodeDoc::new("again_begin", "loop-start", serde_json::json!({})).with_parent("again"),
            NodeDoc::new("step", "llm", serde_json::json!({})).with_parent("again"),
        ];
        let mut edges = vec![EdgeDoc::new("again_begin", "step")];
        ensure_body_markers(&mut nodes, &mut edges);
        assert_eq!(nodes.len(), 3);
        assert_eq!(edges.len(), 1);
    }

    #[test]
    fn reserved_config_keys_and_repeated_ids_are_rejected() {
        let node = |id: &str, config: Json| NodeEdit {
            id: id.into(),
            kind: "llm".into(),
            title: None,
            parent: None,
            config: config.as_object().cloned().unwrap_or_default(),
            on_error: OnErrorView::default(),
            retry: RetryView::default(),
            timeout_ms: None,
        };
        assert!(matches!(
            node_doc_from_edit(&node("a", serde_json::json!({ "retry": {} }))),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(node_doc_from_edit(&node(" ", serde_json::json!({}))), Err(AppError::InvalidInput(_))));
        let docs = vec![node_doc_from_edit(&node("a", serde_json::json!({}))).unwrap(); 2];
        assert!(matches!(ensure_unique_ids(&docs), Err(AppError::InvalidInput(_))));
    }
}
