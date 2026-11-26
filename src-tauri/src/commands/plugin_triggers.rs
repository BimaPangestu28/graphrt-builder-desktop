//! Plugin triggers on an agent's Schedule screen ("When a meeting is recorded"). Logic
//! lives in `crate::plugin_triggers`.

use tauri::State;

use crate::error::AppResult;
use crate::plugin_triggers::{self, AvailableTrigger, TriggerRef};
use crate::state::AppState;

/// Every trigger of the installed plugins, with why one cannot run now.
#[tauri::command]
pub fn list_plugin_triggers(state: State<'_, AppState>) -> Vec<AvailableTrigger> {
    state.plugin_triggers.available()
}

/// The agent's plugin trigger, if it has one.
#[tauri::command]
pub fn get_agent_plugin_trigger(state: State<'_, AppState>, agent_id: String) -> AppResult<Option<TriggerRef>> {
    plugin_triggers::load_subscription(&state.db, agent_id.trim())
}

/// Sets (or, with `trigger: null`, clears) the agent's plugin trigger. Setting one
/// activates the agent.
///
/// Errors the UI shows: `invalid_input` for a trigger no installed plugin declares.
#[tauri::command]
pub fn set_agent_plugin_trigger(
    state: State<'_, AppState>,
    agent_id: String,
    trigger: Option<TriggerRef>,
) -> AppResult<Option<TriggerRef>> {
    state.plugin_triggers.set_subscription(agent_id.trim(), trigger)
}
