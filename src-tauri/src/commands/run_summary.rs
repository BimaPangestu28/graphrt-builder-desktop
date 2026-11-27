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

/// Opens the target of a card's `Action.OpenUrl` in the default browser, after the person
/// clicked it. Only `https` and `mailto` links (see [`crate::ui_blocks::is_openable_link`]).
///
/// @throws AppError::InvalidInput - when the link is not https or mailto
/// @throws AppError::Internal - when the browser cannot be started
#[tauri::command]
pub fn open_card_link(url: String) -> AppResult<()> {
    if !crate::ui_blocks::is_openable_link(&url) {
        return Err(crate::error::AppError::InvalidInput("cards can only open https and mailto links".into()));
    }
    crate::crash_reports::sharing::open_in_browser(&url)
}

/// Opens a file the run made with its default app, after the person clicked "Open file".
/// Only a file the run's steps reported and wrote (see [`crate::run_files`]).
#[tauri::command]
pub fn open_run_file(state: State<'_, AppState>, run_id: String, path: String) -> AppResult<()> {
    crate::run_files::open_run_file(&state.db, &run_id, &path)
}

/// Opens the folder of a file the run made in the file manager.
#[tauri::command]
pub fn open_run_file_folder(state: State<'_, AppState>, run_id: String, path: String) -> AppResult<()> {
    crate::run_files::open_run_file_folder(&state.db, &run_id, &path)
}
