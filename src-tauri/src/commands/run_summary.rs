//! Run summaries for the Run result (07) and Home (09) screens; see [`crate::run_summary`].

use tauri::State;

use crate::error::AppResult;
use crate::run_summary::{self, AgentRunStats, RunSummary};
use crate::state::AppState;

/// Headline, items, counters, step and approval counts of one run.
#[tauri::command]
pub fn get_run_summary(state: State<'_, AppState>, run_id: String) -> AppResult<RunSummary> {
    run_summary::get_run_summary(&state.db, &run_id)
}

/// Last-7-days run stats of one agent, or of every agent when `agentId` is omitted.
#[tauri::command]
pub fn list_agent_run_stats(state: State<'_, AppState>, agent_id: Option<String>) -> AppResult<Vec<AgentRunStats>> {
    run_summary::agent_run_stats(&state.db, agent_id.as_deref())
}
