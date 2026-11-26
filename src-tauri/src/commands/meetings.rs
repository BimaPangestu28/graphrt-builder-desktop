//! Meeting notes: the prompt card, the recording pill, the Settings section and the
//! "When a meeting is recorded" trigger of an agent's schedule. Logic lives in
//! `crate::meeting`; nothing here records without the user's click.

use tauri::State;

use crate::error::AppResult;
use crate::meeting::settings::MeetingSettings;
use crate::meeting::store::MeetingRecord;
use crate::meeting::trigger::{self, MeetingTrigger};
use crate::meeting::MeetingStatusView;
use crate::state::AppState;

/// Detection, prompt, recording and transcriber state.
#[tauri::command]
pub async fn get_meeting_status(state: State<'_, AppState>) -> AppResult<MeetingStatusView> {
    Ok(state.meetings.status().await)
}

/// Saves the detection switch and "keep meeting audio"; returns them as saved.
#[tauri::command]
pub fn update_meeting_settings(state: State<'_, AppState>, settings: MeetingSettings) -> AppResult<MeetingSettings> {
    state.meetings.update_settings(settings)
}

/// "Not now" on the prompt, or "Keep recording" before it stops by itself.
#[tauri::command]
pub fn dismiss_meeting_prompt(state: State<'_, AppState>) {
    state.meetings.dismiss_prompt();
}

/// "Take notes": starts recording the microphone and the computer's sound.
///
/// Errors the UI shows: `invalid_input` while already recording, `internal` when the
/// audio system cannot record (the message says why).
#[tauri::command]
pub async fn start_meeting_recording(state: State<'_, AppState>) -> AppResult<MeetingRecord> {
    Ok(state.meetings.start_recording().await?)
}

/// Stop: finishes the recording and starts the agents with the meeting trigger.
#[tauri::command]
pub async fn stop_meeting_recording(state: State<'_, AppState>) -> AppResult<MeetingRecord> {
    Ok(state.meetings.stop_recording().await?)
}

/// Whether the agent runs when a meeting is recorded (Schedule screen).
#[tauri::command]
pub fn get_meeting_trigger(state: State<'_, AppState>, agent_id: String) -> AppResult<MeetingTrigger> {
    trigger::load(&state.db, agent_id.trim())
}

#[tauri::command]
pub fn set_meeting_trigger(state: State<'_, AppState>, agent_id: String, enabled: bool) -> AppResult<MeetingTrigger> {
    let saved = trigger::save(&state.db, agent_id.trim(), MeetingTrigger { enabled })?;
    state.meetings.triggers_changed();
    Ok(saved)
}
