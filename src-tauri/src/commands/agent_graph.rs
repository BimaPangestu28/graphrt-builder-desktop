//! The builder's Nodes view: an agent version as a graph, the node library,
//! saving an edited graph, node positions, and whether the builder is busy.
//! Logic lives in `crate::agent_graph`; these only gather what it reads from the app.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::agent_builder::edit_lock;
use crate::agent_graph::library::{self, LibrarySources, NodeKindInfo};
use crate::agent_graph::tool_schemas::{self, ToolInputSchema};
use crate::agent_graph::{self, AgentEditState, AgentGraph, GraphContext, GraphEdit, GraphProblem, SaveGraphResult};
use crate::credentials;
use crate::error::AppResult;
use crate::flow;
use crate::state::AppState;
use crate::storage::canvas_notes::{CanvasNote, CanvasNoteSet};
use crate::storage::node_layouts::{CanvasViewport, NodeLayout, NodeLayoutSet};

/// Emitted with an [`EditStateChange`] whenever the builder starts or stops changing an agent.
pub const AGENT_EDIT_STATE_EVENT: &str = "agent-edit-state";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditStateChange {
    pub agent_id: String,
    pub builder_busy: bool,
}

/// Sends [`AGENT_EDIT_STATE_EVENT`] for every busy / idle change (called once at start-up).
pub fn emit_edit_state_changes(app_handle: AppHandle) {
    edit_lock::set_edit_state_listener(Box::new(move |agent_id, builder_busy| {
        let change = EditStateChange { agent_id: agent_id.to_owned(), builder_busy };
        if let Err(error) = app_handle.emit(AGENT_EDIT_STATE_EVENT, change) {
            log::warn!("could not send the edit state of agent {agent_id}: {error}");
        }
    }));
}

/// The graph of `version` (current when absent), with ports and validation problems.
#[tauri::command]
pub fn get_agent_graph(state: State<'_, AppState>, agent_id: String, version: Option<i64>) -> AppResult<AgentGraph> {
    with_graph_context(&state, &agent_id, |context| {
        agent_graph::load_agent_graph(&state.db, &agent_id, version, context)
    })
}

/// Every node kind the app offers or can read, builtins first, then plugin actions.
#[tauri::command]
pub async fn get_node_kinds(state: State<'_, AppState>) -> AppResult<Vec<NodeKindInfo>> {
    // Catalog plugins are listed too; a slow network only delays this briefly.
    state.plugins.refresh_catalog_for_builder().await;
    let registry = flow::draft_node_registry();
    let runnable_kinds = agent_graph::registry_kinds(&flow::node_registry());
    let plugin_display_names = state.plugins.plugin_display_names();
    Ok(library::node_library(&LibrarySources {
        registry: &registry,
        runnable_kinds: &runnable_kinds,
        plugin_display_names: &plugin_display_names,
    }))
}

/// Saves an edited graph made on `base_version` as a new version.
///
/// Errors the UI handles: `builder_busy`, `version_conflict` (`details.latestVersion`),
/// `invalid_graph` (`details.problems`).
#[tauri::command]
pub fn save_agent_graph(
    state: State<'_, AppState>,
    agent_id: String,
    base_version: i64,
    edit: GraphEdit,
) -> AppResult<SaveGraphResult> {
    with_graph_context(&state, &agent_id, |context| {
        agent_graph::save_agent_graph(&state.db, &agent_id, base_version, &edit, context)
    })
}

/// The problems an edited graph would have on `base_version`; saves nothing (Validate).
#[tauri::command]
pub fn validate_agent_graph(
    state: State<'_, AppState>,
    agent_id: String,
    base_version: i64,
    edit: GraphEdit,
) -> AppResult<Vec<GraphProblem>> {
    with_graph_context(&state, &agent_id, |context| {
        agent_graph::validate_agent_graph(&state.db, &agent_id, base_version, &edit, context)
    })
}

/// Saved positions of `version` (current when absent) and the agent's canvas viewport.
#[tauri::command]
pub fn get_node_layout(state: State<'_, AppState>, agent_id: String, version: Option<i64>) -> AppResult<NodeLayoutSet> {
    let version = match version {
        Some(version) => version,
        None => state.db.get_agent(&agent_id)?.current_version,
    };
    state.db.get_node_layout(&agent_id, version)
}

/// Replaces the positions of `version` (moving nodes adds no version) and saves the viewport when given.
#[tauri::command]
pub fn save_node_layout(
    state: State<'_, AppState>,
    agent_id: String,
    version: i64,
    nodes: Vec<NodeLayout>,
    viewport: Option<CanvasViewport>,
) -> AppResult<NodeLayoutSet> {
    state.db.save_node_layout(&agent_id, version, &nodes, viewport)
}

/// Sticky notes on the canvas of `version` (current when absent).
#[tauri::command]
pub fn get_canvas_notes(
    state: State<'_, AppState>,
    agent_id: String,
    version: Option<i64>,
) -> AppResult<CanvasNoteSet> {
    let version = match version {
        Some(version) => version,
        None => state.db.get_agent(&agent_id)?.current_version,
    };
    state.db.get_canvas_notes(&agent_id, version)
}

/// Replaces the sticky notes of `version` (adds no version; copied forward to new ones).
#[tauri::command]
pub fn save_canvas_notes(
    state: State<'_, AppState>,
    agent_id: String,
    version: i64,
    notes: Vec<CanvasNote>,
) -> AppResult<CanvasNoteSet> {
    state.db.save_canvas_notes(&agent_id, version, &notes)
}

/// Input schemas of the plugin and MCP server tools a "Use a tool" or "Run an agent" step
/// can call (manifest schemas, and what each server reported on its last connection test).
#[tauri::command]
pub fn get_tool_input_schemas(state: State<'_, AppState>) -> AppResult<Vec<ToolInputSchema>> {
    let servers = crate::mcp::definitions::load_definitions(&state.db)?;
    Ok(tool_schemas::collect_tool_input_schemas(&state.plugins.tool_specs(), &servers))
}

/// Whether the builder is changing the agent right now (cheap; also see [`AGENT_EDIT_STATE_EVENT`]).
#[tauri::command]
pub fn get_agent_edit_state(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentEditState> {
    agent_graph::agent_edit_state(&state.db, &agent_id)
}

/// Runs `action` with the draft registry, the runnable kinds and the model providers set up.
fn with_graph_context<T>(
    state: &AppState,
    agent_id: &str,
    action: impl FnOnce(&GraphContext<'_>) -> AppResult<T>,
) -> AppResult<T> {
    let registry = flow::draft_node_registry();
    let runnable_kinds = agent_graph::registry_kinds(&flow::node_registry());
    let available_providers = match credentials::build_model_registry(&state.credentials, &state.db) {
        Ok(models) => Some(models.names().map(str::to_owned).collect::<Vec<_>>()),
        Err(error) => {
            log::warn!("could not read the model providers set up, skipping that check: {error}");
            None
        }
    };
    let mut context = GraphContext::new(&registry);
    context.validation.runnable_kinds = Some(&runnable_kinds);
    context.validation.available_providers = available_providers.as_deref();
    context.validation.trusted_hosts = state.db.trusted_lookup_hosts(agent_id)?;
    action(&context)
}
