//! Run and token totals for the Home "This month" card (09); see [`crate::usage_summary`].

use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::usage_summary::{self, UsageSummary};

/// Runs started at or after `fromDate` (RFC 3339) and the model tokens they used.
#[tauri::command]
pub fn get_usage_summary(state: State<'_, AppState>, from_date: String) -> AppResult<UsageSummary> {
    usage_summary::usage_summary_since(&state.db, &from_date)
}
