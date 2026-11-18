//! Bridge between graphrt workflow documents and what the UI shows:
//! the node registry the desktop enables, validation, and a step summary
//! for the builder (screen 04) and run views (06, 07, 20).

mod approval;
mod summary;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// One step as listed in the builder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStep {
    /// graphrt node id.
    pub id: String,
    /// graphrt node type, e.g. `llm`, `http-request`, `human-input`, `iteration`.
    pub node_type: String,
    /// Human title (node `title`, or a readable fallback from the type).
    pub title: String,
    /// One-line detail, e.g. model name, URL host or prompt excerpt.
    pub detail: String,
    /// The run will stop here and ask the user (human-input / approval).
    pub needs_approval: bool,
    /// Nesting depth: steps inside an iteration or loop are 1.
    pub depth: u32,
}

/// A workflow input the user fills before a run (from the `start` node).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowInput {
    pub name: String,
    pub label: String,
    pub required: bool,
    /// The start variable's `type` (`text-input`, `paragraph`, `select`, `number`,
    /// `checkbox`, `json`, ...); `text-input` when the document gives none.
    #[serde(default = "default_input_type")]
    pub input_type: String,
    /// Choices of a `select` input, in document order (empty otherwise).
    #[serde(default)]
    pub options: Vec<String>,
    /// The document's `default`, if any.
    #[serde(default)]
    pub default_value: Option<serde_json::Value>,
}

/// graphrt's start variable type when none is given.
pub const DEFAULT_INPUT_TYPE: &str = "text-input";

fn default_input_type() -> String {
    DEFAULT_INPUT_TYPE.to_owned()
}

impl FlowInput {
    /// A `text-input` with no options and no default (tests and simple callers).
    pub fn text(name: &str, label: &str, required: bool) -> Self {
        Self {
            name: name.to_owned(),
            label: label.to_owned(),
            required,
            input_type: default_input_type(),
            options: Vec::new(),
            default_value: None,
        }
    }
}

/// A value the workflow reads from `env.<name>` (API keys, tokens, account ids).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEnvVar {
    pub name: String,
    /// The declaration's description, if any.
    pub description: Option<String>,
    /// Declared with `type: secret` (masked in logs and events).
    pub is_secret: bool,
    /// The document provides a default, so the user does not have to set it.
    pub has_default: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSummary {
    pub steps: Vec<FlowStep>,
    pub inputs: Vec<FlowInput>,
    /// Provider names the flow's model nodes use, e.g. ["openai"].
    pub model_providers: Vec<String>,
    /// `env.*` values the flow declares, in document order.
    #[serde(default)]
    pub env: Vec<FlowEnvVar>,
}

/// Compact description of the workflow document format, written for the
/// agent builder's model prompt.
const WORKFLOW_FORMAT_GUIDE: &str = include_str!("format_guide.md");

/// Node kinds enabled in the desktop: graphrt builtins + `graphrt-llm` + `graphrt-http`,
/// plus the node kinds of the installed plugins (see `crate::plugins::active`).
pub fn node_registry() -> graphrt_core::Registry {
    let mut registry = builtin_node_registry();
    crate::plugins::register_plugin_nodes(&mut registry);
    registry
}

/// [`node_registry`] without plugins: what plugin kinds must never collide with.
pub fn builtin_node_registry() -> graphrt_core::Registry {
    let mut registry = graphrt_core::Registry::with_builtins();
    graphrt_llm::register(&mut registry);
    graphrt_http::register(&mut registry);
    graphrt_rag::register(&mut registry);
    registry
}

/// Compiles the document with [`node_registry`]; `AppError::Workflow` carries graphrt's message.
///
/// # Errors
/// - `AppError::InvalidInput` when the document is blank (or only comments).
/// - `AppError::Workflow` when graphrt rejects the document (syntax, unknown
///   node type, bad config, missing reference, cycles...).
pub fn compile_flow(flow_yaml: &str) -> AppResult<graphrt_core::Graph> {
    if is_blank_document(flow_yaml) {
        return Err(AppError::InvalidInput("the workflow document is empty".into()));
    }
    let graph = graphrt_core::Graph::from_text(flow_yaml, &node_registry())
        .map_err(|error| AppError::Workflow(error.to_string()))?;
    for warning in graph.warnings() {
        log::debug!("workflow warning: {warning}");
    }
    Ok(graph)
}

/// Validates and summarizes a document for the UI.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn summarize_flow(flow_yaml: &str) -> AppResult<FlowSummary> {
    let graph = compile_flow(flow_yaml)?;
    Ok(summary::summarize_graph(&graph))
}

/// Titles of steps that send data out (HTTP POST/PUT/PATCH/DELETE) on a path
/// that does not first stop at a `human-input` approval. Empty means the flow
/// keeps the promise "it asks you before anything is sent".
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_unapproved_sending_steps(flow_yaml: &str) -> AppResult<Vec<String>> {
    let graph = compile_flow(flow_yaml)?;
    Ok(approval::unapproved_sending_steps(&graph))
}

/// The workflow format cheat-sheet the agent builder includes in its prompt.
pub fn workflow_format_guide() -> &'static str {
    WORKFLOW_FORMAT_GUIDE
}

/// True when the text has no content besides whitespace and YAML comments.
fn is_blank_document(text: &str) -> bool {
    text.lines().map(str::trim).all(|line| line.is_empty() || line.starts_with('#'))
}

#[cfg(test)]
mod tests;
