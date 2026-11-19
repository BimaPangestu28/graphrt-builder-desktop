//! Operating-system integration: what lets graphrt keep running agents when
//! its window is closed, and tell the user when a run needs them.
//!
//! - [`tray`]: the menu bar (macOS) / system tray (Windows, Linux) icon and its
//!   menu (status, open, pause, quit).
//! - [`window`]: closing the main window hides it; quitting is explicit.
//! - [`notify`]: [`notify::NotifyingSink`] shows a notification when a run
//!   waits for approval or fails; a click opens the run.
//! - [`keep_awake`]: the system's keep-awake assertion while a run is active
//!   (`caffeinate` on macOS, `SetThreadExecutionState` on Windows, `systemd-inhibit` on Linux).
//! - [`app_settings`]: the typed preferences behind all of the above.
//! - [`data`]: export all agents / delete all data.
//! - [`data_folder`]: where the data lives, and "Show in Finder / File Explorer".
//! - [`chat_notify`]: a notification when a chatbot hands a conversation over.
//! - [`daily_summary`]: one notification a day summarizing the runs.
//! - [`onboarding_tour`]: whether the onboarding tour was completed or skipped.
//!
//! Run status changes reach this module through two small sink wrappers that
//! [`crate::run`] chains around the Tauri sink: [`notify::NotifyingSink`]
//! and [`RunActivitySink`] (refreshes the tray and the keep-awake assertion).
//! Launch at login uses `tauri-plugin-autostart` ([`apply_settings`]): a
//! LaunchAgent on macOS, the `Run` registry key on Windows, an XDG autostart
//! entry on Linux. `tauri-plugin-single-instance` makes a second launch show
//! the running window instead of starting another runner.

pub mod app_settings;
pub mod chat_notify;
pub mod daily_summary;
pub mod data;
pub mod data_folder;
pub mod keep_awake;
pub mod notify;
pub mod onboarding_tour;
pub mod tray;
pub mod window;

use std::fmt;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use self::app_settings::AppSettings;
use self::keep_awake::KeepAwake;
use crate::engine::{RunEventPayload, RunEventSink};
use crate::state::AppState;
use crate::storage::models::{RunFilter, RunStatus};

/// Called after every run status change.
pub type RunStatusListener = Arc<dyn Fn(&RunEventPayload) + Send + Sync>;

/// Forwards every event to `inner`, then calls `listener` on `status_changed` events.
pub struct RunActivitySink {
    inner: Arc<dyn RunEventSink>,
    listener: RunStatusListener,
}

impl RunActivitySink {
    pub fn new(inner: Arc<dyn RunEventSink>, listener: RunStatusListener) -> Self {
        Self { inner, listener }
    }
}

impl fmt::Debug for RunActivitySink {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("RunActivitySink").field("inner", &self.inner).finish_non_exhaustive()
    }
}

impl RunEventSink for RunActivitySink {
    fn send(&self, payload: RunEventPayload) {
        let is_status_change = payload.event.get("type").and_then(|kind| kind.as_str()) == Some("status_changed");
        if is_status_change {
            (self.listener)(&payload);
        }
        self.inner.send(payload);
    }
}

/// The app's [`RunStatusListener`]: refreshes the tray menu and the keep-awake assertion.
pub fn desktop_status_listener(app_handle: AppHandle) -> RunStatusListener {
    Arc::new(move |_payload| refresh_desktop_state(&app_handle))
}

/// Re-reads storage and updates the tray menu and the keep-awake assertion.
pub fn refresh_desktop_state(app_handle: &AppHandle) {
    tray::refresh_tray(app_handle);
    update_keep_awake(app_handle);
}

fn update_keep_awake(app_handle: &AppHandle) {
    let (Some(state), Some(keep_awake)) = (app_handle.try_state::<AppState>(), app_handle.try_state::<KeepAwake>())
    else {
        return;
    };
    let settings = AppSettings::load_or_default(&state.db);
    let running_filter = RunFilter { agent_id: None, status: Some(RunStatus::Running), limit: Some(1) };
    let running_run_count = match state.db.list_runs(&running_filter) {
        Ok(runs) => runs.len(),
        Err(error) => {
            log::warn!("could not count running runs: {error}");
            0
        }
    };
    keep_awake.update(keep_awake::should_keep_awake(&settings, running_run_count), settings.keep_awake_only_on_power);
}

/// Applies settings that live outside the database: launch at login, the tray
/// icon's visibility and the keep-awake assertion.
pub fn apply_settings(app_handle: &AppHandle, settings: &AppSettings) {
    apply_launch_at_login(app_handle, settings.open_at_login);
    refresh_desktop_state(app_handle);
}

#[cfg(desktop)]
fn apply_launch_at_login(app_handle: &AppHandle, open_at_login: bool) {
    use tauri_plugin_autostart::ManagerExt;

    let autolaunch = app_handle.autolaunch();
    let is_enabled = autolaunch.is_enabled().unwrap_or(!open_at_login);
    if is_enabled == open_at_login {
        return;
    }
    let changed = if open_at_login { autolaunch.enable() } else { autolaunch.disable() };
    if let Err(error) = changed {
        log::warn!("could not change launch at login: {error}");
    }
}

#[cfg(not(desktop))]
fn apply_launch_at_login(_app_handle: &AppHandle, _open_at_login: bool) {}

/// Registers the plugins this module uses on the builder.
pub fn register_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let builder = builder.plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app_handle, _arguments, _working_dir| {
            window::show_main_window(app_handle)
        }))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None));
    builder
}

/// Creates the tray icon and keep-awake state. Call from `setup` after `AppState` is managed.
///
/// A tray icon that cannot be created (e.g. a Linux desktop without the
/// AppIndicator library) is logged, not fatal: the window then quits on close
/// ([`window::should_hide_on_close`]) since nothing could bring it back.
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(KeepAwake::default());
    let show_in_menu_bar =
        app.try_state::<AppState>().is_none_or(|state| AppSettings::load_or_default(&state.db).show_in_menu_bar);
    // The Linux tray backend panics instead of failing when libayatana-appindicator is missing.
    let created =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tray::create_tray(app.handle(), show_in_menu_bar)));
    match created {
        Ok(Ok(())) => {}
        Ok(Err(error)) => log::warn!("could not create the tray icon; closing the window will quit graphrt: {error}"),
        Err(_) => log::warn!("the tray icon library is missing (libayatana-appindicator3 on Linux); closing the window will quit graphrt"),
    }
    tray::resume_pause_timer(app.handle());
    Ok(())
}

/// Handles app-level run events: Dock click shows the window (macOS); exit releases the assertion.
pub fn handle_run_event(app_handle: &AppHandle, event: tauri::RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => window::show_main_window(app_handle),
        tauri::RunEvent::Exit => {
            if let Some(keep_awake) = app_handle.try_state::<KeepAwake>() {
                keep_awake.release();
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;

    #[derive(Debug, Default)]
    struct CountingSink {
        count: Mutex<usize>,
    }

    impl RunEventSink for CountingSink {
        fn send(&self, _payload: RunEventPayload) {
            *self.count.lock().unwrap() += 1;
        }
    }

    fn payload(event_type: &str) -> RunEventPayload {
        RunEventPayload {
            run_id: "run-1".into(),
            agent_id: "agent-1".into(),
            seq: 1,
            status: RunStatus::Running,
            event: json!({"type": event_type}),
        }
    }

    #[test]
    fn activity_sink_listens_to_status_changes_only() {
        let inner = Arc::new(CountingSink::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let listener_calls = calls.clone();
        let sink = RunActivitySink::new(
            inner.clone(),
            Arc::new(move |_| {
                listener_calls.fetch_add(1, Ordering::Relaxed);
            }),
        );
        sink.send(payload("node_started"));
        sink.send(payload("status_changed"));
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert_eq!(*inner.count.lock().unwrap(), 2);
    }
}
