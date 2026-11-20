//! Plugin commands (the Plugins page and screen 05). Install progress and
//! load errors arrive as `plugin-event` Tauri events (see `plugins::events`).
//! Setting values go into the keychain and are never returned.

use tauri::State;

use crate::error::AppResult;
use crate::node_runtime::BrowserRuntimeStatus;
use crate::plugins::auto_update::{PluginAutoUpdate, PluginBulkUpdateSummary};
use crate::plugins::models::{InstalledPlugin, PluginActionResult, PluginCatalog};
use crate::plugins::requirements::PluginRequirement;
use crate::plugins::session::SessionState;
use crate::state::AppState;

#[tauri::command]
pub async fn list_plugin_catalog(state: State<'_, AppState>, refresh: Option<bool>) -> AppResult<PluginCatalog> {
    state.plugins.catalog(refresh.unwrap_or(false)).await
}

#[tauri::command]
pub fn list_installed_plugins(state: State<'_, AppState>) -> AppResult<Vec<InstalledPlugin>> {
    state.plugins.list_installed()
}

#[tauri::command]
pub async fn install_plugin(state: State<'_, AppState>, name: String) -> AppResult<InstalledPlugin> {
    state.plugins.install(name.trim()).await
}

#[tauri::command]
pub async fn update_plugin(state: State<'_, AppState>, name: String) -> AppResult<InstalledPlugin> {
    state.plugins.update(name.trim()).await
}

/// "Update all": installs every pending update that asks for no new permissions.
#[tauri::command]
pub async fn update_all_plugins(state: State<'_, AppState>) -> AppResult<PluginBulkUpdateSummary> {
    state.plugins.update_all_ready().await
}

/// Plugins updated automatically, newest first (Home's "Updated automatically" line).
#[tauri::command]
pub fn list_plugin_auto_updates(state: State<'_, AppState>) -> AppResult<Vec<PluginAutoUpdate>> {
    state.plugins.recent_auto_updates()
}

#[tauri::command]
pub async fn remove_plugin(state: State<'_, AppState>, name: String) -> AppResult<()> {
    state.plugins.remove(name.trim()).await
}

/// Trusting grants the plugin its requested settings and plaintext secrets.
#[tauri::command]
pub async fn set_plugin_trusted(state: State<'_, AppState>, name: String, trusted: bool) -> AppResult<InstalledPlugin> {
    state.plugins.set_trusted(name.trim(), trusted).await
}

#[tauri::command]
pub async fn set_plugin_config(
    state: State<'_, AppState>,
    name: String,
    variable: String,
    value: String,
) -> AppResult<InstalledPlugin> {
    state.plugins.set_config(name.trim(), variable.trim(), &value).await
}

#[tauri::command]
pub async fn delete_plugin_config(
    state: State<'_, AppState>,
    name: String,
    variable: String,
) -> AppResult<InstalledPlugin> {
    state.plugins.delete_config(name.trim(), variable.trim()).await
}

/// Opens a plugin's README (from its manifest or the catalog) in the default browser.
#[tauri::command]
pub fn open_plugin_readme(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let url = state.plugins.readme_url(name.trim())?;
    crate::crash_reports::sharing::open_in_browser(&url)
}

/// A plugin's icon as a `data:image/svg+xml;base64,...` URL, or `null` when it has none or
/// it cannot be fetched. Downloaded once and cached on disk; render it only with `<img>`.
#[tauri::command]
pub async fn get_plugin_icon(state: State<'_, AppState>, name: String) -> AppResult<Option<String>> {
    state.plugins.icon_data_url(name.trim()).await
}

/// Whether Chromium is installed (`install_browser_runtime` lives in `commands::node_runtime`).
#[tauri::command]
pub fn browser_runtime_status(state: State<'_, AppState>) -> BrowserRuntimeStatus {
    state.plugins.browser_runtime_status()
}

/// Runs one node kind a trusted plugin declares (e.g. `whatsapp-web.login`).
#[tauri::command]
pub async fn run_plugin_action(
    state: State<'_, AppState>,
    name: String,
    kind: String,
    config: Option<serde_json::Value>,
) -> AppResult<PluginActionResult> {
    state.plugins.run_action(name.trim(), kind.trim(), config.unwrap_or(serde_json::Value::Null)).await
}

/// Asks a session plugin (`whatsapp-web`) whether its account is linked, stores the
/// answer for the readiness checks and returns it (`linked`, `not_linked` or `unknown`).
#[tauri::command]
pub async fn check_plugin_session(state: State<'_, AppState>, name: String) -> AppResult<SessionState> {
    state.plugins.check_session(name.trim()).await
}

/// What the agent's current workflow needs from plugins (installed or not),
/// for the build chat. Fetches the catalog first when this session has not
/// (bounded wait; the saved copy is used offline).
#[tauri::command]
pub async fn list_agent_plugin_requirements(
    state: State<'_, AppState>,
    agent_id: String,
) -> AppResult<Vec<PluginRequirement>> {
    let agent = state.db.get_agent(agent_id.trim())?;
    state.plugins.refresh_catalog_for_builder().await;
    state.plugins.requirements(&agent.flow_yaml)
}
