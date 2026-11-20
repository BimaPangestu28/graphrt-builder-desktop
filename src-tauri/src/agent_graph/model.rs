//! Types shared with the frontend (`src/api/agentGraphTypes.ts`), camelCase on the wire.
//!
//! Node `config` stays exactly as the workflow document has it (snake_case YAML
//! keys, unknown keys included), so the UI edits it and sends it back untouched
//! where it did not change.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

use crate::flow::{FlowEnvVar, FlowInput};
use crate::storage::models::Agent;
use crate::storage::node_layouts::NodeLayout;

/// An agent version as a graph for the Nodes view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraph {
    pub agent_id: String,
    /// The version this graph was read from.
    pub version: i64,
    /// The agent's current version (edits are saved against it).
    pub latest_version: i64,
    /// Document `name`, if any.
    pub name: Option<String>,
    /// Every node in document order, hidden body markers included (see [`GraphNodeView::hidden`]).
    pub nodes: Vec<GraphNodeView>,
    pub edges: Vec<GraphEdgeView>,
    /// Run inputs (the `start` node's variables).
    pub inputs: Vec<FlowInput>,
    /// `env.*` values the document declares (names only, never values).
    pub env: Vec<FlowEnvVar>,
    /// Validation findings; any `error` blocks Test and saving.
    pub problems: Vec<GraphProblem>,
}

/// One node of the graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeView {
    pub id: String,
    /// graphrt node `type`, e.g. `llm`, `if-else`, `whatsapp-web.send_message`.
    pub kind: String,
    /// The document's `title` (None when it has none).
    pub title: Option<String>,
    /// What the canvas shows: `title`, or the kind's app name ("Ask a model").
    pub display_title: String,
    /// One-line detail, e.g. model name, URL host or prompt excerpt.
    pub detail: String,
    /// Container (iteration / loop) this node sits in.
    pub parent: Option<String>,
    /// Node-specific settings: every document key except id/type/title/parent/policy.
    pub config: Map<String, Json>,
    pub on_error: OnErrorView,
    pub retry: RetryView,
    /// Per-attempt timeout; `None` uses the app default (2 minutes).
    pub timeout_ms: Option<u64>,
    pub ports: NodePorts,
    /// Owns a body (iteration, loop): its children name it as `parent`.
    pub container: bool,
    /// Body entry marker (`iteration-start`, `loop-start`): kept in the document, not drawn as a step.
    pub hidden: bool,
    /// The run stops here and asks the user.
    pub needs_approval: bool,
    /// Sends data out (writing HTTP, plugin send/post/...): must sit behind an approval.
    pub sends_data: bool,
    /// Plugin name for plugin kinds (`whatsapp-web` for `whatsapp-web.send_message`).
    pub plugin: Option<String>,
}

/// Where arrows attach to a node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePorts {
    /// Empty for `start` and body markers, else one `target` port.
    pub inputs: Vec<NodePort>,
    /// Exits; an edge's `sourceHandle` is one of their ids.
    pub outputs: Vec<NodePort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePort {
    /// Edge handle: `source`, a case / action / class id, `false`, `fail-branch`; `target` for inputs.
    pub id: String,
    /// Readable label ("Else", "Send", "On error"); empty for the default ports.
    pub label: String,
    pub role: PortRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PortRole {
    /// The one input of a step.
    Input,
    /// The normal exit (`source`).
    Default,
    /// One branch: if-else case, approval button, classifier category, plugin handle.
    Branch,
    /// The if-else `false` exit.
    Else,
    /// Taken when the step fails with `on_error: fail-branch`.
    FailBranch,
}

/// One arrow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeView {
    /// Stable id for the UI: the document's `id`, else graphrt's `<source>-<target>-<index>`.
    pub id: String,
    /// The `id` written in the document, if any; send it back unchanged in [`EdgeEdit`].
    pub document_id: Option<String>,
    pub source: String,
    /// Exit of the source node (`source` when the document gives none).
    pub source_handle: String,
    pub target: String,
    /// The source node has no exit with this handle (e.g. a `fail-branch` arrow after
    /// "On error" was switched off): the arrow is kept but never taken.
    pub unused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemSeverity {
    /// Blocks Test and saving.
    Error,
    /// Shown, does not block.
    Warning,
}

/// One validation finding, pinned to a node or edge when known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProblem {
    pub severity: ProblemSeverity,
    /// Stable code, see [`problem_codes`](super::problem_codes).
    pub code: String,
    /// Plain-language message, safe to show.
    pub message: String,
    pub node_id: Option<String>,
    pub edge_id: Option<String>,
}

/// `on_error` of a node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnErrorView {
    pub strategy: OnErrorStrategy,
    /// Outputs used with `default-value` (`error_message` / `error_type` are added by graphrt).
    #[serde(default)]
    pub values: Map<String, Json>,
}

impl Default for OnErrorView {
    fn default() -> Self {
        Self { strategy: OnErrorStrategy::Fail, values: Map::new() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnErrorStrategy {
    /// Stop the run (default).
    Fail,
    /// Go to the error path: take the `fail-branch` arrows.
    FailBranch,
    /// Continue with `values`.
    DefaultValue,
}

/// `retry` of a node.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryView {
    /// Extra attempts after the first (0 = no retry).
    pub max_retries: u32,
    /// Wait before the first retry, in milliseconds.
    pub interval_ms: u64,
    /// Multiplier for each later wait (at least 1.0).
    pub backoff: f64,
}

impl Default for RetryView {
    fn default() -> Self {
        Self { max_retries: 0, interval_ms: 0, backoff: 1.0 }
    }
}

/// The whole edited graph, sent by the Nodes view to save a new version.
///
/// Nodes and edges replace the document's; everything else in the document
/// (name, env, unknown top-level keys) is kept from `base_version`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdit {
    /// Every node, in the order to write them (hidden markers included; a container
    /// without its marker gets one, see `document::ensure_body_markers`).
    pub nodes: Vec<NodeEdit>,
    pub edges: Vec<EdgeEdit>,
    /// What the user changed in plain words ("moved Write the run report, set Retry 2× on Send");
    /// the backend describes the change itself when absent.
    #[serde(default)]
    pub description: Option<String>,
    /// Positions to save for the new version (replacing the copied-forward ones), if any.
    #[serde(default)]
    pub layout: Option<Vec<NodeLayout>>,
}

/// One node to save; the editable fields of [`GraphNodeView`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeEdit {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub config: Map<String, Json>,
    #[serde(default)]
    pub on_error: OnErrorView,
    #[serde(default)]
    pub retry: RetryView,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

impl From<&GraphNodeView> for NodeEdit {
    fn from(node: &GraphNodeView) -> Self {
        Self {
            id: node.id.clone(),
            kind: node.kind.clone(),
            title: node.title.clone(),
            parent: node.parent.clone(),
            config: node.config.clone(),
            on_error: node.on_error.clone(),
            retry: node.retry,
            timeout_ms: node.timeout_ms,
        }
    }
}

/// One arrow to save.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeEdit {
    /// [`GraphEdgeView::document_id`] for an existing arrow; `None` for new ones.
    #[serde(default)]
    pub document_id: Option<String>,
    pub source: String,
    /// `None` or `source` for the default exit.
    #[serde(default)]
    pub source_handle: Option<String>,
    pub target: String,
}

impl From<&GraphEdgeView> for EdgeEdit {
    fn from(edge: &GraphEdgeView) -> Self {
        Self {
            document_id: edge.document_id.clone(),
            source: edge.source.clone(),
            source_handle: Some(edge.source_handle.clone()),
            target: edge.target.clone(),
        }
    }
}

impl From<&AgentGraph> for GraphEdit {
    /// The graph as an edit that changes nothing (start of the UI's local edit state).
    fn from(graph: &AgentGraph) -> Self {
        Self {
            nodes: graph.nodes.iter().map(NodeEdit::from).collect(),
            edges: graph.edges.iter().map(EdgeEdit::from).collect(),
            description: None,
            layout: None,
        }
    }
}

/// What `save_agent_graph` did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGraphResult {
    /// The agent after the save (unchanged when `saved` is false).
    pub agent: Agent,
    /// The saved version as a graph.
    pub graph: AgentGraph,
    /// False when the edit changed nothing in the document (no version was added).
    pub saved: bool,
    /// The version history / chat summary, "Edited in Nodes: ...".
    pub summary: String,
    /// Steps added or changed, to highlight them.
    pub changed_step_ids: Vec<String>,
    pub version_before: i64,
    pub version_after: i64,
}

/// Whether the Nodes view may save right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEditState {
    pub agent_id: String,
    /// A builder chat change is running: the canvas is read-only and saves fail with `builder_busy`.
    pub builder_busy: bool,
    pub current_version: i64,
}
