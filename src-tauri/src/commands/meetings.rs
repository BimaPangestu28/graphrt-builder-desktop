//! Meeting notes (Meetings page, the prompt and the recording pill). Logic lives in
//! `crate::meeting`; nothing here records without the user's click.

use tauri::State;

use crate::error::AppResult;
use crate::meeting::settings::MeetingSettings;
use crate::meeting::store::MeetingRecord;
use crate::meeting::MeetingStatusView;
use crate::state::AppState;

/// Detection, prompt, recording and transcriber state.
#[tauri::command]
pub async fn get_meeting_status(state: State<'_, AppState>) -> AppResult<MeetingStatusView> {
    Ok(state.meetings.status().await)
}

/// Saves the detection switch and the whisper paths; returns them as saved.
#[tauri::command]
pub fn update_meeting_settings(state: State<'_, AppState>, settings: MeetingSettings) -> AppResult<MeetingSettings> {
    state.meetings.update_settings(settings)
}

/// "Not now" on the prompt, or "Keep recording" on "Meeting seems over".
#[tauri::command]
pub fn dismiss_meeting_prompt(state: State<'_, AppState>) {
    state.meetings.dismiss_prompt();
}

/// Starts recording the microphone and the computer's sound (the user's click).
///
/// Errors the UI shows: `invalid_input` while already recording, `internal` when
/// the audio system cannot record (message says why).
#[tauri::command]
pub async fn start_meeting_recording(state: State<'_, AppState>, app: Option<String>) -> AppResult<MeetingRecord> {
    Ok(state.meetings.start_recording(app).await?)
}

#[tauri::command]
pub async fn stop_meeting_recording(state: State<'_, AppState>) -> AppResult<MeetingRecord> {
    Ok(state.meetings.stop_recording().await?)
}

/// Every meeting, newest first.
#[tauri::command]
pub fn list_meetings(state: State<'_, AppState>) -> AppResult<Vec<MeetingRecord>> {
    Ok(state.meetings.list()?)
}

/// Transcribes a meeting with whisper.cpp on this computer (can take minutes).
#[tauri::command]
pub async fn transcribe_meeting(state: State<'_, AppState>, meeting_id: String) -> AppResult<MeetingRecord> {
    Ok(state.meetings.transcribe(meeting_id.trim()).await?)
}

/// The transcript as Markdown (`[00:01:05] You: …`).
#[tauri::command]
pub fn get_meeting_transcript(state: State<'_, AppState>, meeting_id: String) -> AppResult<String> {
    Ok(state.meetings.transcript(meeting_id.trim())?)
}

/// Deletes a meeting's folder (audio and transcript).
#[tauri::command]
pub async fn delete_meeting(state: State<'_, AppState>, meeting_id: String) -> AppResult<()> {
    Ok(state.meetings.delete(meeting_id.trim()).await?)
}
