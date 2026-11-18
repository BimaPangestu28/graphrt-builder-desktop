//! Chains of agents (screen 11). Starting the next agents is done by `crate::chains`.

use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::chains::{Chain, ChainDraft, ChainStatus};
use crate::storage::models::Run;

#[tauri::command]
pub fn list_chains(state: State<'_, AppState>) -> AppResult<Vec<Chain>> {
    state.db.list_chains()
}

#[tauri::command]
pub fn get_chain(state: State<'_, AppState>, chain_id: String) -> AppResult<Chain> {
    state.db.get_chain(&chain_id)
}

/// New chains start paused; activate them with `set_chain_status`.
#[tauri::command]
pub fn create_chain(state: State<'_, AppState>, draft: ChainDraft) -> AppResult<Chain> {
    state.db.create_chain(draft)
}

/// Replaces the name and every step (agents, input mapping, conditions).
#[tauri::command]
pub fn update_chain(state: State<'_, AppState>, chain_id: String, draft: ChainDraft) -> AppResult<Chain> {
    state.db.update_chain(&chain_id, draft)
}

#[tauri::command]
pub fn delete_chain(state: State<'_, AppState>, chain_id: String) -> AppResult<()> {
    state.db.delete_chain(&chain_id)
}

/// Activate (finished runs start the next agents) or pause a chain.
#[tauri::command]
pub fn set_chain_status(state: State<'_, AppState>, chain_id: String, status: ChainStatus) -> AppResult<Chain> {
    state.db.set_chain_status(&chain_id, status)
}

/// Starts the chain's first agent with the first step's inputs; the rest follows on its own.
#[tauri::command]
pub async fn test_chain(state: State<'_, AppState>, chain_id: String) -> AppResult<Run> {
    state.chains.test_chain(&chain_id).await
}
