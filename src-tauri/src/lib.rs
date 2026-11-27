//! graphrt desktop backend.
//!
//! The UI is the React app in `../src`. This crate owns everything that needs
//! the operating system or the graphrt runtime:
//!
//! - [`storage`]: agents, versions, runs, events and schedules in SQLite
//! - [`credentials`]: provider API keys in the OS credential store
//! - [`flow`]: graphrt workflow validation and step summaries
//! - [`agent_builder`]: drafting an agent's workflow from plain language
//! - [`engine`]: running agents on graphrt and streaming events to the UI
//! - [`run_summary`]: plain-language run summaries and weekly agent stats
//! - [`usage_summary`]: run and model-token totals since a date (Home "This month")
//! - [`run_review`]: what a paused run waits for (review screen)
//! - [`scheduler`]: starting scheduled runs while the app is running
//! - [`conversations`]: chatbot conversations, the bot's replies and hand-offs
//! - [`chatbot_setup`]: a chatbot's persona, hand-off rules, knowledge and channels
//! - [`teams`]: a team's activity, guardrails and coordinator chat
//! - [`agent_steps`]: agents used as steps and team members (the `agents` tool provider)
//! - [`chains`]: starting the next agent of a chain when a run finishes
//! - [`knowledge`]: knowledge bases (graphrt-rag) agents can search
//! - [`node_runtime`]: the Node.js plugins run on (downloaded on demand) and Playwright's browser
//! - [`plugins`]: graphrt plugins from the catalog (node kinds and tools for every run)
//! - [`plugin_triggers`]: plugin events ("When a meeting is recorded") that start agents
//! - [`live_view`]: live frames of the headless browser a plugin step drives
//! - [`problems`]: what went wrong (failed runs, missing keys, plugins, schedules) and retries
//! - [`mcp`]: MCP servers the user adds; their tools for every run (graphrt-mcp)
//! - [`workflow_secrets`]: every workflow secret across agents and MCP servers
//! - [`desktop`]: menu bar / tray icon, notifications, keep running when closed, launch at login
//! - [`crash_reports`]: local, scrubbed crash reports (panic hook, frontend errors); no telemetry
//! - [`deploy`]: Put it online: running agents with an online provider or on an IT team's server
//! - [`commands`]: the Tauri commands the frontend calls

pub mod agent_builder;
pub mod agent_files;
pub mod agent_graph;
pub mod agent_steps;
pub mod chains;
pub mod chatbot_setup;
pub mod child_env;
pub mod commands;
pub mod conversations;
pub mod crash_reports;
pub mod credentials;
pub mod deploy;
pub mod desktop;
pub mod engine;
pub mod error;
pub mod flow;
pub mod knowledge;
pub mod learning;
#[cfg(target_os = "linux")]
pub mod linux_display;
pub mod live_view;
pub mod local_cli;
pub mod mcp;
pub mod model_catalog;
pub mod node_runtime;
pub mod ollama_check;
pub mod plugin_triggers;
pub mod plugins;
pub mod problems;
pub mod run_files;
pub mod run_prefill;
pub mod run_review;
pub mod run_summary;
pub mod scheduler;
pub mod skills;
pub mod state;
pub mod storage;
pub mod teams;
pub mod ui_blocks;
pub mod usage_summary;
pub mod workflow_secrets;

// Only Unix tests write fake executables.
#[cfg(all(test, unix))]
mod test_support;

use std::sync::Arc;

use tauri::Manager;

use crate::chains::{ChainRunner, ChainingSink};
use crate::credentials::CredentialStore;
use crate::desktop::notify::{NotifyingSink, TauriRunNotifier};
use crate::desktop::RunActivitySink;
use crate::engine::tauri_sink::TauriRunEventSink;
use crate::engine::{RunEventSink, RunManager};
use crate::state::AppState;
use crate::storage::Database;

const DATABASE_FILE_NAME: &str = "graphrt.db";

/// Opens storage, wires the run engine and scheduler, and registers state.
///
/// Only what the first screen and the first runs need happens here: migrations,
/// interrupted-run recovery, the installed plugins and MCP servers (published before
/// the scheduler starts, since its first tick may start a run at once). Pruning old
/// run events and publishing the saved plugin catalog wait for
/// [`spawn_deferred_startup`], after the window is shown.
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
    let live_view_waker = live_view::spawn(
        data_dir.join(live_view::LIVE_VIEW_DIR_NAME),
        Arc::new(live_view::TauriLiveViewSink::new(app.handle().clone())),
    );
    let tauri_sink: Arc<dyn RunEventSink> = Arc::new(TauriRunEventSink::new(app.handle().clone()));
    let notifier = Arc::new(TauriRunNotifier::install(app.handle().clone()));
    let notifying_sink = Arc::new(NotifyingSink::new(tauri_sink, notifier.clone(), db.clone()));
    let status_listener = desktop::desktop_status_listener(app.handle().clone());
    let activity_sink = Arc::new(RunActivitySink::new(notifying_sink, status_listener));
    let chain_runner = Arc::new(ChainRunner::new(db.clone()));
    let chaining_sink = Arc::new(ChainingSink::new(activity_sink, chain_runner.clone()));
    let sink = Arc::new(live_view::WakeOnRunActivity::new(chaining_sink, live_view_waker));
    let agent_files = Arc::new(agent_files::AgentFiles::new(&data_dir));
    let runs = Arc::new(RunManager::new(db.clone(), credentials.clone(), sink).with_agent_files(agent_files.clone()));
    chain_runner.attach(&runs);
    let conversation_sink = Arc::new(desktop::chat_notify::ChatNotifyingSink::new(
        Arc::new(conversations::tauri_sink::TauriConversationEventSink::new(app.handle().clone())),
        notifier.clone(),
        db.clone(),
    ));
    let conversations = Arc::new(
        conversations::ConversationManager::new(db.clone(), credentials.clone(), conversation_sink)
            .with_agent_files(agent_files.clone()),
    );
    let knowledge = Arc::new(knowledge::KnowledgeService::new(
        db.clone(),
        credentials.clone(),
        data_dir.join(knowledge::KNOWLEDGE_DIR_NAME),
        Arc::new(knowledge::events::TauriKnowledgeEventSink::new(app.handle().clone())),
    ));
    let downloader: Arc<dyn plugins::download::Downloader> = Arc::new(plugins::download::HttpsDownloader::new()?);
    let deploy = Arc::new(deploy::DeployService::new(deploy::DeployServiceConfig {
        app_data_dir: data_dir.clone(),
        db: db.clone(),
        credentials: credentials.clone(),
        downloader: Some(downloader.clone()),
        http: Arc::new(deploy::http::ReqwestDeployHttp::new()?),
        events: Arc::new(deploy::TauriDeployEventSink::new(app.handle().clone())),
    }));
    let node_runtime = Arc::new(
        node_runtime::NodeRuntime::new(data_dir.clone())
            .with_downloader(downloader.clone())
            .with_event_sink(Arc::new(node_runtime::TauriNodeRuntimeEventSink::new(app.handle().clone()))),
    );
    let plugins = Arc::new(plugins::PluginService::new(plugins::PluginServiceConfig {
        app_data_dir: data_dir.clone(),
        catalog_url: plugins::DEFAULT_CATALOG_URL.to_owned(),
        db: db.clone(),
        credentials: credentials.clone(),
        node_runtime: node_runtime.clone(),
        downloader,
        events: Arc::new(plugins::events::TauriPluginEventSink::new(app.handle().clone())),
    }));
    plugins.activate_installed();
    let draft_model = Arc::new(skills::DefaultDraftModel { db: db.clone(), credentials: credentials.clone() });
    let skills = Arc::new(skills::SkillService::new(&data_dir, plugins.clone(), draft_model));
    skills.activate();
    let learning = Arc::new(learning::LearningService::new(&data_dir, db.clone(), credentials.clone()));
    learning.activate();
    mcp::publish_from_database(&db);
    engine::spawn_approval_expiry(runs.clone());
    let scheduler = scheduler::spawn(db.clone(), runs.clone());
    desktop::daily_summary::spawn(db.clone(), notifier.clone());
    plugins::auto_update::spawn(plugins.clone());
    let plugin_triggers =
        Arc::new(plugin_triggers::PluginTriggerService::new(db.clone(), plugins.clone(), runs.clone()));
    plugin_triggers.spawn();
    Ok(AppState {
        db,
        credentials,
        runs,
        scheduler,
        conversations,
        chains: chain_runner,
        knowledge,
        node_runtime,
        plugins,
        skills,
        learning,
        model_catalog: Arc::new(model_catalog::ModelCatalog::with_http()?),
        deploy,
        agent_files,
        plugin_triggers,
    })
}

/// Start-up work nothing on the first screen waits for, run on a blocking thread once
/// the window is up: pruning old run events (a large delete) and publishing the saved
/// plugin catalog (signature check and parse of a multi-megabyte file) for the builder.
fn spawn_deferred_startup(state: &AppState) {
    let db = state.db.clone();
    let plugins = state.plugins.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        // Keep the event logs of finished runs for the chosen days (Settings > Privacy and
        // data, 30 by default); running / paused runs keep theirs.
        match desktop::app_settings::AppSettings::load_or_default(&db).prune_run_history(&db) {
            Ok(pruned) if pruned > 0 => log::info!("pruned {pruned} old run events"),
            Ok(_) => {}
            Err(error) => log::warn!("could not prune old run events: {error}"),
        }
        plugins.publish_known_catalog();
        log::info!("deferred start-up work took {} ms", started.elapsed().as_millis());
    });
}

/// `on_window_event` handler: records the files dropped onto a window, so a chat can
/// attach exactly those by path (`agent_files::AgentFiles::remember_dropped`). The webview
/// gets the same paths from Tauri, but a path it sends is taken only when it is known here.
fn remember_dropped_files(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event else { return };
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        state.agent_files.remember_dropped(paths);
    }
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start (for example, a malformed `tauri.conf.json`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop::register_plugins(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // First, so a panic while the rest starts up is reported too.
            crash_reports::install(app)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let app_state = initialize_app_state(app)?;
            spawn_deferred_startup(&app_state);
            app.manage(app_state);
            commands::agent_graph::emit_edit_state_changes(app.handle().clone());
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(desktop::window::handle_window_event)
        .on_window_event(remember_dropped_files)
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
            commands::credentials::check_ollama,
            commands::credentials::get_default_model,
            commands::credentials::set_default_model,
            commands::credentials::set_ollama_base_url,
            commands::credentials::list_available_models,
            commands::credentials::set_local_cli_enabled,
            commands::credentials::check_local_cli,
            commands::credentials::open_model_install_page,
            commands::credentials::get_welcome_choice,
            commands::credentials::set_welcome_choice,
            commands::credentials::list_workflow_secrets,
            commands::credentials::set_workflow_secret,
            commands::credentials::add_workflow_secret,
            commands::credentials::delete_workflow_secret,
            commands::credentials::list_all_workflow_secrets,
            commands::mcp::list_mcp_servers,
            commands::mcp::add_mcp_server,
            commands::mcp::remove_mcp_server,
            commands::mcp::test_mcp_server,
            commands::mcp::sign_in_mcp_server,
            commands::mcp::cancel_mcp_sign_in,
            commands::mcp::sign_out_mcp_server,
            commands::mcp::set_mcp_tool_approval,
            commands::builder::build_agent,
            commands::builder::revise_agent,
            commands::builder::list_builder_messages,
            commands::builder::stop_agent_revision,
            commands::builder::get_flow_summary,
            commands::agent_graph::get_agent_graph,
            commands::agent_graph::get_node_kinds,
            commands::agent_graph::save_agent_graph,
            commands::agent_graph::get_node_layout,
            commands::agent_graph::save_node_layout,
            commands::agent_graph::validate_agent_graph,
            commands::agent_graph::get_canvas_notes,
            commands::agent_graph::save_canvas_notes,
            commands::agent_graph::get_agent_edit_state,
            commands::agent_graph::get_tool_input_schemas,
            commands::runs::start_run,
            commands::runs::resume_run,
            commands::runs::abort_run,
            commands::runs::list_runs,
            commands::runs::get_run,
            commands::runs::list_run_events,
            commands::run_summary::get_run_summary,
            commands::run_summary::list_agent_run_stats,
            commands::run_summary::open_card_link,
            commands::run_summary::open_run_file,
            commands::run_summary::open_run_file_folder,
            commands::usage_summary::get_usage_summary,
            commands::run_review::get_run_review,
            commands::run_review::get_run_inputs,
            commands::run_review::get_last_run_inputs,
            commands::triggers::list_triggers,
            commands::triggers::create_trigger,
            commands::triggers::update_trigger,
            commands::triggers::set_trigger_enabled,
            commands::triggers::delete_trigger,
            commands::triggers::preview_schedule,
            commands::agent_files::get_agent_file_abilities,
            commands::agent_files::pick_chat_attachments,
            commands::agent_files::attach_dropped_chat_files,
            commands::agent_files::discard_chat_attachment,
            commands::agent_files::list_run_files,
            commands::agent_files::preview_agent_file,
            commands::agent_files::save_agent_file,
            commands::conversations::list_conversations,
            commands::conversations::count_conversations,
            commands::conversations::get_conversation,
            commands::conversations::start_test_conversation,
            commands::conversations::send_customer_message,
            commands::conversations::send_customer_card_answer,
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
            commands::teams::list_team_activity,
            commands::teams::get_team_guardrails,
            commands::teams::set_team_max_agent_calls,
            commands::teams::list_coordinator_chat,
            commands::teams::send_coordinator_message,
            commands::trusted_hosts::list_trusted_lookup_hosts,
            commands::trusted_hosts::add_trusted_lookup_host,
            commands::trusted_hosts::remove_trusted_lookup_host,
            commands::chatbot_setup::get_chatbot_setup,
            commands::chatbot_setup::save_chatbot_settings,
            commands::chatbot_setup::attach_chatbot_knowledge,
            commands::chatbot_setup::detach_chatbot_knowledge,
            commands::knowledge::list_knowledge_bases,
            commands::knowledge::get_knowledge_base,
            commands::knowledge::create_knowledge_base,
            commands::knowledge::rename_knowledge_base,
            commands::knowledge::delete_knowledge_base,
            commands::knowledge::add_knowledge_source,
            commands::knowledge::remove_knowledge_source,
            commands::knowledge::sync_knowledge_base,
            commands::knowledge::update_knowledge_settings,
            commands::knowledge::search_knowledge,
            commands::app_settings::get_app_settings,
            commands::app_settings::update_app_settings,
            commands::app_settings::export_agents,
            commands::app_settings::delete_all_data,
            commands::app_settings::get_data_folder_path,
            commands::app_settings::reveal_data_folder,
            commands::app_settings::get_onboarding_tour_status,
            commands::app_settings::set_onboarding_tour_status,
            commands::deploy::graphrt_cli_info,
            commands::deploy::install_graphrt_cli,
            commands::deploy::list_deploy_accounts,
            commands::deploy::connect_deploy_account,
            commands::deploy::disconnect_deploy_account,
            commands::deploy::read_kubeconfig_contexts,
            commands::deploy::check_deploy_compatibility,
            commands::deploy::apply_deploy_fix,
            commands::deploy::get_deploy_review,
            commands::deploy::deploy_agent,
            commands::deploy::cancel_deploy,
            commands::deploy::get_agent_deployment,
            commands::deploy::refresh_agent_deployment,
            commands::deploy::manage_agent_deployment,
            commands::deploy::rotate_deployment_api_key,
            commands::deploy::list_deployed_versions,
            commands::deploy::list_online_runs,
            commands::deploy::list_own_servers,
            commands::deploy::connect_own_server,
            commands::deploy::remove_own_server,
            commands::deploy::export_agent_file,
            commands::deploy::open_deploy_link,
            commands::node_runtime::node_runtime_info,
            commands::node_runtime::install_browser_runtime,
            commands::node_runtime::install_node_runtime,
            commands::node_runtime::remove_node_runtime,
            commands::learning::get_agent_learning,
            commands::learning::decide_lesson,
            commands::learning::edit_lesson,
            commands::learning::delete_lesson,
            commands::learning::apply_lesson_to_everyone,
            commands::learning::forget_learning_person,
            commands::learning::add_learning_note,
            commands::learning::set_auto_learn,
            commands::learning::set_agent_uses_learning,
            commands::learning::record_run_feedback,
            commands::skills::list_installed_skills,
            commands::skills::list_skill_catalog,
            commands::skills::review_catalog_skill,
            commands::skills::install_catalog_skill,
            commands::skills::draft_skill,
            commands::skills::review_authored_skill,
            commands::skills::install_authored_skill,
            commands::skills::set_skill_permissions,
            commands::skills::set_skill_enabled,
            commands::skills::remove_skill,
            commands::skills::list_agent_skills,
            commands::skills::set_agent_step_skills,
            commands::plugins::list_plugin_catalog,
            commands::plugins::list_plugin_catalog_steps,
            commands::plugins::list_installed_plugins,
            commands::plugins::list_plugin_templates,
            commands::plugins::install_plugin,
            commands::plugins::install_local_plugin,
            commands::plugins::update_plugin,
            commands::plugins::update_all_plugins,
            commands::plugins::list_plugin_auto_updates,
            commands::plugins::remove_plugin,
            commands::plugins::set_plugin_trusted,
            commands::plugins::set_plugin_config,
            commands::plugins::delete_plugin_config,
            commands::plugins::browser_runtime_status,
            commands::plugins::run_plugin_action,
            commands::plugins::check_plugin_session,
            commands::plugins::list_agent_plugin_requirements,
            commands::plugins::open_plugin_readme,
            commands::plugins::open_plugin_repository,
            commands::plugins::get_plugin_icon,
            commands::problems::list_problems,
            commands::problems::get_failed_run_report,
            commands::problems::retry_run,
            commands::schedule_rules::get_schedule_rules,
            commands::schedule_rules::update_schedule_rules,
            commands::schedule_rules::list_scheduled_runs,
            commands::crash_reports::list_crash_reports,
            commands::crash_reports::get_crash_report,
            commands::crash_reports::delete_all_crash_reports,
            commands::crash_reports::export_crash_reports,
            commands::crash_reports::report_frontend_error,
            commands::crash_reports::get_crash_notice,
            commands::crash_reports::dismiss_crash_notice,
            commands::crash_reports::get_crash_report_sharing,
            commands::crash_reports::set_crash_report_sharing,
            commands::crash_reports::open_crash_report_issue,
            commands::plugin_triggers::list_plugin_triggers,
            commands::plugin_triggers::get_agent_plugin_trigger,
            commands::plugin_triggers::set_agent_plugin_trigger,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start the graphrt desktop app")
        .run(desktop::handle_run_event);
}
