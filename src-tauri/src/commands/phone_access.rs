//! Settings > Phone access: serve the monitoring page of this computer's agents to paired
//! phones (see `crate::phone_access`). Pairing and removing phones go through the pairing
//! commands of `deploy` with the target `{ kind: "computer" }`, so the same screen pairs
//! phones of an online agent and of this computer.

use tauri::State;

use crate::error::AppResult;
use crate::phone_access::{Activity, PhoneAccessSettings, PhoneAccessStatus};
use crate::state::AppState;

/// Whether phones can connect, where, and what Tailscale offers.
#[tauri::command]
pub async fn phone_access_status(state: State<'_, AppState>) -> AppResult<PhoneAccessStatus> {
    state.phone_access.status().await
}

/// Saves the choice (on or off, where phones reach the computer) and serves accordingly.
#[tauri::command]
pub async fn save_phone_access(
    state: State<'_, AppState>,
    settings: PhoneAccessSettings,
) -> AppResult<PhoneAccessStatus> {
    state.phone_access.save(settings).await
}

/// What paired phones did lately, newest first.
#[tauri::command]
pub fn phone_access_activity(state: State<'_, AppState>, limit: Option<usize>) -> AppResult<Vec<Activity>> {
    state.phone_access.activity(limit.unwrap_or(20))
}
