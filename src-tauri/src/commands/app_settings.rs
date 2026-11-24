//! Settings screen (22): desktop preferences, export and delete all data.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::desktop as desktop_integration;
use crate::desktop::app_settings::AppSettings;
use crate::desktop::data::{self, DeletionSummary, ExportSummary};
use crate::desktop::data_folder;
use crate::desktop::onboarding_tour::OnboardingTourStatus;
use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::models::{RunFilter, RunStatus};

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    AppSettings::load(&state.db)
}

/// Stores every field, then applies launch at login, the tray icon and keep awake.
/// A shorter run history retention prunes old run logs right away.
#[tauri::command]
pub fn update_app_settings(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let previous_retention = AppSettings::load_or_default(&state.db).run_history_retention_days;
    settings.save(&state.db)?;
    desktop_integration::apply_settings(&app_handle, &settings);
    if settings.run_history_retention_days != previous_retention {
        match settings.prune_run_history(&state.db) {
            Ok(deleted_count) => log::info!("pruned {deleted_count} run events after the retention changed"),
            Err(error) => log::warn!("could not prune old run events: {error}"),
        }
    }
    Ok(settings)
}

/// Whether the onboarding tour was completed, skipped or not seen yet.
#[tauri::command]
pub fn get_onboarding_tour_status(state: State<'_, AppState>) -> AppResult<OnboardingTourStatus> {
    OnboardingTourStatus::load(&state.db)
}

/// Remembers how the onboarding tour ended, so it opens by itself only once.
#[tauri::command]
pub fn set_onboarding_tour_status(
    state: State<'_, AppState>,
    status: OnboardingTourStatus,
) -> AppResult<OnboardingTourStatus> {
    status.save(&state.db)?;
    Ok(status)
}

/// Absolute path of the folder holding the database, knowledge bases and plugins.
#[tauri::command]
pub fn get_data_folder_path(app_handle: AppHandle) -> AppResult<String> {
    Ok(data_folder::data_folder(&app_handle)?.display().to_string())
}

/// Opens the data folder in Finder (Explorer / the file manager elsewhere).
#[tauri::command]
pub fn reveal_data_folder(app_handle: AppHandle) -> AppResult<()> {
    data_folder::open_in_file_manager(&data_folder::data_folder(&app_handle)?)
}

/// Writes every agent (workflow, versions, schedules; no secrets) as JSON to `path`.
#[tauri::command]
pub fn export_agents(state: State<'_, AppState>, path: String) -> AppResult<ExportSummary> {
    data::export_agents_to_file(&state.db, &PathBuf::from(path.trim()))
}

/// Stops open runs, then deletes agents, runs, schedules, knowledge stores,
/// installed plugins and their data, and settings; with `remove_keychain_items`
/// also the saved provider keys, workflow secrets and plugin settings.
#[tauri::command]
pub async fn delete_all_data(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    remove_keychain_items: bool,
) -> AppResult<DeletionSummary> {
    abort_open_runs(&state);
    delete_knowledge_stores(&state);
    let removed_plugin_count = state.plugins.remove_all(remove_keychain_items).await;
    log::info!("removed {removed_plugin_count} plugins while deleting all data");
    if remove_keychain_items {
        state.deploy.forget_all_secrets();
    }
    let summary = data::delete_all_data(&state.db, &state.credentials, remove_keychain_items)?;
    desktop_integration::apply_settings(&app_handle, &AppSettings::default());
    // The MCP server list was a setting: new runs must not see the deleted servers.
    crate::mcp::publish(Vec::new());
    Ok(summary)
}

/// Removes each knowledge base's passage store file (outside the app database).
/// Failures are logged; the database rows go with `delete_all_data` either way.
fn delete_knowledge_stores(state: &AppState) {
    let knowledge_bases = match state.knowledge.list_knowledge_bases() {
        Ok(knowledge_bases) => knowledge_bases,
        Err(error) => {
            log::warn!("could not list knowledge bases before deleting all data: {error}");
            return;
        }
    };
    for knowledge_base in knowledge_bases {
        if let Err(error) = state.knowledge.delete_knowledge_base(&knowledge_base.id) {
            log::warn!("could not delete knowledge base {}: {error}", knowledge_base.id);
        }
    }
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
