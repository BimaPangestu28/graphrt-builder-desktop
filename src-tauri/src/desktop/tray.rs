//! The menu bar (macOS) / tray (Windows, Linux) icon and its native menu,
//! mirroring the popover of screen 25 as far as a native menu allows:
//!
//! ```text
//! Runner online                      (or "Paused until 14:05")
//! 3 agents scheduled
//! 2 runs waiting for you
//! ───────────
//! Open graphrt
//! Pause all agents for 1 hour        (or "Resume agents")
//! ───────────
//! Quit graphrt
//! ```
//!
//! The menu is rebuilt by [`refresh_tray`] whenever a run changes status, the
//! pause is toggled or ends, or settings change. On macOS the icon is a
//! template image (black + alpha, `icons/tray-template.png` from the mono logo)
//! that macOS tints for light and dark menu bars. Windows and Linux do not tint
//! tray icons, and a black one would vanish on a dark taskbar or panel, so
//! they get the full-color app icon (`icons/32x32.png`).

use chrono::{DateTime, Duration, Local, Utc};
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use super::app_settings::AppSettings;
use super::ui_language::{UiLanguage, UiStrings};
use crate::error::AppResult;
use crate::scheduler::pause;
use crate::state::AppState;
use crate::storage::models::{RunFilter, RunStatus};
use crate::storage::Database;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_PAUSE: &str = "pause";
const MENU_RESUME: &str = "resume";
const MENU_QUIT: &str = "quit";

/// How long "Pause all agents" lasts.
pub const PAUSE_DURATION_MINUTES: i64 = 60;

/// Upper bound when counting paused runs for the status line.
const WAITING_RUN_COUNT_LIMIT: i64 = 1000;

#[cfg(target_os = "macos")]
static TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/tray-template.png");
#[cfg(not(target_os = "macos"))]
static TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/32x32.png");

/// What the status lines of the menu show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayStatus {
    pub paused_until: Option<DateTime<Utc>>,
    /// Agents with at least one enabled schedule.
    pub scheduled_agent_count: usize,
    /// Runs paused for the user's approval or input.
    pub waiting_run_count: usize,
}

impl TrayStatus {
    /// Reads the status from storage at `now`.
    ///
    /// @throws AppError::Database - when triggers, runs or settings cannot be read
    pub fn load(db: &Database, now: DateTime<Utc>) -> AppResult<Self> {
        let mut scheduled_agent_ids: Vec<String> = db
            .list_triggers(None)?
            .into_iter()
            .filter(|trigger| trigger.enabled)
            .map(|trigger| trigger.agent_id)
            .collect();
        scheduled_agent_ids.sort();
        scheduled_agent_ids.dedup();
        let waiting_filter =
            RunFilter { agent_id: None, status: Some(RunStatus::Paused), limit: Some(WAITING_RUN_COUNT_LIMIT) };
        Ok(Self {
            paused_until: pause::paused_until(db, now)?,
            scheduled_agent_count: scheduled_agent_ids.len(),
            waiting_run_count: db.list_runs(&waiting_filter)?.len(),
        })
    }

    /// The three status lines, e.g. `["Runner online", "3 agents scheduled", "2 runs waiting for you"]`.
    pub fn lines(&self, strings: UiStrings) -> [String; 3] {
        let runner_line = match self.paused_until {
            Some(until) => strings.paused_until(&until.with_timezone(&Local).format("%H:%M").to_string()),
            None => strings.runner_online(),
        };
        [runner_line, strings.agents_scheduled(self.scheduled_agent_count), strings.runs_waiting(self.waiting_run_count)]
    }
}

/// Creates the tray icon. Hidden right away when "Show in the menu bar / system tray" is off.
///
/// @throws tauri::Error - when the icon or menu cannot be created
pub fn create_tray(app_handle: &AppHandle, show_in_menu_bar: bool) -> tauri::Result<()> {
    let menu = build_menu(app_handle, &current_status(app_handle), current_strings(app_handle))?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(TRAY_ICON_PNG)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("graphrt")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .build(app_handle)?;
    tray.set_visible(show_in_menu_bar)
}

/// Whether the tray icon exists (it may fail to be created on some Linux desktops).
pub fn has_tray_icon(app_handle: &AppHandle) -> bool {
    app_handle.tray_by_id(TRAY_ID).is_some()
}

/// Rebuilds the menu from storage and applies "Show in the menu bar". Never fails (logs).
pub fn refresh_tray(app_handle: &AppHandle) {
    let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
        return;
    };
    let status = current_status(app_handle);
    let updated = build_menu(app_handle, &status, current_strings(app_handle)).and_then(|menu| tray.set_menu(Some(menu)));
    if let Err(error) = updated {
        log::warn!("could not update the tray menu: {error}");
    }
    let show_in_menu_bar =
        app_handle.try_state::<AppState>().is_none_or(|state| AppSettings::load_or_default(&state.db).show_in_menu_bar);
    if let Err(error) = tray.set_visible(show_in_menu_bar) {
        log::warn!("could not show or hide the tray icon: {error}");
    }
}

fn current_status(app_handle: &AppHandle) -> TrayStatus {
    let empty = TrayStatus { paused_until: None, scheduled_agent_count: 0, waiting_run_count: 0 };
    let Some(state) = app_handle.try_state::<AppState>() else {
        return empty;
    };
    TrayStatus::load(&state.db, Utc::now()).unwrap_or_else(|error| {
        log::warn!("could not read the tray status: {error}");
        empty
    })
}

/// The menu strings in the stored language (English when the settings cannot be read).
fn current_strings(app_handle: &AppHandle) -> UiStrings {
    app_handle
        .try_state::<AppState>()
        .map_or_else(|| UiStrings::new(UiLanguage::En), |state| AppSettings::load_or_default(&state.db).ui_strings())
}

fn build_menu(app_handle: &AppHandle, status: &TrayStatus, strings: UiStrings) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app_handle)?;
    for (line_index, line) in status.lines(strings).into_iter().enumerate() {
        let item = MenuItem::with_id(app_handle, format!("status-{line_index}"), line, false, None::<&str>)?;
        menu.append(&item)?;
    }
    menu.append(&PredefinedMenuItem::separator(app_handle)?)?;
    menu.append(&MenuItem::with_id(app_handle, MENU_OPEN, strings.open_app(), true, None::<&str>)?)?;
    let pause_item = match status.paused_until {
        Some(_) => MenuItem::with_id(app_handle, MENU_RESUME, strings.resume_agents(), true, None::<&str>)?,
        None => MenuItem::with_id(app_handle, MENU_PAUSE, strings.pause_agents(), true, None::<&str>)?,
    };
    menu.append(&pause_item)?;
    menu.append(&PredefinedMenuItem::separator(app_handle)?)?;
    menu.append(&MenuItem::with_id(app_handle, MENU_QUIT, strings.quit_app(), true, None::<&str>)?)?;
    Ok(menu)
}

fn handle_menu_event(app_handle: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => super::window::show_main_window(app_handle),
        MENU_PAUSE => pause_agents(app_handle),
        MENU_RESUME => resume_agents(app_handle),
        MENU_QUIT => app_handle.exit(0),
        _ => {}
    }
}

fn pause_agents(app_handle: &AppHandle) {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let duration = Duration::minutes(PAUSE_DURATION_MINUTES);
    match pause::pause_scheduler(&state.db, Utc::now(), duration) {
        Ok(until) => {
            log::info!("scheduled runs paused until {until}");
            schedule_pause_end(app_handle.clone(), duration);
        }
        Err(error) => log::error!("could not pause scheduled runs: {error}"),
    }
    refresh_tray(app_handle);
}

fn resume_agents(app_handle: &AppHandle) {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    match pause::resume_scheduler(&state.db) {
        Ok(()) => state.scheduler.request_tick(),
        Err(error) => log::error!("could not resume scheduled runs: {error}"),
    }
    refresh_tray(app_handle);
}

/// At start-up, a pause set before the app quit still has to end in the menu.
pub fn resume_pause_timer(app_handle: &AppHandle) {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let now = Utc::now();
    if let Ok(Some(until)) = pause::paused_until(&state.db, now) {
        schedule_pause_end(app_handle.clone(), until - now);
    }
}

/// When the pause ends: tick right away (late triggers apply their policy) and
/// put "Runner online" back in the menu. A pause that was resumed or renewed
/// meanwhile makes this a harmless extra refresh.
fn schedule_pause_end(app_handle: AppHandle, duration: Duration) {
    let wait = duration.to_std().unwrap_or_default() + std::time::Duration::from_secs(1);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(wait).await;
        if let Some(state) = app_handle.try_state::<AppState>() {
            state.scheduler.request_tick();
        }
        refresh_tray(&app_handle);
    });
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, MissedRunPolicy, NewAgent, NewTrigger, RunTrigger};

    fn create_agent(db: &Database, name: &str) -> String {
        db.create_agent(NewAgent {
            name: name.into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: "nodes: []".into(),
        })
        .unwrap()
        .id
    }

    fn schedule(db: &Database, agent_id: &str) {
        let new_trigger = NewTrigger {
            agent_id: agent_id.into(),
            cron_expression: "0 0 9 * * *".into(),
            timezone: "UTC".into(),
            missed_run_policy: MissedRunPolicy::RunOnce,
            inputs: json!({}),
        };
        db.create_trigger(new_trigger, None).unwrap();
    }

    #[test]
    fn counts_scheduled_agents_and_waiting_runs() {
        let db = Database::open_in_memory().unwrap();
        let digest_id = create_agent(&db, "Morning digest");
        let leads_id = create_agent(&db, "Maps leads");
        schedule(&db, &digest_id);
        schedule(&db, &digest_id);
        schedule(&db, &leads_id);
        let run = db.insert_run(&leads_id, 1, RunTrigger::Schedule).unwrap();
        db.mark_run_paused(&run.id, "{}", &json!([])).unwrap();
        db.insert_run(&leads_id, 1, RunTrigger::Schedule).unwrap();

        let status = TrayStatus::load(&db, Utc::now()).unwrap();
        assert_eq!(status.scheduled_agent_count, 2);
        assert_eq!(status.waiting_run_count, 1);
        assert_eq!(status.lines(UiStrings::new(UiLanguage::En)), ["Runner online", "2 agents scheduled", "1 run waiting for you"]);
    }

    #[test]
    fn shows_the_pause() {
        let db = Database::open_in_memory().unwrap();
        let now = Utc.with_ymd_and_hms(2026, 11, 19, 12, 0, 0).unwrap();
        pause::pause_scheduler(&db, now, Duration::hours(1)).unwrap();
        let status = TrayStatus::load(&db, now).unwrap();
        assert!(status.lines(UiStrings::new(UiLanguage::En))[0].starts_with("Paused until "));
        assert_eq!(status.lines(UiStrings::new(UiLanguage::En))[1], "0 agents scheduled");
    }
}
