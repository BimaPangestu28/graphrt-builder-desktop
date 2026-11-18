//! Scheduler screen (10): rules for every schedule and the runs schedules started.

use chrono::{DateTime, Utc};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::scheduler::rules::ScheduleRules;
use crate::state::AppState;
use crate::storage::models::{Run, RunTrigger};

/// Longest window `list_scheduled_runs` accepts (a calendar week plus margin).
const MAX_WINDOW_DAYS: i64 = 42;

#[tauri::command]
pub fn get_schedule_rules(state: State<'_, AppState>) -> AppResult<ScheduleRules> {
    ScheduleRules::load(&state.db)
}

/// Stores the rules; the scheduler reads them on its next tick.
#[tauri::command]
pub fn update_schedule_rules(state: State<'_, AppState>, rules: ScheduleRules) -> AppResult<ScheduleRules> {
    rules.save(&state.db)?;
    Ok(rules)
}

fn parse_bound(text: &str, name: &str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text.trim())
        .map(|time| time.with_timezone(&Utc))
        .map_err(|error| AppError::InvalidInput(format!("{name} is not an RFC 3339 time: {error}")))
}

/// Runs started by a schedule in `[since, until)` (RFC 3339), oldest first.
///
/// @throws AppError::InvalidInput - when a bound does not parse, or the window is reversed or longer than 6 weeks
#[tauri::command]
pub fn list_scheduled_runs(state: State<'_, AppState>, since: String, until: String) -> AppResult<Vec<Run>> {
    let since_time = parse_bound(&since, "since")?;
    let until_time = parse_bound(&until, "until")?;
    if until_time <= since_time || until_time - since_time > chrono::Duration::days(MAX_WINDOW_DAYS) {
        return Err(AppError::InvalidInput(format!(
            "the time window must be positive and at most {MAX_WINDOW_DAYS} days"
        )));
    }
    // Stored times come from `to_rfc3339` in UTC, so the same format compares as text.
    state.db.list_runs_started_between(&since_time.to_rfc3339(), &until_time.to_rfc3339(), RunTrigger::Schedule)
}
