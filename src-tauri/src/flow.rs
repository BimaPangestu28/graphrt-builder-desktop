//! Bridge between graphrt workflow documents and what the UI shows:
//! the node registry the desktop enables, validation, and a step summary
//! for the builder (screen 04) and run views (06, 07, 20).

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowInput {
    pub name: String,
    pub label: String,
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSummary {
    pub steps: Vec<FlowStep>,
    pub inputs: Vec<FlowInput>,
    /// Provider names the flow's model nodes use, e.g. ["openai"].
    pub model_providers: Vec<String>,
}

/// Node kinds enabled in the desktop: graphrt builtins + `graphrt-llm` + `graphrt-http`.
pub fn node_registry() -> graphrt_core::Registry {
    graphrt_core::Registry::with_builtins()
}

/// Compiles the document with [`node_registry`]; `AppError::Workflow` carries graphrt's message.
pub fn compile_flow(_flow_yaml: &str) -> AppResult<graphrt_core::Graph> {
    Err(AppError::Internal("not implemented".into()))
}

/// Validates and summarizes a document for the UI.
pub fn summarize_flow(_flow_yaml: &str) -> AppResult<FlowSummary> {
    Err(AppError::Internal("not implemented".into()))
}
