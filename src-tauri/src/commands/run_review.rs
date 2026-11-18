//! Reviewing paused runs (screen 19) and the inputs runs started with (screens 06, 07);
//! see [`crate::run_review`] and `storage::run_inputs`.

use tauri::State;

use crate::error::AppResult;
use crate::run_review::{self, RunReview};
use crate::state::AppState;

/// What the run waits for. Without `runId`: the latest run waiting on human input (`null` when none).
#[tauri::command]
pub fn get_run_review(state: State<'_, AppState>, run_id: Option<String>) -> AppResult<Option<RunReview>> {
    match run_id {
        Some(run_id) => run_review::get_run_review(&state.db, &run_id).map(Some),
        None => run_review::latest_pending_review(&state.db),
    }
}

/// The inputs the run started with (`null` for runs from before inputs were kept).
#[tauri::command]
pub fn get_run_inputs(state: State<'_, AppState>, run_id: String) -> AppResult<Option<serde_json::Value>> {
    state.db.get_run_inputs(&run_id)
}

/// Inputs of the agent's latest run, to prefill the next one (`null` when it never ran).
#[tauri::command]
pub fn get_last_run_inputs(state: State<'_, AppState>, agent_id: String) -> AppResult<Option<serde_json::Value>> {
    state.db.get_last_run_inputs(&agent_id)
}
