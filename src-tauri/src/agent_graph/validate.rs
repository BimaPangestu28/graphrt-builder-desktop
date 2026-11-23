//! Validation problems of a graph, pinned to nodes and edges where possible.
//!
//! The same checks the builder runs on a drafted document (`agent_builder::validate_draft`):
//! graphrt compilation with the draft registry (catalog plugins that are not
//! installed compile through placeholders), model providers that are set up,
//! no placeholder HTTP hosts, an approval before every step that sends
//! data (lookups on the agent's trusted hosts read, see `flow::trusted_hosts`), and no approval whose time limit answers into a send. Plus editor-only findings: graphrt warnings (unreachable steps,
//! references into another loop body), arrows from an exit the node does not
//! have, and plugin steps that are not installed yet.

use std::collections::HashSet;

use graphrt_core::graph::GraphError;
use graphrt_core::{Graph, Registry, Workflow};

use super::model::{GraphEdgeView, GraphNodeView, GraphProblem, ProblemSeverity};
use super::problem_codes;
use crate::flow;

/// Kinds that read a `model: {provider, name}` block.
const MODEL_KINDS: &[&str] = &["llm", "agent", "question-classifier", "parameter-extractor"];

/// What validation needs besides the document.
pub struct ValidationContext<'a> {
    /// Registry to compile with: [`flow::draft_node_registry`] in the app.
    pub registry: &'a Registry,
    /// Kinds that can actually run ([`flow::node_registry`]); `None` skips the "not installed" check.
    pub runnable_kinds: Option<&'a HashSet<String>>,
    /// Model providers set up on this computer; `None` skips the provider check.
    pub available_providers: Option<&'a [String]>,
    /// The agent's trusted lookup hosts (from the app database, never the document).
    pub trusted_hosts: flow::TrustedHosts,
}

/// Every problem of `workflow`; `nodes` / `edges` are its views (ports already derived).
pub(super) fn validate_workflow(
    workflow: &Workflow,
    nodes: &[GraphNodeView],
    edges: &[GraphEdgeView],
    context: &ValidationContext<'_>,
) -> Vec<GraphProblem> {
    let mut problems = Vec::new();
    match Graph::build(workflow.clone(), context.registry) {
        Ok(graph) => {
            problems.extend(graph.warnings().iter().map(|warning| warning_problem(warning)));
            problems.extend(rule_problems(&graph, nodes, &context.trusted_hosts));
        }
        Err(error) => problems.push(compile_problem(&error)),
    }
    problems.extend(unused_edge_problems(nodes, edges));
    if let Some(runnable_kinds) = context.runnable_kinds {
        problems.extend(not_installed_problems(nodes, runnable_kinds));
    }
    if let Some(available_providers) = context.available_providers {
        problems.extend(provider_problems(workflow, nodes, available_providers));
    }
    problems.extend(capability_problems(workflow, nodes));
    problems
}

/// Model steps whose provider is a local CLI but that need tools or images.
fn capability_problems(workflow: &Workflow, nodes: &[GraphNodeView]) -> Vec<GraphProblem> {
    workflow
        .graph
        .nodes
        .iter()
        .filter(|node| MODEL_KINDS.contains(&node.kind.as_str()))
        .filter_map(|node| {
            let gap = crate::local_cli::capability::capability_gap(&node.kind, &node.config)?;
            let message = gap.message(&display_title(nodes, &node.id));
            Some(problem(ProblemSeverity::Error, problem_codes::MODEL_CAPABILITY, message, Some(node.id.clone()), None))
        })
        .collect()
}

/// The problem for a document graphrt cannot read at all.
pub(super) fn unreadable_document_problem(message: &str) -> GraphProblem {
    problem(ProblemSeverity::Error, problem_codes::UNREADABLE_DOCUMENT, message.to_owned(), None, None)
}

fn rule_problems(graph: &Graph, nodes: &[GraphNodeView], trusted: &flow::TrustedHosts) -> Vec<GraphProblem> {
    let title_of = |node_id: &str| display_title(nodes, node_id);
    let mut problems: Vec<GraphProblem> = flow::unapproved_steps(graph, trusted)
        .into_iter()
        .map(|step| {
            let title = title_of(&step.node_id);
            let message = match &step.trustable_host {
                Some(host) => format!(
                    "{title} sends values to {host} without asking you first: Ask before sending, or trust {host} \
                     for read-only lookups"
                ),
                None => {
                    format!("{title} sends data without asking you first: put Ask me before continuing in front of it")
                }
            };
            let code = problem_codes::SEND_WITHOUT_APPROVAL;
            GraphProblem {
                trust_host: step.trustable_host,
                ..problem(ProblemSeverity::Error, code, message, Some(step.node_id), None)
            }
        })
        .collect();
    problems.extend(flow::timeouts_that_send(graph, trusted).iter().map(|timeout| {
        let message = flow::timeout_send_message(timeout);
        let node_id = Some(timeout.approval_node_id.clone());
        problem(ProblemSeverity::Error, problem_codes::APPROVAL_TIMEOUT_SENDS, message, node_id, None)
    }));
    problems.extend(flow::placeholder_http_node_hosts(graph).into_iter().map(|(node_id, host)| {
        let message = format!("{} calls {host}, a placeholder address that does not exist", title_of(&node_id));
        problem(ProblemSeverity::Error, problem_codes::PLACEHOLDER_ADDRESS, message, Some(node_id), None)
    }));
    problems
}

fn unused_edge_problems(nodes: &[GraphNodeView], edges: &[GraphEdgeView]) -> Vec<GraphProblem> {
    edges
        .iter()
        .filter(|edge| edge.unused)
        .map(|edge| {
            let message = if edge.source_handle == graphrt_core::graph::FAIL_BRANCH {
                format!(
                    "The error path of {} is not used: the step is not set to go to it",
                    display_title(nodes, &edge.source)
                )
            } else {
                format!(
                    "{} has no `{}` exit, so this arrow is never taken",
                    display_title(nodes, &edge.source),
                    edge.source_handle
                )
            };
            problem(
                ProblemSeverity::Warning,
                problem_codes::UNUSED_EDGE,
                message,
                Some(edge.source.clone()),
                Some(edge.id.clone()),
            )
        })
        .collect()
}

fn not_installed_problems(nodes: &[GraphNodeView], runnable_kinds: &HashSet<String>) -> Vec<GraphProblem> {
    nodes
        .iter()
        .filter(|node| node.plugin.is_some() && !runnable_kinds.contains(&node.kind))
        .map(|node| {
            let plugin = node.plugin.as_deref().unwrap_or_default();
            let message = format!(
                "{} needs the {} plugin, which is not installed yet",
                node.display_title,
                crate::plugins::display_name::humanize_plugin_name(plugin)
            );
            problem(ProblemSeverity::Warning, problem_codes::PLUGIN_NOT_INSTALLED, message, Some(node.id.clone()), None)
        })
        .collect()
}

fn provider_problems(
    workflow: &Workflow,
    nodes: &[GraphNodeView],
    available_providers: &[String],
) -> Vec<GraphProblem> {
    workflow
        .graph
        .nodes
        .iter()
        .filter(|node| MODEL_KINDS.contains(&node.kind.as_str()))
        .filter_map(|node| {
            let provider = node.config.get("model")?.get("provider")?.as_str().map(str::trim)?;
            let is_set_up = provider.is_empty() || available_providers.iter().any(|available| available == provider);
            (!is_set_up).then(|| {
                let message = format!(
                    "{} uses {provider}, which is not set up on this computer: connect it in Connections or pick another model",
                    display_title(nodes, &node.id)
                );
                problem(ProblemSeverity::Error, problem_codes::MODEL_PROVIDER_NOT_SET_UP, message, Some(node.id.clone()), None)
            })
        })
        .collect()
}

/// A graphrt build error, pinned to the node or edge it names.
fn compile_problem(error: &GraphError) -> GraphProblem {
    let (node_id, edge_id) = match error {
        GraphError::Config(config_error) => (Some(config_error.node_id.clone()), None),
        GraphError::DuplicateNode(node)
        | GraphError::ParentNotContainer(node)
        | GraphError::ParentCycle(node)
        | GraphError::InvalidNodeId { id: node, .. }
        | GraphError::MissingParent { node, .. }
        | GraphError::UnknownReference { node, .. }
        | GraphError::Cycle { node, .. } => (Some(node.clone()), None),
        GraphError::MissingNode { edge, .. } | GraphError::DuplicateEdge(edge) => (None, Some(edge.clone())),
        GraphError::CrossScopeEdge { edge, source_node, .. } => (Some(source_node.clone()), Some(edge.clone())),
        GraphError::MultipleEntries { nodes, .. } => (nodes.first().cloned(), None),
        _ => (None, None),
    };
    problem(ProblemSeverity::Error, compile_code(error), error.to_string(), node_id, edge_id)
}

fn compile_code(error: &GraphError) -> &'static str {
    match error {
        GraphError::UnknownReference { .. } => problem_codes::UNKNOWN_REFERENCE,
        GraphError::CrossScopeEdge { .. } => problem_codes::CROSS_SCOPE_EDGE,
        GraphError::Cycle { .. } => problem_codes::CYCLE,
        GraphError::NoEntry { .. } | GraphError::MultipleEntries { .. } => problem_codes::ENTRY,
        GraphError::Config(_) => problem_codes::NODE_CONFIG,
        _ => problem_codes::COMPILE,
    }
}

/// A graphrt warning; it names its node in backticks first ("node `x` is not reachable...").
fn warning_problem(warning: &str) -> GraphProblem {
    let node_id = warning.split('`').nth(1).filter(|id| !id.is_empty()).map(str::to_owned);
    let code =
        if warning.contains("not reachable") { problem_codes::UNREACHABLE } else { problem_codes::COMPILE_WARNING };
    problem(ProblemSeverity::Warning, code, warning.to_owned(), node_id, None)
}

fn display_title(nodes: &[GraphNodeView], node_id: &str) -> String {
    nodes.iter().find(|node| node.id == node_id).map_or_else(|| node_id.to_owned(), |node| node.display_title.clone())
}

fn problem(
    severity: ProblemSeverity,
    code: &str,
    message: String,
    node_id: Option<String>,
    edge_id: Option<String>,
) -> GraphProblem {
    GraphProblem { severity, code: code.to_owned(), message, node_id, edge_id, trust_host: None }
}

/// True when any problem blocks saving and Test.
pub(super) fn has_errors(problems: &[GraphProblem]) -> bool {
    problems.iter().any(|problem| problem.severity == ProblemSeverity::Error)
}
