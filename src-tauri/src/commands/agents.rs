use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::models::{Agent, AgentStatus, AgentVersion, RunFilter, RunStatus};

#[tauri::command]
pub fn list_agents(state: State<'_, AppState>) -> AppResult<Vec<Agent>> {
    state.db.list_agents()
}

#[tauri::command]
pub fn get_agent(state: State<'_, AppState>, agent_id: String) -> AppResult<Agent> {
    state.db.get_agent(&agent_id)
}

#[tauri::command]
pub fn rename_agent(state: State<'_, AppState>, agent_id: String, name: String) -> AppResult<Agent> {
    state.db.rename_agent(&agent_id, &name)
}

#[tauri::command]
pub fn set_agent_status(state: State<'_, AppState>, agent_id: String, status: AgentStatus) -> AppResult<Agent> {
    state.db.set_agent_status(&agent_id, status)
}

#[tauri::command]
pub fn delete_agent(state: State<'_, AppState>, agent_id: String) -> AppResult<()> {
    // Stop the agent's running or paused runs first, so no run task keeps writing
    // events for an agent that no longer exists. Versions, runs, schedules and
    // chain steps go with the agent (ON DELETE CASCADE).
    for status in [RunStatus::Running, RunStatus::Paused] {
        let filter = RunFilter { agent_id: Some(agent_id.clone()), status: Some(status), limit: Some(1000) };
        for run in state.db.list_runs(&filter)? {
            if let Err(error) = state.runs.abort_run(&run.id) {
                log::warn!("could not stop run {} before deleting its agent: {error}", run.id);
            }
        }
    }
    state.db.delete_agent(&agent_id)
}

#[tauri::command]
pub fn list_agent_versions(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<AgentVersion>> {
    state.db.list_agent_versions(&agent_id)
}

#[tauri::command]
pub fn restore_agent_version(state: State<'_, AppState>, agent_id: String, version: i64) -> AppResult<Agent> {
    state.db.restore_agent_version(&agent_id, version)
}
