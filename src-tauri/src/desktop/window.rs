//! The main window outlives its close button: closing hides it, so the
//! scheduler keeps running. The app quits only from "Quit graphrt" in the
//! tray menu or the app menu (Cmd+Q on macOS).
//!
//! - macOS: the Dock icon stays; clicking it (`RunEvent::Reopen`) shows the window.
//! - Windows / Linux: the tray icon brings the window back. When the user has
//!   hidden the tray icon, or it could not be created, closing quits instead,
//!   since nothing could reopen it. Starting graphrt again also shows the
//!   window (single instance).

use tauri::window::Color;
use tauri::{AppHandle, Manager, Theme, Window, WindowEvent};

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

/// The window background of the dark theme: `--color-canvas` under `[data-theme="dark"]` in
/// `src/index.css`. The light one is `backgroundColor` in `tauri.conf.json`.
const DARK_CANVAS: Color = Color(0x09, 0x09, 0x0B, 0xFF);

/// Paints the main window dark before its page loads when the operating system is in dark
/// mode, so a dark desktop does not flash a light window at startup. The page then follows
/// the system (or the choice in Settings) by itself, see `src/lib/appearance.ts`.
pub fn match_system_theme(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    match window.theme() {
        Ok(Theme::Dark) => {
            if let Err(error) = window.set_background_color(Some(DARK_CANVAS)) {
                log::warn!("could not paint the main window dark: {error}");
            }
        }
        Ok(_) => {}
        Err(error) => log::warn!("could not read the system theme: {error}"),
    }
}

/// Whether closing the main window should hide it rather than quit the app:
/// always on macOS (the Dock reopens it), elsewhere only with a visible tray icon.
pub fn should_hide_on_close(show_in_menu_bar: bool, has_tray_icon: bool) -> bool {
    cfg!(target_os = "macos") || (show_in_menu_bar && has_tray_icon)
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
    let has_tray_icon = super::tray::has_tray_icon(window.app_handle());
    if !should_hide_on_close(show_in_menu_bar, has_tray_icon) {
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
        assert!(should_hide_on_close(true, true));
    }

    #[test]
    fn closing_without_tray_icon_quits_except_on_macos() {
        assert_eq!(should_hide_on_close(false, true), cfg!(target_os = "macos"));
        assert_eq!(should_hide_on_close(true, false), cfg!(target_os = "macos"), "the tray icon could not be created");
    }
}
