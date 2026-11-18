//! The main window outlives its close button: closing hides it, so the
//! scheduler keeps running. The app quits only from "Quit graphrt" in the
//! menu bar menu or the app menu (Cmd+Q on macOS).
//!
//! - macOS: the Dock icon stays; clicking it (`RunEvent::Reopen`) shows the window.
//! - Windows / Linux: the tray icon brings the window back. When the user has
//!   hidden the tray icon, closing quits instead, since nothing could reopen it.

use tauri::{AppHandle, Manager, Window, WindowEvent};

use super::app_settings::AppSettings;
use crate::state::AppState;

/// Label of the main window in `tauri.conf.json`.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Shows, unminimizes and focuses the main window.
pub fn show_main_window(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::warn!("the main window no longer exists");
        return;
    };
    let shown = window.show().and_then(|()| window.unminimize()).and_then(|()| window.set_focus());
    if let Err(error) = shown {
        log::warn!("could not show the main window: {error}");
    }
}

/// Whether closing the main window should hide it rather than quit the app.
pub fn should_hide_on_close(show_in_menu_bar: bool) -> bool {
    cfg!(target_os = "macos") || show_in_menu_bar
}

/// `on_window_event` handler: turns a close of the main window into a hide.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }
    let show_in_menu_bar = window
        .app_handle()
        .try_state::<AppState>()
        .map(|state| AppSettings::load_or_default(&state.db).show_in_menu_bar)
        .unwrap_or(true);
    if !should_hide_on_close(show_in_menu_bar) {
        return;
    }
    api.prevent_close();
    if let Err(error) = window.hide() {
        log::warn!("could not hide the main window: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_hides_when_the_tray_icon_is_shown() {
        assert!(should_hide_on_close(true));
    }

    #[test]
    fn closing_without_tray_icon_quits_except_on_macos() {
        assert_eq!(should_hide_on_close(false), cfg!(target_os = "macos"));
    }
}
