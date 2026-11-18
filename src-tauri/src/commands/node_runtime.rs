//! The bundled Node.js runtime and the browser Playwright plugins need.
//! Install progress arrives as `node-runtime-event` Tauri events (see `node_runtime`).

use std::path::PathBuf;

use tauri::State;

use crate::error::AppResult;
use crate::node_runtime::NodeRuntimeInfo;
use crate::state::AppState;

/// Node version and location plus whether the browser is installed.
#[tauri::command]
pub async fn node_runtime_info(state: State<'_, AppState>) -> AppResult<NodeRuntimeInfo> {
    let node_runtime = state.node_runtime.clone();
    Ok(node_runtime.info().await)
}

/// Downloads Chromium with the Playwright of the plugin in `plugin_dir`, or of
/// the newest installed plugin that ships Playwright when it is omitted.
/// Returns once the browser is ready; safe to call repeatedly or concurrently.
#[tauri::command]
pub async fn install_browser_runtime(state: State<'_, AppState>, plugin_dir: Option<String>) -> AppResult<()> {
    let node_runtime = state.node_runtime.clone();
    match plugin_dir {
        Some(plugin_dir) => node_runtime.install_browser_runtime_for(&PathBuf::from(plugin_dir)).await,
        None => node_runtime.install_browser_runtime().await,
    }
}
