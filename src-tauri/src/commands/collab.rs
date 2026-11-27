//! Teams (see `crate::collab`): the team server, signing in, teams, sharing an agent and
//! who is in it. The refresh token of a sign in never reaches the webview.

use serde_json::Value;
use tauri::State;

use crate::collab::{AgentCollab, CollabStatus, ServerCheck};
use crate::error::AppResult;
use crate::state::AppState;

/// The team server and the sign in on it.
#[tauri::command]
pub async fn collab_status(state: State<'_, AppState>) -> AppResult<CollabStatus> {
    state.collab.status().await
}

/// Checks a team server address as typed (nothing is saved).
#[tauri::command]
pub async fn collab_check_server(state: State<'_, AppState>, address: String) -> AppResult<ServerCheck> {
    Ok(state.collab.check(&address).await)
}

/// Uses another team server. Local agents stay.
#[tauri::command]
pub async fn collab_set_server(state: State<'_, AppState>, address: String) -> AppResult<CollabStatus> {
    state.collab.set_server(&address).await
}

/// Signs in with the server's identity provider in the browser.
#[tauri::command]
pub async fn collab_sign_in(state: State<'_, AppState>) -> AppResult<CollabStatus> {
    state.collab.sign_in().await
}

/// Signs out of the team server.
#[tauri::command]
pub async fn collab_sign_out(state: State<'_, AppState>) -> AppResult<CollabStatus> {
    state.collab.sign_out().await
}

/// What an invite link is for: the team, the role, who invited.
#[tauri::command]
pub async fn collab_preview_invite(state: State<'_, AppState>, link: String) -> AppResult<Value> {
    state.collab.preview_invite(&link).await
}

/// Joins a team with an invite link (`name` for a new account on servers without sign in).
#[tauri::command]
pub async fn collab_join(state: State<'_, AppState>, link: String, name: Option<String>) -> AppResult<Value> {
    state.collab.join(&link, name.as_deref()).await
}

/// The teams of the signed in account.
#[tauri::command]
pub async fn collab_workspaces(state: State<'_, AppState>) -> AppResult<Value> {
    state.collab.workspaces().await
}

/// Creates a team.
#[tauri::command]
pub async fn collab_create_workspace(state: State<'_, AppState>, name: String) -> AppResult<Value> {
    state.collab.create_workspace(&name).await
}

/// A team: members, shared agents and who is in them.
#[tauri::command]
pub async fn collab_workspace(state: State<'_, AppState>, workspace_id: String) -> AppResult<Value> {
    state.collab.workspace(&workspace_id).await
}

/// An invite link to a team, to view (`viewer`) or to edit (`operator`).
#[tauri::command]
pub async fn collab_invite(state: State<'_, AppState>, workspace_id: String, role: String) -> AppResult<Value> {
    state.collab.invite(&workspace_id, &role).await
}

/// Changes a member's role, or removes them (`role` absent).
#[tauri::command]
pub async fn collab_set_member(
    state: State<'_, AppState>,
    workspace_id: String,
    account_id: String,
    role: Option<String>,
) -> AppResult<Value> {
    state.collab.set_member(&workspace_id, &account_id, role.as_deref()).await
}

/// Shares a local agent with a team.
#[tauri::command]
pub async fn collab_share_agent(
    state: State<'_, AppState>,
    agent_id: String,
    workspace_id: String,
) -> AppResult<AgentCollab> {
    state.collab.share(&agent_id, &workspace_id).await
}

/// Opens a team's shared agent on this computer.
///
/// @returns The local agent's id.
#[tauri::command]
pub async fn collab_open_project(
    state: State<'_, AppState>,
    workspace_id: String,
    project_id: String,
) -> AppResult<String> {
    state.collab.open_project(&workspace_id, &project_id).await
}

/// Stops sharing an agent on this computer (it stays a local agent).
#[tauri::command]
pub fn collab_stop_sharing(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentCollab> {
    state.collab.stop_sharing(&agent_id)
}

/// The sharing state of an agent: connection, role, who is there.
#[tauri::command]
pub fn collab_agent(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentCollab> {
    state.collab.agent_state(&agent_id)
}

/// Tells the others which step this person looks at.
#[tauri::command]
pub fn collab_set_focus(state: State<'_, AppState>, agent_id: String, node_id: Option<String>) {
    state.collab.set_focus(&agent_id, node_id.as_deref());
}
