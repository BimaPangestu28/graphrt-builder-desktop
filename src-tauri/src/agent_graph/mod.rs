//! The Nodes view of the builder: an agent version as a graph of nodes and
//! edges, the node library, and saving an edited graph as a new version.
//!
//! - [`load_agent_graph`]: reads a version's workflow document with graphrt-core
//!   ([`graphrt_core::Workflow`], never hand-parsed) and derives what the canvas
//!   needs: titles, ports (if-else cases, approval buttons, classifier
//!   categories, the error exit), start inputs and validation problems.
//! - [`save_agent_graph`]: applies a [`GraphEdit`] to the base version's
//!   document (`document`), validates it like a builder draft (`validate`),
//!   saves a NEW version "Edited in Nodes: ..." and notes it in the builder chat.
//!   Refused while the builder is changing the agent (`BuilderBusy`) and when
//!   the edit was made on an older version (`VersionConflict`).
//! - [`library::node_library`]: every kind the desktop can use, for the palette
//!   and inspector.
//!
//! Positions are not part of the document; they live in
//! `storage::node_layouts` and are copied forward to each new version.

mod document;
pub mod library;
pub mod model;
mod ports;
#[cfg(test)]
mod tests;
mod validate;

use std::collections::HashSet;

use graphrt_core::{Registry, Workflow};

use crate::agent_builder::edit_lock;
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowEnvVar};
use crate::storage::models::NewBuilderMessage;
use crate::storage::Database;

use document::EditableDocument;
pub use model::*;
pub use validate::ValidationContext;

/// Prefix of the version summary and chat entry of a save from the Nodes view.
pub const NODES_EDIT_PREFIX: &str = "Edited in Nodes: ";

/// Stable codes of [`GraphProblem::code`].
pub mod problem_codes {
    /// graphrt cannot read the document at all (YAML syntax, missing `graph`).
    pub const UNREADABLE_DOCUMENT: &str = "unreadable_document";
    /// A step reads `{{#x.y#}}` from a node that does not exist.
    pub const UNKNOWN_REFERENCE: &str = "unknown_reference";
    /// An arrow goes into or out of a loop body.
    pub const CROSS_SCOPE_EDGE: &str = "cross_scope_edge";
    /// The arrows go in a circle.
    pub const CYCLE: &str = "cycle";
    /// A scope (the agent or a loop body) has no start or more than one.
    pub const ENTRY: &str = "entry";
    /// A step's settings are not valid for its kind (or the kind is unknown).
    pub const NODE_CONFIG: &str = "node_config";
    /// Any other graphrt build error.
    pub const COMPILE: &str = "compile";
    /// A step can never run: no path leads to it.
    pub const UNREACHABLE: &str = "unreachable";
    /// Another graphrt warning (e.g. a value read from inside another loop body).
    pub const COMPILE_WARNING: &str = "compile_warning";
    /// A step sends data on a path without an approval first.
    pub const SEND_WITHOUT_APPROVAL: &str = "send_without_approval";
    /// An HTTP step calls `api.example.com` or a similar stand-in.
    pub const PLACEHOLDER_ADDRESS: &str = "placeholder_address";
    /// A model step uses a provider that is not connected.
    pub const MODEL_PROVIDER_NOT_SET_UP: &str = "model_provider_not_set_up";
    /// An arrow leaves from an exit the node does not have.
    pub const UNUSED_EDGE: &str = "unused_edge";
    /// A plugin step whose plugin is not installed yet (compiles, cannot run).
    pub const PLUGIN_NOT_INSTALLED: &str = "plugin_not_installed";
}

/// Registries and settings the graph functions read; built by the commands from
/// the app state, by tests directly.
pub struct GraphContext<'a> {
    pub validation: ValidationContext<'a>,
}

impl<'a> GraphContext<'a> {
    pub fn new(registry: &'a Registry) -> Self {
        Self { validation: ValidationContext { registry, runnable_kinds: None, available_providers: None } }
    }
}

/// The graph of `version` (the current one when `None`).
///
/// # Errors
/// `NotFound` for an unknown agent or version. A document graphrt cannot read is
/// not an error: the graph comes back empty with an `unreadable_document` problem.
pub fn load_agent_graph(
    db: &Database,
    agent_id: &str,
    version: Option<i64>,
    context: &GraphContext<'_>,
) -> AppResult<AgentGraph> {
    let agent = db.get_agent(agent_id)?;
    let (version, flow_yaml) = match version {
        Some(version) if version != agent.current_version => {
            (version, db.get_agent_version(agent_id, version)?.flow_yaml)
        }
        _ => (agent.current_version, agent.flow_yaml),
    };
    Ok(graph_from_yaml(GraphSource { agent_id, version, latest_version: agent.current_version }, &flow_yaml, context))
}

/// Which version a graph is built for.
#[derive(Debug, Clone, Copy)]
pub struct GraphSource<'a> {
    pub agent_id: &'a str,
    pub version: i64,
    pub latest_version: i64,
}

/// Builds the graph of one workflow document; unreadable documents give an
/// empty graph with the reason as a problem.
pub fn graph_from_yaml(source: GraphSource<'_>, flow_yaml: &str, context: &GraphContext<'_>) -> AgentGraph {
    match EditableDocument::parse(flow_yaml) {
        Ok(document) => graph_from_workflow(source, &document.workflow, context),
        Err(error) => AgentGraph {
            agent_id: source.agent_id.to_owned(),
            version: source.version,
            latest_version: source.latest_version,
            name: None,
            nodes: Vec::new(),
            edges: Vec::new(),
            inputs: Vec::new(),
            env: Vec::new(),
            problems: vec![validate::unreadable_document_problem(&error.to_string())],
        },
    }
}

fn graph_from_workflow(source: GraphSource<'_>, workflow: &Workflow, context: &GraphContext<'_>) -> AgentGraph {
    let registry = context.validation.registry;
    let nodes: Vec<GraphNodeView> = workflow.graph.nodes.iter().map(|node| node_view(node, registry)).collect();
    let edges = edge_views(workflow, &nodes);
    let problems = validate::validate_workflow(workflow, &nodes, &edges, &context.validation);
    AgentGraph {
        agent_id: source.agent_id.to_owned(),
        version: source.version,
        latest_version: source.latest_version,
        name: workflow.name.clone(),
        nodes,
        edges,
        inputs: flow::start_inputs(workflow),
        env: env_vars(workflow),
        problems,
    }
}

fn node_view(node: &graphrt_core::dsl::NodeDoc, registry: &Registry) -> GraphNodeView {
    let descriptor = registry.descriptor(&node.kind);
    let on_error = document::on_error_view(&node.policy.on_error);
    let description = flow::describe_node(&node.kind, node.title.as_deref(), &node.config);
    let plugin_title = descriptor
        .as_ref()
        .filter(|descriptor| descriptor.source.starts_with("plugin:") && !descriptor.is_bare())
        .map(|descriptor| descriptor.title.trim().to_owned())
        .filter(|title| !title.is_empty());
    let has_title = node.title.as_deref().is_some_and(|title| !title.trim().is_empty());
    GraphNodeView {
        id: node.id.clone(),
        kind: node.kind.clone(),
        title: node.title.clone(),
        display_title: if has_title { description.title } else { plugin_title.unwrap_or(description.title) },
        detail: description.detail,
        parent: node.parent.clone(),
        config: node.config.clone(),
        ports: ports::node_ports(&node.kind, &node.config, on_error.strategy, descriptor.as_ref()),
        on_error,
        retry: document::retry_view(&node.policy.retry),
        timeout_ms: node.policy.timeout_ms,
        container: descriptor.as_ref().is_some_and(|descriptor| descriptor.container),
        hidden: matches!(node.kind.as_str(), "iteration-start" | "loop-start"),
        needs_approval: description.needs_approval,
        sends_data: flow::is_sending_node(&node.kind, &node.config),
        plugin: node
            .kind
            .split_once('.')
            .map(|(plugin, _)| plugin.to_owned())
            .filter(|plugin| graphrt_plugin::is_valid_name(plugin)),
    }
}

fn edge_views(workflow: &Workflow, nodes: &[GraphNodeView]) -> Vec<GraphEdgeView> {
    workflow
        .graph
        .edges
        .iter()
        .enumerate()
        .map(|(index, edge)| {
            let source_handle = edge
                .handle
                .as_deref()
                .filter(|handle| !handle.is_empty())
                .unwrap_or(graphrt_core::graph::SOURCE_HANDLE)
                .to_owned();
            let unused = nodes
                .iter()
                .find(|node| node.id == edge.source)
                .is_some_and(|node| !node.ports.outputs.iter().any(|port| port.id == source_handle));
            GraphEdgeView {
                // Same fallback id graphrt gives an edge without one.
                id: edge.id.clone().unwrap_or_else(|| format!("{}-{}-{index}", edge.source, edge.target)),
                document_id: edge.id.clone(),
                source: edge.source.clone(),
                source_handle,
                target: edge.target.clone(),
                unused,
            }
        })
        .collect()
}

fn env_vars(workflow: &Workflow) -> Vec<FlowEnvVar> {
    workflow
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

/// Saves `edit` (made on `base_version`) as the agent's next version.
///
/// Checks, in order: the builder is not changing the agent, `base_version` is
/// still current, the edited document passes validation. An edit that changes
/// nothing saves nothing (`saved: false`). Otherwise the new version's summary
/// is "Edited in Nodes: <description>", the builder chat gets a matching entry
/// (Undo restores `version_before`), and `edit.layout` replaces the positions
/// copied forward to the new version.
///
/// # Errors
/// - `BuilderBusy` while a chat revision of this agent runs.
/// - `VersionConflict` (with the latest version) when the agent moved on.
/// - `InvalidGraph` with the blocking problems; `InvalidInput` for malformed edits.
/// - `NotFound` for an unknown agent.
pub fn save_agent_graph(
    db: &Database,
    agent_id: &str,
    base_version: i64,
    edit: &GraphEdit,
    context: &GraphContext<'_>,
) -> AppResult<SaveGraphResult> {
    if edit_lock::is_builder_editing(agent_id) {
        return Err(AppError::BuilderBusy);
    }
    let agent = db.get_agent(agent_id)?;
    if agent.current_version != base_version {
        return Err(AppError::VersionConflict { base_version, latest_version: agent.current_version });
    }
    let base = EditableDocument::parse(&agent.flow_yaml)?;
    let edited = base.apply_edit(edit)?;
    let flow_yaml = base.to_yaml(&edited)?;
    let saved_document = EditableDocument::parse(&flow_yaml)?;
    let source = GraphSource { agent_id, version: base_version, latest_version: base_version };
    let edited_graph = graph_from_workflow(source, &saved_document.workflow, context);
    if validate::has_errors(&edited_graph.problems) {
        let blocking = edited_graph.problems.into_iter().filter(|problem| problem.severity == ProblemSeverity::Error);
        return Err(AppError::InvalidGraph(blocking.collect()));
    }
    let base_graph = graph_from_workflow(source, &base.workflow, context);
    let Some(changes) = describe_changes(&base_graph, &edited_graph) else {
        return Ok(SaveGraphResult {
            graph: base_graph,
            agent,
            saved: false,
            summary: String::new(),
            changed_step_ids: Vec::new(),
            version_before: base_version,
            version_after: base_version,
        });
    };
    let description = edit.description.as_deref().map(str::trim).filter(|text| !text.is_empty());
    let summary = format!("{NODES_EDIT_PREFIX}{}", description.unwrap_or(&changes.summary));
    let saved_agent = db.update_agent_flow_from_version(agent_id, base_version, &flow_yaml, &summary)?;
    let version_after = saved_agent.current_version;
    if let Some(layout) = &edit.layout {
        db.save_node_layout(agent_id, version_after, layout, None)?;
    }
    record_in_chat(db, agent_id, &summary, &changes.changed_step_ids, (base_version, version_after));
    let graph = AgentGraph { version: version_after, latest_version: version_after, ..edited_graph };
    Ok(SaveGraphResult {
        agent: saved_agent,
        graph,
        saved: true,
        summary,
        changed_step_ids: changes.changed_step_ids,
        version_before: base_version,
        version_after,
    })
}

/// Whether the builder is changing the agent, and its current version.
///
/// # Errors
/// `NotFound` for an unknown agent.
pub fn agent_edit_state(db: &Database, agent_id: &str) -> AppResult<AgentEditState> {
    let agent = db.get_agent(agent_id)?;
    Ok(AgentEditState {
        agent_id: agent.id,
        builder_busy: edit_lock::is_builder_editing(agent_id),
        current_version: agent.current_version,
    })
}

/// The kinds `registry` can run, for [`ValidationContext::runnable_kinds`].
pub fn registry_kinds(registry: &Registry) -> HashSet<String> {
    registry.kinds().map(str::to_owned).collect()
}

#[derive(Debug)]
struct GraphChanges {
    summary: String,
    changed_step_ids: Vec<String>,
}

/// What changed between two graphs, in plain words; `None` when nothing did.
fn describe_changes(before: &AgentGraph, after: &AgentGraph) -> Option<GraphChanges> {
    let visible = |graph: &AgentGraph| graph.nodes.iter().filter(|node| !node.hidden).cloned().collect::<Vec<_>>();
    let (before_nodes, after_nodes) = (visible(before), visible(after));
    let added: Vec<&GraphNodeView> =
        after_nodes.iter().filter(|node| !before_nodes.iter().any(|old| old.id == node.id)).collect();
    let changed: Vec<&GraphNodeView> = after_nodes
        .iter()
        .filter(|node| before_nodes.iter().any(|old| old.id == node.id && node_differs(old, node)))
        .collect();
    let removed: Vec<&GraphNodeView> =
        before_nodes.iter().filter(|old| !after_nodes.iter().any(|node| node.id == old.id)).collect();
    let edge_key = |edge: &GraphEdgeView| (edge.source.clone(), edge.source_handle.clone(), edge.target.clone());
    let before_edges: HashSet<_> = before.edges.iter().map(edge_key).collect();
    let after_edges: HashSet<_> = after.edges.iter().map(edge_key).collect();
    let order_changed = before.nodes.iter().map(|node| &node.id).ne(after.nodes.iter().map(|node| &node.id));

    let mut sentences = Vec::new();
    for (verb, nodes) in [("Added", &added), ("Changed", &changed), ("Removed", &removed)] {
        if !nodes.is_empty() {
            sentences.push(format!("{verb} {}", list_titles(nodes)));
        }
    }
    if before_edges != after_edges {
        sentences.push("Changed the arrows".to_owned());
    }
    if sentences.is_empty() && !order_changed && before.nodes.len() == after.nodes.len() {
        return None;
    }
    if sentences.is_empty() {
        sentences.push("Reordered the steps".to_owned());
    }
    let changed_step_ids = added.iter().chain(changed.iter()).map(|node| node.id.clone()).collect();
    Some(GraphChanges { summary: sentences.join(". "), changed_step_ids })
}

fn node_differs(old: &GraphNodeView, new: &GraphNodeView) -> bool {
    old.kind != new.kind
        || old.title != new.title
        || old.parent != new.parent
        || old.config != new.config
        || old.on_error != new.on_error
        || old.retry != new.retry
        || old.timeout_ms != new.timeout_ms
}

/// "A, B and 2 more".
fn list_titles(nodes: &[&GraphNodeView]) -> String {
    const MAX_LISTED: usize = 3;
    let titles: Vec<&str> = nodes.iter().take(MAX_LISTED).map(|node| node.display_title.as_str()).collect();
    let mut text = titles.join(", ");
    if nodes.len() > MAX_LISTED {
        text.push_str(&format!(" and {} more", nodes.len() - MAX_LISTED));
    }
    text
}

/// Notes the save in the builder chat; a chat entry that cannot be saved is logged, never fatal.
fn record_in_chat(db: &Database, agent_id: &str, summary: &str, changed_step_ids: &[String], versions: (i64, i64)) {
    let reply = NewBuilderMessage {
        changed_step_ids: changed_step_ids.to_vec(),
        ..NewBuilderMessage::builder_reply(summary, None, (Some(versions.0), versions.1))
    };
    if let Err(error) = db.add_builder_messages(agent_id, &[reply]) {
        log::warn!("could not note the Nodes edit of agent {agent_id} in the builder chat: {error}");
    }
}
