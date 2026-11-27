//! Builds a [`FlowSummary`] from a compiled graphrt [`Graph`].
//!
//! Steps follow each scope's topological (execution) order, which graphrt
//! derives from the edges; a container's body is listed right after the
//! container, one level deeper. Nodes not covered by any scope (should not
//! happen for a compiled graph) are appended in document order.

use std::collections::{BTreeSet, HashSet};

use graphrt_core::graph::{GraphNode, NodeIx};
use graphrt_core::Graph;
use serde_json::{Map, Value as Json};

use super::{FlowEnvVar, FlowInput, FlowStep, FlowSummary};

/// Bookkeeping node kinds that are not shown as steps.
const HIDDEN_KINDS: &[&str] = &["start", "end", "iteration-start", "loop-start", "loop-end"];
/// Kinds that read a `model: {provider, name}` block.
const MODEL_KINDS: &[&str] = &["llm", "agent", "question-classifier", "parameter-extractor"];
/// Maximum length of a prompt excerpt, in characters.
const EXCERPT_CHARS: usize = 80;

/// Summarizes a compiled graph: steps, start inputs and model providers.
pub(super) fn summarize_graph(graph: &Graph) -> FlowSummary {
    FlowSummary {
        steps: collect_steps(graph),
        inputs: collect_inputs(graph),
        model_providers: collect_model_providers(graph),
        env: collect_env(graph),
    }
}

/// The workflow's `env` declarations.
fn collect_env(graph: &Graph) -> Vec<FlowEnvVar> {
    graph
        .workflow()
        .env
        .iter()
        .map(|declaration| FlowEnvVar {
            name: declaration.name.clone(),
            description: declaration.description.clone().filter(|text| !text.trim().is_empty()),
            is_secret: declaration.ty == graphrt_core::ValueType::Secret,
            has_default: declaration.value.as_ref().is_some_and(|value| !value.is_null()),
        })
        .collect()
}

fn collect_steps(graph: &Graph) -> Vec<FlowStep> {
    let mut steps = Vec::new();
    let mut visited = HashSet::new();
    if let Some(root) = graph.root_scope() {
        append_scope_steps(graph, &root.nodes, 0, &mut visited, &mut steps);
    }
    let remaining: Vec<NodeIx> = (0..graph.nodes().len()).filter(|ix| !visited.contains(ix)).collect();
    for node_index in remaining {
        if let Some(node) = graph.node(node_index) {
            push_step(graph, node, &mut visited, node_index, &mut steps);
        }
    }
    steps
}

fn append_scope_steps(
    graph: &Graph,
    scope_nodes: &[NodeIx],
    depth: u32,
    visited: &mut HashSet<NodeIx>,
    steps: &mut Vec<FlowStep>,
) {
    for &node_index in scope_nodes {
        if !visited.insert(node_index) {
            continue;
        }
        let Some(node) = graph.node(node_index) else {
            continue;
        };
        if !HIDDEN_KINDS.contains(&&*node.kind) {
            steps.push(build_step(node, depth));
        }
        if let Some(body) = graph.scope_of(node_index) {
            append_scope_steps(graph, &body.nodes, depth + 1, visited, steps);
        }
    }
}

/// Adds a node that no scope listed, at the depth implied by its parents.
fn push_step(
    graph: &Graph,
    node: &GraphNode,
    visited: &mut HashSet<NodeIx>,
    node_index: NodeIx,
    steps: &mut Vec<FlowStep>,
) {
    visited.insert(node_index);
    if HIDDEN_KINDS.contains(&&*node.kind) {
        return;
    }
    let mut depth = 0;
    let mut parent = node.parent;
    while let Some(parent_index) = parent {
        depth += 1;
        parent = graph.node(parent_index).and_then(|parent_node| parent_node.parent);
    }
    steps.push(build_step(node, depth));
}

fn build_step(node: &GraphNode, depth: u32) -> FlowStep {
    let config = &node.doc.config;
    let title = node
        .doc
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map_or_else(|| fallback_title(&node.kind), str::to_owned);
    FlowStep {
        id: node.id.to_string(),
        node_type: node.kind.to_string(),
        title,
        detail: step_detail(&node.kind, config),
        needs_approval: step_needs_approval(&node.kind, config),
        depth,
    }
}

/// Readable label for a node type without a title.
pub(super) fn fallback_title(kind: &str) -> String {
    let label = match kind {
        "llm" => "Ask a model",
        "agent" => "Run an agent",
        "question-classifier" => "Sort into categories",
        "parameter-extractor" => "Pull out details",
        "http-request" => "HTTP request",
        "human-input" => "Ask me before continuing",
        "iteration" => "For each item",
        "loop" => "Repeat",
        "if-else" => "Check a condition",
        "template-transform" => "Format text",
        "variable-aggregator" => "Combine results",
        "assigner" | "variable-assigner" => "Remember a value",
        "list-operator" => "Filter a list",
        "answer" => "Reply",
        "tool" => "Use a tool",
        "code" => "Run code",
        other => return humanize_kind(other),
    };
    label.to_owned()
}

/// `some-node_kind` -> `Some node kind`.
fn humanize_kind(kind: &str) -> String {
    let words = kind.replace(['-', '_'], " ");
    let mut characters = words.trim().chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => "Step".to_owned(),
    }
}

pub(super) fn step_detail(kind: &str, config: &Map<String, Json>) -> String {
    if MODEL_KINDS.contains(&kind) {
        if let Some(model_name) = model_field(config, "name") {
            return model_name.to_owned();
        }
    }
    match kind {
        "http-request" => http_detail(config),
        "iteration" => selector_detail(config.get("iterator_selector")).map(|path| format!("over {path}")),
        "tool" => tool_detail(config),
        _ => first_text(config, &["prompt", "instruction", "query", "answer", "template"]),
    }
    .unwrap_or_default()
}

fn model_field<'a>(config: &'a Map<String, Json>, field: &str) -> Option<&'a str> {
    config.get("model")?.get(field)?.as_str().map(str::trim).filter(|value| !value.is_empty())
}

/// `POST example.com`.
fn http_detail(config: &Map<String, Json>) -> Option<String> {
    let method = config.get("method").and_then(Json::as_str).unwrap_or("get").to_uppercase();
    let url = config.get("url").and_then(Json::as_str)?;
    Some(format!("{method} {}", url_host(url)))
}

/// Host part of a URL, or the URL itself when it has no recognizable host.
fn url_host(url: &str) -> &str {
    let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = without_scheme.split(['/', '?', '#']).next().unwrap_or(without_scheme);
    if host.is_empty() {
        url
    } else {
        host
    }
}

fn tool_detail(config: &Map<String, Json>) -> Option<String> {
    let provider = config.get("provider_id").and_then(Json::as_str)?;
    let tool = config.get("tool_name").and_then(Json::as_str).unwrap_or_default();
    Some(format!("{provider}/{tool}"))
}

/// `[node, output, key]` or `"node.output.key"` -> `node.output.key`.
fn selector_detail(selector: Option<&Json>) -> Option<String> {
    match selector? {
        Json::String(path) => Some(path.clone()),
        Json::Array(parts) => {
            let parts: Vec<String> =
                parts.iter().map(|part| part.as_str().map_or_else(|| part.to_string(), str::to_owned)).collect();
            Some(parts.join("."))
        }
        _ => None,
    }
}

/// Excerpt of the first non-empty text field among `fields`.
fn first_text(config: &Map<String, Json>, fields: &[&str]) -> Option<String> {
    fields
        .iter()
        .filter_map(|field| config.get(*field).and_then(Json::as_str))
        .map(excerpt)
        .find(|text| !text.is_empty())
}

/// Collapses whitespace, shows variable references in plain words and truncates
/// to [`EXCERPT_CHARS`] characters.
fn excerpt(text: &str) -> String {
    let readable = readable_references(text);
    let collapsed = readable.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= EXCERPT_CHARS {
        return collapsed;
    }
    let truncated: String = collapsed.chars().take(EXCERPT_CHARS - 1).collect();
    format!("{}…", truncated.trim_end())
}

pub(super) fn step_needs_approval(kind: &str, config: &Map<String, Json>) -> bool {
    match kind {
        "human-input" => true,
        "agent" => match config.get("require_approval") {
            Some(Json::Array(tools)) => !tools.is_empty(),
            Some(Json::String(tool)) => !tool.trim().is_empty(),
            Some(Json::Bool(required)) => *required,
            _ => false,
        },
        _ => false,
    }
}

fn collect_inputs(graph: &Graph) -> Vec<FlowInput> {
    graph
        .nodes()
        .iter()
        .filter(|node| &*node.kind == "start")
        .filter_map(|node| node.doc.config.get("variables").and_then(Json::as_array))
        .flatten()
        .filter_map(build_input)
        .collect()
}

pub(super) fn build_input(variable: &Json) -> Option<FlowInput> {
    let name = variable.get("variable").and_then(Json::as_str)?.to_owned();
    let label = ["label", "description"]
        .iter()
        .filter_map(|field| variable.get(*field).and_then(Json::as_str))
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map_or_else(|| humanize_kind(&name), str::to_owned);
    let required = variable.get("required").and_then(Json::as_bool).unwrap_or(false);
    let input_type = variable
        .get("type")
        .and_then(Json::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(super::DEFAULT_INPUT_TYPE)
        .to_owned();
    let options = variable
        .get("options")
        .and_then(Json::as_array)
        .map(|choices| choices.iter().filter_map(option_text).collect())
        .unwrap_or_default();
    let default_value = variable.get("default").filter(|value| !value.is_null()).cloned();
    let schema =
        ["json_schema", "schema"].iter().filter_map(|field| variable.get(*field)).find(|schema| schema.is_object()).cloned();
    Some(FlowInput { name, label, required, input_type, options, default_value, schema })
}

/// A `select` choice as text (graphrt accepts strings and plain scalars).
fn option_text(choice: &Json) -> Option<String> {
    match choice {
        Json::String(text) => Some(text.clone()),
        Json::Number(number) => Some(number.to_string()),
        Json::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn collect_model_providers(graph: &Graph) -> Vec<String> {
    let providers: BTreeSet<String> = graph
        .nodes()
        .iter()
        .filter(|node| MODEL_KINDS.contains(&&*node.kind))
        .filter_map(|node| model_field(&node.doc.config, "provider"))
        .map(str::to_owned)
        .collect();
    providers.into_iter().collect()
}

/// Replaces `{{#node.field#}}` references with a short readable label in ‹ ›, so the
/// builder shows "Send this promotion to ‹name›?" instead of template syntax.
pub(super) fn readable_references(text: &str) -> String {
    let mut readable = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{#") {
        let Some(length) = rest[start + 3..].find("#}}") else {
            break;
        };
        readable.push_str(&rest[..start]);
        let selector = &rest[start + 3..start + 3 + length];
        readable.push_str(&format!("‹{}›", reference_label(selector)));
        rest = &rest[start + 3 + length + 3..];
    }
    readable.push_str(rest);
    readable
}

/// A label for one selector: the field for inputs, loop items and env values
/// (`start.city` → "city", `each.item.name` → "name", `env.MAPS_KEY` → "MAPS_KEY"),
/// otherwise the producing step (`draft_message.text` → "draft message").
fn reference_label(selector: &str) -> String {
    let parts: Vec<&str> = selector.split('.').map(str::trim).filter(|part| !part.is_empty()).collect();
    let label = match parts.as_slice() {
        [] => return "value".to_owned(),
        ["env", name, ..] => return (*name).to_owned(),
        ["start" | "sys" | "conversation", field, ..] => field,
        [_, "item", field, ..] => field,
        [_, "item"] => "item",
        [node, ..] => node,
    };
    label.replace('_', " ")
}
