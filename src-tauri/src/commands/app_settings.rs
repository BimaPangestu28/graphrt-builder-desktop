//! Settings screen (22): desktop preferences, export and delete all data.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::desktop as desktop_integration;
use crate::desktop::app_settings::AppSettings;
use crate::desktop::data::{self, DeletionSummary, ExportSummary};
use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::models::{RunFilter, RunStatus};

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    AppSettings::load(&state.db)
}

/// Stores every field, then applies launch at login, the tray icon and keep awake.
#[tauri::command]
pub fn update_app_settings(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    settings.save(&state.db)?;
    desktop_integration::apply_settings(&app_handle, &settings);
    Ok(settings)
}

/// Writes every agent (workflow, versions, schedules; no secrets) as JSON to `path`.
#[tauri::command]
pub fn export_agents(state: State<'_, AppState>, path: String) -> AppResult<ExportSummary> {
    data::export_agents_to_file(&state.db, &PathBuf::from(path.trim()))
}

/// Stops open runs, then deletes agents, runs, schedules and settings; with
/// `remove_keychain_items` also the saved provider keys and workflow secrets.
#[tauri::command]
pub fn delete_all_data(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    remove_keychain_items: bool,
) -> AppResult<DeletionSummary> {
    abort_open_runs(&state);
    let summary = data::delete_all_data(&state.db, &state.credentials, remove_keychain_items)?;
    desktop_integration::apply_settings(&app_handle, &AppSettings::default());
    Ok(summary)
}

fn abort_open_runs(state: &AppState) {
    for status in [RunStatus::Running, RunStatus::Paused] {
        let filter = RunFilter { agent_id: None, status: Some(status), limit: Some(1000) };
        let runs = match state.db.list_runs(&filter) {
            Ok(runs) => runs,
            Err(error) => {
                log::warn!("could not list open runs before deleting all data: {error}");
                continue;
            }
        };
        for run in runs {
            if let Err(error) = state.runs.abort_run(&run.id) {
                log::warn!("could not stop run {} before deleting all data: {error}", run.id);
            }
        }
    }
}
