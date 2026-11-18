//! MCP servers (Connections > Advanced): list, add, remove and test the connection.
//! Every change republishes the list so new runs and the builder prompt see it.

use tauri::State;

use crate::error::AppResult;
use crate::mcp::{self, definitions, McpServerDefinition, McpServerInput};
use crate::state::AppState;

#[tauri::command]
pub fn list_mcp_servers(state: State<'_, AppState>) -> AppResult<Vec<McpServerDefinition>> {
    definitions::load_definitions(&state.db)
}

/// Stores a new server (no connection yet: use `test_mcp_server`).
#[tauri::command]
pub fn add_mcp_server(state: State<'_, AppState>, server: McpServerInput) -> AppResult<McpServerDefinition> {
    let (added, all_definitions) = definitions::add_definition(&state.db, server)?;
    mcp::publish(all_definitions);
    Ok(added)
}

#[tauri::command]
pub fn remove_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let all_definitions = definitions::remove_definition(&state.db, name.trim())?;
    mcp::publish(all_definitions);
    Ok(())
}

/// Connects, lists the tools and disconnects; the outcome is stored in `lastCheck`.
#[tauri::command]
pub async fn test_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<McpServerDefinition> {
    mcp::check_connection(&state.db, &state.credentials, name.trim()).await
}
