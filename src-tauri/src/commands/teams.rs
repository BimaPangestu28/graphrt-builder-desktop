//! Teams (screen 13): activity, guardrails and the coordinator chat.
//! See `crate::teams`.

use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::models::{Run, RunTrigger};
use crate::teams::guardrails::{self, TeamGuardrails};
use crate::teams::{self, CoordinatorExchange, TeamActivityEntry};

/// What the team and its members did lately, newest first.
#[tauri::command]
pub fn list_team_activity(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<TeamActivityEntry>> {
    teams::list_team_activity(&state.db, &agent_id)
}

#[tauri::command]
pub fn get_team_guardrails(state: State<'_, AppState>, agent_id: String) -> AppResult<TeamGuardrails> {
    guardrails::get_team_guardrails(&state.db, &agent_id)
}

/// Sets (or clears with `null`) the most member-agent calls in one team run.
#[tauri::command]
pub fn set_team_max_agent_calls(
    state: State<'_, AppState>,
    agent_id: String,
    limit: Option<u32>,
) -> AppResult<TeamGuardrails> {
    guardrails::set_max_agent_calls_per_run(&state.db, &agent_id, limit)
}

/// The team agent's recent runs as chat exchanges, oldest first.
#[tauri::command]
pub fn list_coordinator_chat(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<CoordinatorExchange>> {
    teams::list_coordinator_chat(&state.db, &agent_id)
}

/// Starts a run of the team agent with `message` as its goal.
#[tauri::command]
pub async fn send_coordinator_message(state: State<'_, AppState>, agent_id: String, message: String) -> AppResult<Run> {
    let team_agent = state.db.get_agent(&agent_id)?;
    let inputs = teams::coordinator_run_inputs(&team_agent, &message)?;
    state.runs.start_run(&agent_id, RunTrigger::Manual, inputs).await
}
