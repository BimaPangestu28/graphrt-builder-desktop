//! The Node.js runtime graphrt plugins run on.
//!
//! graphrt's process plugins declare `"command": "node"`. The desktop app ships
//! its own Node as a Tauri sidecar (`binaries/node-<target-triple>`, fetched and
//! checksum-verified at build time), so users never install Node themselves.
//! Plugins that drive a browser (Playwright: `google-maps-scraper`,
//! `whatsapp-web`) get Chromium downloaded on demand into the app data folder.
//!
//! CONTRACT: the plugin host calls [`plugin_process_env`] for every plugin
//! process and [`browser_runtime_status`] / [`install_browser_runtime`] for
//! plugins that need a browser. Implemented by the Node runtime owner.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Where Node and the browser cache live; built once at start-up.
#[derive(Debug, Clone)]
pub struct NodeRuntime {
    // CONTRACT: implementation detail of the Node runtime owner.
    _private: (),
}

/// Whether the Chromium that Playwright plugins need is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserRuntimeStatus {
    NotInstalled,
    Installing,
    Installed,
}

impl NodeRuntime {
    /// Resolves the bundled Node next to the app executable and the browser
    /// cache under `app_data_dir/browsers`.
    pub fn new(_app_data_dir: PathBuf) -> Self {
        Self { _private: () }
    }

    /// Absolute path of the bundled `node` executable.
    pub fn node_executable(&self) -> AppResult<PathBuf> {
        Err(AppError::Internal("not implemented".into()))
    }

    /// Extra environment for a plugin process: `PATH` starting with the bundled
    /// Node's folder (so `"command": "node"` finds it) and
    /// `PLAYWRIGHT_BROWSERS_PATH` pointing at the app's browser cache.
    pub fn plugin_process_env(&self) -> Vec<(String, String)> {
        Vec::new()
    }

    pub fn browser_runtime_status(&self) -> BrowserRuntimeStatus {
        BrowserRuntimeStatus::NotInstalled
    }

    /// Downloads Chromium for Playwright into the browser cache (idempotent).
    /// Progress goes to the Tauri event `node-runtime-event`.
    pub async fn install_browser_runtime(&self) -> AppResult<()> {
        Err(AppError::Internal("not implemented".into()))
    }
}
