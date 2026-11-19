//! Auto-update from GitHub Releases.
//!
//! The frontend drives the whole flow through the plugins' JavaScript APIs
//! (`src/api/updates.ts`): check, download, install, relaunch. This module
//! only registers the two plugins:
//!
//! - `tauri-plugin-updater` reads `plugins.updater` in `tauri.conf.json`: the
//!   `latest.json` endpoint on the latest GitHub release and the minisign
//!   public key every downloaded bundle must be signed with. The release
//!   workflow signs with `TAURI_SIGNING_PRIVATE_KEY` (CONTRIBUTING.md >
//!   Releasing). An update whose signature does not verify is rejected.
//! - `tauri-plugin-process` relaunches graphrt after the install (macOS and
//!   Linux; on Windows the installer restarts the app itself).
//!
//! Permissions are in `capabilities/updater.json` (desktop platforms only).

/// Adds the updater and process plugins (desktop builds only).
pub fn register_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    builder
}
