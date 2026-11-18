use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::models::{Run, RunEventRecord, RunFilter, RunTrigger};

#[tauri::command]
pub async fn start_run(state: State<'_, AppState>, agent_id: String, trigger: RunTrigger, inputs: serde_json::Value) -> AppResult<Run> {
    state.runs.start_run(&agent_id, trigger, inputs).await
}

#[tauri::command]
pub async fn resume_run(state: State<'_, AppState>, run_id: String, node_inputs: serde_json::Value) -> AppResult<Run> {
    state.runs.resume_run(&run_id, node_inputs).await
}

#[tauri::command]
pub fn abort_run(state: State<'_, AppState>, run_id: String) -> AppResult<()> {
    state.runs.abort_run(&run_id)
}

#[tauri::command]
pub fn list_runs(state: State<'_, AppState>, filter: Option<RunFilter>) -> AppResult<Vec<Run>> {
    state.db.list_runs(&filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_run(state: State<'_, AppState>, run_id: String) -> AppResult<Run> {
    state.db.get_run(&run_id)
}

#[tauri::command]
pub fn list_run_events(state: State<'_, AppState>, run_id: String) -> AppResult<Vec<RunEventRecord>> {
    state.db.list_run_events(&run_id)
}
