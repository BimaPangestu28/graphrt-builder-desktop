use tauri::State;

use crate::error::{AppError, AppResult};
use crate::scheduler;
use crate::state::AppState;
use crate::storage::models::{NewTrigger, Trigger};

fn next_fire_from_now(new_trigger: &NewTrigger) -> AppResult<Option<String>> {
    scheduler::next_fire_after(&new_trigger.cron_expression, &new_trigger.timezone, chrono::Utc::now())
}

#[tauri::command]
pub fn list_triggers(state: State<'_, AppState>, agent_id: Option<String>) -> AppResult<Vec<Trigger>> {
    state.db.list_triggers(agent_id.as_deref())
}

#[tauri::command]
pub fn create_trigger(state: State<'_, AppState>, new_trigger: NewTrigger) -> AppResult<Trigger> {
    let next_fire_at = next_fire_from_now(&new_trigger)?;
    state.db.create_trigger(new_trigger, next_fire_at.as_deref())
}

#[tauri::command]
pub fn update_trigger(state: State<'_, AppState>, trigger_id: String, changes: NewTrigger) -> AppResult<Trigger> {
    let next_fire_at = next_fire_from_now(&changes)?;
    state.db.update_trigger(&trigger_id, changes, next_fire_at.as_deref())
}

#[tauri::command]
pub fn set_trigger_enabled(state: State<'_, AppState>, trigger_id: String, enabled: bool) -> AppResult<Trigger> {
    let trigger = state.db.get_trigger(&trigger_id)?;
    let next_fire_at = if enabled {
        scheduler::next_fire_after(&trigger.cron_expression, &trigger.timezone, chrono::Utc::now())?
    } else {
        None
    };
    state.db.set_trigger_enabled(&trigger_id, enabled, next_fire_at.as_deref())
}

#[tauri::command]
pub fn delete_trigger(state: State<'_, AppState>, trigger_id: String) -> AppResult<()> {
    state.db.delete_trigger(&trigger_id)
}

/// Upcoming fire times for the schedule dialog, without saving anything.
#[tauri::command]
pub fn preview_schedule(cron_expression: String, timezone: String, count: Option<usize>) -> AppResult<Vec<String>> {
    let count = count.unwrap_or(5);
    if count == 0 || count > 50 {
        return Err(AppError::InvalidInput("count must be between 1 and 50".into()));
    }
    scheduler::preview_fire_times(&cron_expression, &timezone, count)
}
