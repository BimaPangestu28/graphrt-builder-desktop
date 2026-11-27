//! Bridge between graphrt workflow documents and what the UI shows:
//! the node registry the desktop enables, validation, and a step summary
//! for the builder (screen 04) and run views (06, 07, 20).

mod approval;
pub mod migration;
mod placeholders;
mod sending;
mod summary;
#[cfg(test)]
pub(crate) mod test_fixtures;
pub mod trusted_hosts;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
pub use approval::UnapprovedStep;
pub(crate) use approval::{read_timeout_choice, TimeoutChoice, TimeoutSend};
pub use sending::{check_http_request, HttpRequestCheck};
pub use trusted_hosts::TrustedHosts;

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
    /// The variable's `json_schema` (or `schema`), when the document gives one: the form
    /// reads the columns of a list input from it. The runtime ignores the field.
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
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
            schema: None,
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

/// [`node_registry`] plus placeholder kinds for catalog plugins that are not
/// installed (see `crate::plugins::register_catalog_placeholders`). Validates
/// drafts and summarizes saved agents; never used to run.
pub fn draft_node_registry() -> graphrt_core::Registry {
    let mut registry = node_registry();
    crate::plugins::register_catalog_placeholders(&mut registry);
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
    compile_with(flow_yaml, &node_registry())
}

/// [`compile_flow`], with the env variables named in `secret_env_names`
/// declared `type: secret` whatever the document says: a value the app supplies
/// from the keychain is always a masked secret, and graphrt checks supplied env
/// values against their declared type.
///
/// # Errors
/// Same as [`compile_flow`].
pub fn compile_flow_with_secret_env(flow_yaml: &str, secret_env_names: &[String]) -> AppResult<graphrt_core::Graph> {
    if secret_env_names.is_empty() {
        return compile_flow(flow_yaml);
    }
    if is_blank_document(flow_yaml) {
        return Err(AppError::InvalidInput("the workflow document is empty".into()));
    }
    let mut workflow =
        graphrt_core::Workflow::parse(flow_yaml).map_err(|error| AppError::Workflow(error.to_string()))?;
    for declaration in workflow.env.iter_mut().filter(|declaration| secret_env_names.contains(&declaration.name)) {
        declaration.ty = graphrt_core::value::ValueType::Secret;
    }
    graphrt_core::Graph::build(workflow, &node_registry()).map_err(|error| AppError::Workflow(error.to_string()))
}

/// Compiles the document with [`draft_node_registry`]: catalog plugin steps
/// that are not installed are accepted (their config checked against the
/// catalog's schema). For validation and display only; runs use [`compile_flow`].
///
/// # Errors
/// Same as [`compile_flow`].
pub fn compile_draft(flow_yaml: &str) -> AppResult<graphrt_core::Graph> {
    compile_with(flow_yaml, &draft_node_registry())
}

fn compile_with(flow_yaml: &str, registry: &graphrt_core::Registry) -> AppResult<graphrt_core::Graph> {
    if is_blank_document(flow_yaml) {
        return Err(AppError::InvalidInput("the workflow document is empty".into()));
    }
    let graph =
        graphrt_core::Graph::from_text(flow_yaml, registry).map_err(|error| AppError::Workflow(error.to_string()))?;
    for warning in graph.warnings() {
        log::debug!("workflow warning: {warning}");
    }
    Ok(graph)
}

/// Plugins whose node kinds the document uses but that are not installed (or
/// failed to load), sorted by name. Read from the raw document, so it works
/// without the catalog too. An unreadable document yields none.
pub fn find_missing_plugins(flow_yaml: &str) -> Vec<String> {
    let Ok(workflow) = graphrt_core::Workflow::parse(flow_yaml) else { return Vec::new() };
    let registry = node_registry();
    let mut missing: Vec<String> = workflow
        .graph
        .nodes
        .iter()
        .filter(|node| !registry.contains(&node.kind))
        .filter_map(|node| node.kind.split_once('.').map(|(plugin, _)| plugin.to_owned()))
        .filter(|plugin| graphrt_plugin::is_valid_name(plugin))
        .collect();
    missing.sort();
    missing.dedup();
    missing
}

/// Validates and summarizes a document for the UI. Compiled with
/// [`draft_node_registry`], so agents using catalog plugins that are not
/// installed yet still show their steps.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn summarize_flow(flow_yaml: &str) -> AppResult<FlowSummary> {
    let graph = compile_draft(flow_yaml)?;
    Ok(summary::summarize_graph(&graph))
}

/// Titles of steps that send data out (see [`is_sending_node`]) on a path
/// that does not first stop at a `human-input` approval. Empty means the flow
/// keeps the promise "it asks you before anything is sent". `trusted` are the
/// agent's trusted lookup hosts ([`TrustedHosts::none`] for a new draft).
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_unapproved_sending_steps(flow_yaml: &str, trusted: &TrustedHosts) -> AppResult<Vec<String>> {
    let graph = compile_draft(flow_yaml)?;
    Ok(approval::unapproved_sending_steps(&graph, trusted))
}

/// [`find_unapproved_sending_steps`] with node ids and, for lookups that only
/// need their host trusted, that host.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_unapproved_steps(flow_yaml: &str, trusted: &TrustedHosts) -> AppResult<Vec<UnapprovedStep>> {
    let graph = compile_draft(flow_yaml)?;
    Ok(approval::unapproved_steps(&graph, trusted))
}

/// [`find_unapproved_steps`] of a compiled graph.
pub fn unapproved_steps(graph: &graphrt_core::Graph, trusted: &TrustedHosts) -> Vec<UnapprovedStep> {
    approval::unapproved_steps(graph, trusted)
}

/// Whether a compiled graph has an `http-request` step that reads only because
/// its host is trusted (a [`HttpRequestCheck::TrustedLookup`]). Runs of such a
/// graph do not follow redirects, so a trusted host cannot bounce the request,
/// with its values, to a host nobody trusted.
pub fn has_trusted_lookups(graph: &graphrt_core::Graph, trusted: &TrustedHosts) -> bool {
    !trusted.is_empty()
        && graph
            .nodes()
            .iter()
            .filter(|node| &*node.kind == "http-request")
            .any(|node| matches!(check_http_request(&node.doc.config, trusted), HttpRequestCheck::TrustedLookup { .. }))
}

/// Approval steps whose time limit answers with a button that leads to a step
/// that sends, each as a plain-language message: such an approval sends without
/// asking once nobody answers in time.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_timeouts_that_send(flow_yaml: &str, trusted: &TrustedHosts) -> AppResult<Vec<String>> {
    let graph = compile_draft(flow_yaml)?;
    Ok(approval::timeouts_that_send(&graph, trusted).iter().map(timeout_send_message).collect())
}

/// Approval steps of a compiled graph whose time limit answers into a send
/// (see [`find_timeouts_that_send`]).
pub(crate) fn timeouts_that_send(graph: &graphrt_core::Graph, trusted: &TrustedHosts) -> Vec<TimeoutSend> {
    approval::timeouts_that_send(graph, trusted)
}

/// "Ask before sending answers `send` by itself when its time runs out, and that leads to Send it".
pub(crate) fn timeout_send_message(timeout: &TimeoutSend) -> String {
    format!(
        "{} answers `{}` by itself when its time runs out, and that leads to {}, which sends without asking: \
         set its `on_expire` to `stop` or to a button that does not lead to a send",
        timeout.approval_label, timeout.action, timeout.sending_step_label
    )
}

/// HTTP steps whose URL points at a placeholder address such as `api.example.com`,
/// as "<step title> (<host>)". Such a run can only fail.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_placeholder_http_steps(flow_yaml: &str) -> AppResult<Vec<String>> {
    let graph = compile_draft(flow_yaml)?;
    Ok(placeholders::placeholder_http_steps(&graph))
}

/// Steps a local CLI model provider cannot run (a "Run an agent" step with tools,
/// images), each as a plain-language message naming the step.
///
/// # Errors
/// Same as [`compile_flow`]: the document is compiled first.
pub fn find_local_cli_capability_gaps(flow_yaml: &str) -> AppResult<Vec<String>> {
    let graph = compile_draft(flow_yaml)?;
    Ok(graph
        .nodes()
        .iter()
        .filter_map(|node| {
            let gap = crate::local_cli::capability::capability_gap(&node.kind, &node.doc.config)?;
            let title = describe_node(&node.kind, node.doc.title.as_deref(), &node.doc.config).title;
            Some(gap.message(&title))
        })
        .collect())
}

/// How the builder and run screens describe one node, from its kind, title and config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeDescription {
    /// The node `title`, or a readable fallback from the kind ("Ask a model").
    pub title: String,
    /// One-line detail, e.g. model name, URL host or prompt excerpt.
    pub detail: String,
    /// The run stops here and asks the user.
    pub needs_approval: bool,
}

/// Describes one node the way [`summarize_flow`] describes its steps.
pub fn describe_node(
    kind: &str,
    title: Option<&str>,
    config: &serde_json::Map<String, serde_json::Value>,
) -> NodeDescription {
    let title = title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map_or_else(|| summary::fallback_title(kind), str::to_owned);
    NodeDescription {
        title,
        detail: summary::step_detail(kind, config),
        needs_approval: summary::step_needs_approval(kind, config),
    }
}

/// Readable name of a node kind, as the builder lists it ("Ask a model", "For each item").
pub fn node_kind_title(kind: &str) -> String {
    summary::fallback_title(kind)
}

/// The run inputs of a parsed (not necessarily compiling) document: its `start` variables.
pub fn start_inputs(workflow: &graphrt_core::Workflow) -> Vec<FlowInput> {
    workflow
        .graph
        .nodes
        .iter()
        .filter(|node| node.kind == "start")
        .filter_map(|node| node.config.get("variables").and_then(serde_json::Value::as_array))
        .flatten()
        .filter_map(summary::build_input)
        .collect()
}

/// Whether a node of this kind and config sends data out (writing HTTP methods,
/// HTTP requests carrying values, plugin and tool steps that send or change
/// something, agents with sending tools that do not ask first), so it must sit
/// behind an approval. `trusted` are the agent's trusted lookup hosts.
pub fn is_sending_node(
    kind: &str,
    config: &serde_json::Map<String, serde_json::Value>,
    trusted: &TrustedHosts,
) -> bool {
    approval::is_sending_kind(kind, config, trusted)
}

/// Node ids of compiled sending steps that a path reaches without an approval
/// (see [`find_unapproved_sending_steps`]).
pub fn unapproved_sending_node_ids(graph: &graphrt_core::Graph, trusted: &TrustedHosts) -> Vec<String> {
    approval::unapproved_sending_node_ids(graph, trusted)
}

/// Ids of the steps whose output may carry what a local CLI that might have run a
/// command produced (Codex), directly or through other steps.
pub fn unvetted_output_node_ids(graph: &graphrt_core::Graph) -> std::collections::HashSet<String> {
    sending::unvetted_output_node_ids(graph)
}

/// `(node id, host)` of compiled HTTP steps calling a placeholder address
/// (see [`find_placeholder_http_steps`]).
pub fn placeholder_http_node_hosts(graph: &graphrt_core::Graph) -> Vec<(String, String)> {
    placeholders::placeholder_http_node_hosts(graph)
}

/// Model providers (`model.provider`) of a compiled graph's model nodes, sorted.
pub fn model_providers_of(graph: &graphrt_core::Graph) -> Vec<String> {
    summary::summarize_graph(graph).model_providers
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
