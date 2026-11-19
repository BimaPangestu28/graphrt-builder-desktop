use tauri::ipc::Channel;
use tauri::State;

use crate::agent_builder::{self, BuildProgress, BuildRequest, RevisionResult};
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowSummary};
use crate::state::AppState;
use crate::storage::models::{Agent, BuilderMessage};

/// Progress arrives on `on_progress` while the agent is drafted (screen 03).
#[tauri::command]
pub async fn build_agent(
    state: State<'_, AppState>,
    request: BuildRequest,
    on_progress: Channel<BuildProgress>,
) -> AppResult<Agent> {
    if request.description.trim().is_empty() {
        return Err(AppError::InvalidInput("describe what the agent should do".into()));
    }
    let report = move |progress: BuildProgress| {
        // A closed channel only means the screen was left; building continues.
        let _ = on_progress.send(progress);
    };
    // The builder lists catalog plugins too; a slow network only delays this briefly.
    state.plugins.refresh_catalog_for_builder().await;
    agent_builder::build_agent(&state.db, &state.credentials, request, &report).await
}

#[tauri::command]
pub async fn revise_agent(
    state: State<'_, AppState>,
    agent_id: String,
    instruction: String,
    on_progress: Channel<BuildProgress>,
) -> AppResult<RevisionResult> {
    if instruction.trim().is_empty() {
        return Err(AppError::InvalidInput("describe the change".into()));
    }
    let report = move |progress: BuildProgress| {
        let _ = on_progress.send(progress);
    };
    state.plugins.refresh_catalog_for_builder().await;
    agent_builder::revise_agent_from_chat(&state.db, &state.credentials, &agent_id, &instruction, &report).await
}

/// The agent's saved builder chat, oldest first, shown before new changes on screen 04.
#[tauri::command]
pub fn list_builder_messages(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<BuilderMessage>> {
    state.db.list_builder_messages(&agent_id)
}

/// Steps and inputs of an agent's current version, for the builder and run screens.
#[tauri::command]
pub fn get_flow_summary(state: State<'_, AppState>, agent_id: String) -> AppResult<FlowSummary> {
    let agent = state.db.get_agent(&agent_id)?;
    flow::summarize_flow(&agent.flow_yaml)
}
