//! Attaching files to a chat, and showing and saving the files an agent made
//! (`crate::agent_files`).
//!
//! The webview never sends a path on this computer to these commands, except the paths of
//! a drop, which are taken only when the window reported that drop. Picking and saving
//! open the system dialogs from here.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::agent_files::abilities::FlowFileUse;
use crate::agent_files::{AttachOutcome, FileAbilities, FileCard, FilePreview, FileScope, PathOrigin};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Longest dialog title taken from the webview (it is only shown, never used as a path).
const MAX_DIALOG_TITLE_CHARS: usize = 80;

fn dialog_title(title: &str) -> String {
    title.chars().filter(|character| !character.is_control()).take(MAX_DIALOG_TITLE_CHARS).collect()
}

/// Whether an agent reads files, looks at pictures and hands files back.
#[tauri::command]
pub fn get_agent_file_abilities(state: State<'_, AppState>, agent_id: String) -> AppResult<FileAbilities> {
    Ok(FlowFileUse::of(&state.db.get_agent(&agent_id)?.flow_yaml).abilities())
}

/// The agent, the scope and the abilities of a conversation's attachments.
fn chat_scope(state: &AppState, conversation_id: &str) -> AppResult<(FileScope, FileAbilities)> {
    let conversation = state.db.get_conversation(conversation_id)?;
    let agent = state.db.get_agent(&conversation.agent_id)?;
    let abilities = FlowFileUse::of(&agent.flow_yaml).abilities();
    if !abilities.takes_attachments() {
        return Err(AppError::InvalidInput("this chatbot does not take files yet".into()));
    }
    Ok((FileScope::conversation(&agent.id, conversation_id), abilities))
}

/// Opens the system file dialog and attaches what the person chose to the conversation.
/// Returns one outcome per chosen file; an empty list when the dialog was closed.
#[tauri::command]
pub async fn pick_chat_attachments(
    window: Window,
    state: State<'_, AppState>,
    conversation_id: String,
    title: String,
    already_attached: usize,
) -> AppResult<Vec<AttachOutcome>> {
    let (scope, abilities) = chat_scope(&state, &conversation_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().file().set_parent(&window).set_title(dialog_title(&title)).pick_files(move |chosen| {
        // The receiver is gone only when the command was dropped: nothing to tell.
        let _ = sender.send(chosen);
    });
    let chosen = receiver.await.map_err(|_| AppError::Internal("the file dialog closed unexpectedly".into()))?;
    let paths: Vec<PathBuf> =
        chosen.unwrap_or_default().into_iter().filter_map(|chosen: FilePath| chosen.into_path().ok()).collect();
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    state.agent_files.attach_host_files(&scope, abilities, paths, PathOrigin::PickedInDialog, already_attached).await
}

/// Attaches files dropped onto the window. A path the window did not report as dropped
/// is refused.
#[tauri::command]
pub async fn attach_dropped_chat_files(
    state: State<'_, AppState>,
    conversation_id: String,
    paths: Vec<String>,
    already_attached: usize,
) -> AppResult<Vec<AttachOutcome>> {
    let (scope, abilities) = chat_scope(&state, &conversation_id)?;
    let paths = paths.into_iter().map(PathBuf::from).collect();
    state.agent_files.attach_host_files(&scope, abilities, paths, PathOrigin::Dropped, already_attached).await
}

/// Removes an attached file the person took off the message before sending it.
#[tauri::command]
pub async fn discard_chat_attachment(
    state: State<'_, AppState>,
    conversation_id: String,
    reference: String,
) -> AppResult<()> {
    let conversation = state.db.get_conversation(&conversation_id)?;
    let scope = FileScope::conversation(&conversation.agent_id, &conversation_id);
    state.agent_files.discard_attachment(&scope, &reference).await
}

/// The files a run made, for the Run result screen.
#[tauri::command]
pub async fn list_run_files(state: State<'_, AppState>, run_id: String) -> AppResult<Vec<FileCard>> {
    let run = state.db.get_run(&run_id)?;
    let events = state.db.list_run_events(&run_id)?;
    state.agent_files.run_file_cards(&run.agent_id, events.iter().map(|record| &record.event)).await
}

/// What a card may show of a file: a small copy of a picture, or nothing.
#[tauri::command]
pub async fn preview_agent_file(
    state: State<'_, AppState>,
    agent_id: String,
    reference: String,
) -> AppResult<FilePreview> {
    state.agent_files.preview(&agent_id, &reference).await
}

/// What saving a file did. Keep `src/api/agentFileTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    /// `false` when the person closed the dialog.
    pub saved: bool,
    /// The name it was saved under.
    pub file_name: Option<String>,
}

/// Opens the system save dialog and writes a copy of the file where the person chose.
/// The one way a file of an agent leaves the app: chat replies, run results and UI blocks
/// all name the file by its `reference`.
#[tauri::command]
pub async fn save_agent_file(
    window: Window,
    state: State<'_, AppState>,
    agent_id: String,
    reference: String,
    title: String,
) -> AppResult<SaveOutcome> {
    let (_, path, _) = state.agent_files.locate(&agent_id, &reference).await?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(dialog_title(&title))
        .set_file_name(path.file_name())
        .save_file(move |chosen| {
            // The receiver is gone only when the command was dropped: nothing to tell.
            let _ = sender.send(chosen);
        });
    let chosen = receiver.await.map_err(|_| AppError::Internal("the save dialog closed unexpectedly".into()))?;
    let Some(destination) = chosen.and_then(|chosen: FilePath| chosen.into_path().ok()) else {
        return Ok(SaveOutcome { saved: false, file_name: None });
    };
    state.agent_files.save_copy(&agent_id, &reference, &destination).await?;
    let file_name = destination.file_name().map(|name| name.to_string_lossy().into_owned());
    Ok(SaveOutcome { saved: true, file_name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_titles_are_short_plain_text() {
        assert_eq!(dialog_title("Attach files"), "Attach files");
        assert_eq!(dialog_title("a\nb\u{0}c"), "abc");
        assert_eq!(dialog_title(&"x".repeat(500)).chars().count(), MAX_DIALOG_TITLE_CHARS);
    }
}
