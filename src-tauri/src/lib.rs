//! graphrt desktop backend.
//!
//! The UI is the React app in `../src`. This crate owns everything that needs
//! the operating system or the graphrt runtime:
//!
//! - [`storage`]: agents, versions, runs, events and schedules in SQLite
//! - [`credentials`]: provider API keys in the OS keychain
//! - [`flow`]: graphrt workflow validation and step summaries
//! - [`agent_builder`]: drafting an agent's workflow from plain language
//! - [`engine`]: running agents on graphrt and streaming events to the UI
//! - [`scheduler`]: starting scheduled runs while the app is running
//! - [`desktop`]: menu bar icon, notifications, keep running when closed, launch at login
//! - [`commands`]: the Tauri commands the frontend calls

pub mod agent_builder;
pub mod commands;
pub mod credentials;
pub mod desktop;
pub mod engine;
pub mod error;
pub mod flow;
pub mod scheduler;
pub mod state;
pub mod storage;

use std::sync::Arc;

use tauri::Manager;

use crate::credentials::CredentialStore;
use crate::desktop::notify::{NotifyingSink, TauriRunNotifier};
use crate::desktop::RunActivitySink;
use crate::engine::tauri_sink::TauriRunEventSink;
use crate::engine::{RunEventSink, RunManager};
use crate::state::AppState;
use crate::storage::Database;

const DATABASE_FILE_NAME: &str = "graphrt.db";

/// Opens storage, wires the run engine and scheduler, and registers state.
fn initialize_app_state(app: &tauri::App) -> Result<AppState, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db = Arc::new(Database::open(&data_dir.join(DATABASE_FILE_NAME))?);
    match db.fail_interrupted_runs() {
        Ok(count) if count > 0 => log::info!("marked {count} interrupted runs as failed"),
        Ok(_) => {}
        Err(error) => log::warn!("could not clean up interrupted runs: {error}"),
    }
    let credentials = Arc::new(CredentialStore::keychain());
    let tauri_sink: Arc<dyn RunEventSink> = Arc::new(TauriRunEventSink::new(app.handle().clone()));
    let notifier = Arc::new(TauriRunNotifier::install(app.handle().clone()));
    let notifying_sink = Arc::new(NotifyingSink::new(tauri_sink, notifier, db.clone()));
    let status_listener = desktop::desktop_status_listener(app.handle().clone());
    let sink = Arc::new(RunActivitySink::new(notifying_sink, status_listener));
    let runs = Arc::new(RunManager::new(db.clone(), credentials.clone(), sink));
    let scheduler = scheduler::spawn(db.clone(), runs.clone());
    Ok(AppState { db, credentials, runs, scheduler })
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start (for example, a malformed `tauri.conf.json`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop::register_plugins(tauri::Builder::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let app_state = initialize_app_state(app)?;
            app.manage(app_state);
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(desktop::window::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::agents::list_agents,
            commands::agents::get_agent,
            commands::agents::rename_agent,
            commands::agents::set_agent_status,
            commands::agents::delete_agent,
            commands::agents::list_agent_versions,
            commands::agents::restore_agent_version,
            commands::credentials::set_api_key,
            commands::credentials::delete_api_key,
            commands::credentials::list_provider_statuses,
            commands::credentials::get_default_model,
            commands::credentials::set_default_model,
            commands::credentials::set_ollama_base_url,
            commands::credentials::list_workflow_secrets,
            commands::credentials::set_workflow_secret,
            commands::credentials::delete_workflow_secret,
            commands::builder::build_agent,
            commands::builder::revise_agent,
            commands::builder::get_flow_summary,
            commands::runs::start_run,
            commands::runs::resume_run,
            commands::runs::abort_run,
            commands::runs::list_runs,
            commands::runs::get_run,
            commands::runs::list_run_events,
            commands::triggers::list_triggers,
            commands::triggers::create_trigger,
            commands::triggers::update_trigger,
            commands::triggers::set_trigger_enabled,
            commands::triggers::delete_trigger,
            commands::triggers::preview_schedule,
            commands::app_settings::get_app_settings,
            commands::app_settings::update_app_settings,
            commands::app_settings::export_agents,
            commands::app_settings::delete_all_data,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start the graphrt desktop app")
        .run(desktop::handle_run_event);
}
