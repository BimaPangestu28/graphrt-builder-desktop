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
//! - [`run_summary`]: plain-language run summaries and weekly agent stats
//! - [`scheduler`]: starting scheduled runs while the app is running
//! - [`conversations`]: chatbot conversations, the bot's replies and hand-offs
//! - [`agent_steps`]: agents used as steps and team members (the `agents` tool provider)
//! - [`chains`]: starting the next agent of a chain when a run finishes
//! - [`commands`]: the Tauri commands the frontend calls

pub mod agent_builder;
pub mod agent_steps;
pub mod chains;
pub mod commands;
pub mod conversations;
pub mod credentials;
pub mod engine;
pub mod error;
pub mod flow;
pub mod run_summary;
pub mod scheduler;
pub mod state;
pub mod storage;

use std::sync::Arc;

use tauri::Manager;

use crate::chains::{ChainRunner, ChainingSink};
use crate::credentials::CredentialStore;
use crate::engine::tauri_sink::TauriRunEventSink;
use crate::engine::RunManager;
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
    // Keep 30 days of event logs for finished runs; running / paused runs keep theirs.
    if let Err(error) = db.prune_old_run_events(30) {
        log::warn!("could not prune old run events: {error}");
    }
    let credentials = Arc::new(CredentialStore::keychain());
    let tauri_sink = Arc::new(TauriRunEventSink::new(app.handle().clone()));
    let chain_runner = Arc::new(ChainRunner::new(db.clone()));
    let sink = Arc::new(ChainingSink::new(tauri_sink, chain_runner.clone()));
    let runs = Arc::new(RunManager::new(db.clone(), credentials.clone(), sink));
    chain_runner.attach(&runs);
    let scheduler = scheduler::spawn(db.clone(), runs.clone());
    let conversation_sink = Arc::new(conversations::tauri_sink::TauriConversationEventSink::new(app.handle().clone()));
    let conversations =
        Arc::new(conversations::ConversationManager::new(db.clone(), credentials.clone(), conversation_sink));
    Ok(AppState { db, credentials, runs, scheduler, conversations, chains: chain_runner })
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start (for example, a malformed `tauri.conf.json`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let app_state = initialize_app_state(app)?;
            app.manage(app_state);
            Ok(())
        })
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
            commands::run_summary::get_run_summary,
            commands::run_summary::list_agent_run_stats,
            commands::triggers::list_triggers,
            commands::triggers::create_trigger,
            commands::triggers::update_trigger,
            commands::triggers::set_trigger_enabled,
            commands::triggers::delete_trigger,
            commands::triggers::preview_schedule,
            commands::conversations::list_conversations,
            commands::conversations::count_conversations,
            commands::conversations::get_conversation,
            commands::conversations::start_test_conversation,
            commands::conversations::send_customer_message,
            commands::conversations::take_over,
            commands::conversations::hand_back,
            commands::conversations::send_operator_reply,
            commands::conversations::close_conversation,
            commands::conversations::set_bot_enabled,
            commands::conversations::get_bot_enabled,
            commands::versions::compare_agent_versions,
            commands::versions::get_version_flow_summary,
            commands::chains::list_chains,
            commands::chains::get_chain,
            commands::chains::create_chain,
            commands::chains::update_chain,
            commands::chains::delete_chain,
            commands::chains::set_chain_status,
            commands::chains::test_chain,
            commands::agent_tools::list_agent_steps,
            commands::agent_tools::get_team,
            commands::agent_tools::add_agent_step,
            commands::agent_tools::add_team_member,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the graphrt desktop app");
}
