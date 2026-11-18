//! Plugin commands (Connections > Plugins, screen 05). Install progress and
//! load errors arrive as `plugin-event` Tauri events (see `plugins::events`).
//! Setting values go into the keychain and are never returned.

use tauri::State;

use crate::error::AppResult;
use crate::node_runtime::BrowserRuntimeStatus;
use crate::plugins::models::{InstalledPlugin, PluginActionResult, PluginCatalog};
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
