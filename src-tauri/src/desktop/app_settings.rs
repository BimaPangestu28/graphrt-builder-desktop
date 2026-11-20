//! Typed view over the `settings` table for the desktop preferences on the
//! Settings screen (22): launch at login, menu bar, notifications, keep awake,
//! the default missed-run policy, how long run history is kept, whether
//! updates download by themselves and the run limits ([`RunLimitsSettings`]).
//!
//! Each field is one row (`app.<name>`), stored as `true` / `false` or the
//! serde name of the enum. Missing or unreadable rows fall back to
//! [`AppSettings::default`], so a fresh install and a corrupted value behave
//! the same way.

use serde::{Deserialize, Serialize};

use crate::desktop::run_limits::RunLimitsSettings;
use crate::error::AppResult;
use crate::storage::models::MissedRunPolicy;
use crate::storage::Database;

const KEY_OPEN_AT_LOGIN: &str = "app.open_at_login";
const KEY_SHOW_IN_MENU_BAR: &str = "app.show_in_menu_bar";
const KEY_NOTIFY_ON_APPROVAL: &str = "app.notify_on_approval";
const KEY_NOTIFY_ON_FAILURE: &str = "app.notify_on_failure";
const KEY_KEEP_AWAKE: &str = "app.keep_awake_while_running";
const KEY_KEEP_AWAKE_ONLY_ON_POWER: &str = "app.keep_awake_only_on_power";
const KEY_MISSED_RUN_POLICY: &str = "app.missed_run_default_policy";
const KEY_NOTIFY_ON_CHAT_HANDOFF: &str = "app.notify_on_chat_handoff";
const KEY_NOTIFY_DAILY_SUMMARY: &str = "app.notify_daily_summary";
const KEY_RUN_HISTORY_RETENTION_DAYS: &str = "app.run_history_retention_days";
const KEY_AUTO_DOWNLOAD_UPDATES: &str = "app.auto_download_updates";
const KEY_AUTO_UPDATE_PLUGINS: &str = "app.auto_update_plugins";
const KEY_DEVELOPER_MODE: &str = "app.developer_mode";

/// Stored value of [`AppSettings::run_history_retention_days`] = `None`.
const RETENTION_FOREVER: &str = "forever";
/// Event logs of finished runs are kept this long unless the user changes it.
pub const DEFAULT_RUN_HISTORY_RETENTION_DAYS: u32 = 30;

/// Desktop preferences. Sent to the frontend as camelCase JSON
/// (`src/api/appSettingsTypes.ts`).
///
/// Missing fields deserialize to their defaults, so an older frontend build
/// that does not send a newer field still saves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Start graphrt when the user logs in (so schedules fire without opening the app).
    pub open_at_login: bool,
    /// Show the menu bar (macOS) / system tray icon. On Windows and Linux closing the window
    /// quits the app when this is off, since nothing would bring it back.
    pub show_in_menu_bar: bool,
    /// Notify when a run pauses and waits for the user's approval.
    pub notify_on_approval: bool,
    /// Notify when a run fails.
    pub notify_on_failure: bool,
    /// Keep the computer from sleeping while a run is active (see `keep_awake`).
    pub keep_awake_while_running: bool,
    /// Keep awake only while on AC power; on battery the computer sleeps as usual.
    pub keep_awake_only_on_power: bool,
    /// Policy the schedule dialog proposes for new schedules.
    pub missed_run_default_policy: MissedRunPolicy,
    /// Notify when a chatbot hands a customer conversation over (`waiting_for_you`).
    pub notify_on_chat_handoff: bool,
    /// One notification at 18:00 summarizing the runs of the last 24 hours.
    pub notify_daily_summary: bool,
    /// Days the event logs (step-by-step history) of finished runs are kept;
    /// `None` keeps them forever. Applied at start-up and when changed.
    pub run_history_retention_days: Option<u32>,
    /// Download a new version in the background as soon as the update check finds one
    /// (it is installed only when the user restarts). Off: the update is only announced.
    pub auto_download_updates: bool,
    /// Install newer catalog versions of installed plugins in the background when they ask
    /// for nothing more than the installed version (see `plugins::auto_update`).
    pub auto_update_plugins: bool,
    /// Time and work limits every run gets (Settings › Runner › Run limits).
    pub run_limits: RunLimitsSettings,
    /// Developer options, off by default: the Plugins page offers "Install from folder or
    /// archive…" (sideloading, see `plugins::sideload`), which the backend refuses otherwise.
    pub developer_mode: bool,
}

impl Default for AppSettings {
    /// Launch at login is opt-in (it registers a login item); everything else is on.
    fn default() -> Self {
        Self {
            open_at_login: false,
            show_in_menu_bar: true,
            notify_on_approval: true,
            notify_on_failure: true,
            keep_awake_while_running: true,
            keep_awake_only_on_power: true,
            missed_run_default_policy: MissedRunPolicy::RunOnce,
            notify_on_chat_handoff: false,
            notify_daily_summary: false,
            run_history_retention_days: Some(DEFAULT_RUN_HISTORY_RETENTION_DAYS),
            auto_download_updates: true,
            auto_update_plugins: true,
            run_limits: RunLimitsSettings::default(),
            developer_mode: false,
        }
    }
}

impl AppSettings {
    /// Reads the settings, using the default for every missing or unreadable value.
    ///
    /// @throws AppError::Database - when the settings table cannot be read
    pub fn load(db: &Database) -> AppResult<Self> {
        let defaults = Self::default();
        Ok(Self {
            open_at_login: read_flag(db, KEY_OPEN_AT_LOGIN, defaults.open_at_login)?,
            show_in_menu_bar: read_flag(db, KEY_SHOW_IN_MENU_BAR, defaults.show_in_menu_bar)?,
            notify_on_approval: read_flag(db, KEY_NOTIFY_ON_APPROVAL, defaults.notify_on_approval)?,
            notify_on_failure: read_flag(db, KEY_NOTIFY_ON_FAILURE, defaults.notify_on_failure)?,
            keep_awake_while_running: read_flag(db, KEY_KEEP_AWAKE, defaults.keep_awake_while_running)?,
            keep_awake_only_on_power: read_flag(db, KEY_KEEP_AWAKE_ONLY_ON_POWER, defaults.keep_awake_only_on_power)?,
            missed_run_default_policy: read_policy(db, defaults.missed_run_default_policy)?,
            notify_on_chat_handoff: read_flag(db, KEY_NOTIFY_ON_CHAT_HANDOFF, defaults.notify_on_chat_handoff)?,
            notify_daily_summary: read_flag(db, KEY_NOTIFY_DAILY_SUMMARY, defaults.notify_daily_summary)?,
            run_history_retention_days: read_retention(db, defaults.run_history_retention_days)?,
            auto_download_updates: read_flag(db, KEY_AUTO_DOWNLOAD_UPDATES, defaults.auto_download_updates)?,
            auto_update_plugins: read_flag(db, KEY_AUTO_UPDATE_PLUGINS, defaults.auto_update_plugins)?,
            run_limits: RunLimitsSettings::load(db)?,
            developer_mode: read_flag(db, KEY_DEVELOPER_MODE, defaults.developer_mode)?,
        })
    }

    /// Like [`Self::load`], but logs a read failure and returns the defaults,
    /// for background code (notifications, tray) that must not fail.
    pub fn load_or_default(db: &Database) -> Self {
        Self::load(db).unwrap_or_else(|error| {
            log::warn!("could not read app settings, using the defaults: {error}");
            Self::default()
        })
    }

    /// Stores every field.
    ///
    /// @throws AppError::InvalidInput - when the retention is 0 days or a run limit is out of range
    /// @throws AppError::Database - when a value cannot be written
    pub fn save(&self, db: &Database) -> AppResult<()> {
        if self.run_history_retention_days == Some(0) {
            return Err(crate::error::AppError::InvalidInput("run history must be kept for at least 1 day".into()));
        }
        self.run_limits.validate()?;
        self.run_limits.save(db)?;
        let flags = [
            (KEY_OPEN_AT_LOGIN, self.open_at_login),
            (KEY_SHOW_IN_MENU_BAR, self.show_in_menu_bar),
            (KEY_NOTIFY_ON_APPROVAL, self.notify_on_approval),
            (KEY_NOTIFY_ON_FAILURE, self.notify_on_failure),
            (KEY_KEEP_AWAKE, self.keep_awake_while_running),
            (KEY_KEEP_AWAKE_ONLY_ON_POWER, self.keep_awake_only_on_power),
            (KEY_NOTIFY_ON_CHAT_HANDOFF, self.notify_on_chat_handoff),
            (KEY_NOTIFY_DAILY_SUMMARY, self.notify_daily_summary),
            (KEY_AUTO_DOWNLOAD_UPDATES, self.auto_download_updates),
            (KEY_AUTO_UPDATE_PLUGINS, self.auto_update_plugins),
            (KEY_DEVELOPER_MODE, self.developer_mode),
        ];
        for (key, value) in flags {
            db.set_setting(key, if value { "true" } else { "false" })?;
        }
        let retention_text = match self.run_history_retention_days {
            Some(days) => days.to_string(),
            None => RETENTION_FOREVER.to_owned(),
        };
        db.set_setting(KEY_RUN_HISTORY_RETENTION_DAYS, &retention_text)?;
        db.set_setting(KEY_MISSED_RUN_POLICY, policy_text(self.missed_run_default_policy))
    }

    /// Deletes the event logs of runs finished before the retention window
    /// (nothing when history is kept forever); returns how many were deleted.
    ///
    /// @throws AppError::Database - when the events cannot be deleted
    pub fn prune_run_history(&self, db: &Database) -> AppResult<usize> {
        match self.run_history_retention_days {
            Some(days) => db.prune_old_run_events(days),
            None => Ok(0),
        }
    }
}

fn read_flag(db: &Database, key: &str, default_value: bool) -> AppResult<bool> {
    Ok(match db.get_setting(key)?.as_deref() {
        Some("true") => true,
        Some("false") => false,
        Some(other) => {
            log::warn!("ignoring unreadable setting {key}={other:?}");
            default_value
        }
        None => default_value,
    })
}

fn policy_text(policy: MissedRunPolicy) -> &'static str {
    match policy {
        MissedRunPolicy::RunOnce => "run_once",
        MissedRunPolicy::Skip => "skip",
    }
}

fn read_retention(db: &Database, default_days: Option<u32>) -> AppResult<Option<u32>> {
    Ok(match db.get_setting(KEY_RUN_HISTORY_RETENTION_DAYS)?.as_deref() {
        Some(RETENTION_FOREVER) => None,
        Some(text) => match text.parse::<u32>() {
            Ok(days) if days > 0 => Some(days),
            _ => {
                log::warn!("ignoring unreadable setting {KEY_RUN_HISTORY_RETENTION_DAYS}={text:?}");
                default_days
            }
        },
        None => default_days,
    })
}

fn read_policy(db: &Database, default_policy: MissedRunPolicy) -> AppResult<MissedRunPolicy> {
    Ok(match db.get_setting(KEY_MISSED_RUN_POLICY)?.as_deref() {
        Some("run_once") => MissedRunPolicy::RunOnce,
        Some("skip") => MissedRunPolicy::Skip,
        _ => default_policy,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> Database {
        Database::open_in_memory().unwrap()
    }

    #[test]
    fn fresh_database_has_the_defaults() {
        let settings = AppSettings::load(&test_database()).unwrap();
        assert_eq!(settings, AppSettings::default());
        assert!(!settings.open_at_login);
        assert!(settings.show_in_menu_bar && settings.notify_on_approval && settings.notify_on_failure);
        assert_eq!(settings.missed_run_default_policy, MissedRunPolicy::RunOnce);
    }

    #[test]
    fn settings_round_trip() {
        let database = test_database();
        let changed = AppSettings {
            open_at_login: true,
            show_in_menu_bar: false,
            notify_on_approval: false,
            notify_on_failure: true,
            keep_awake_while_running: false,
            keep_awake_only_on_power: false,
            missed_run_default_policy: MissedRunPolicy::Skip,
            notify_on_chat_handoff: true,
            notify_daily_summary: true,
            run_history_retention_days: None,
            auto_download_updates: false,
            auto_update_plugins: false,
            run_limits: RunLimitsSettings { max_parallel_steps: 8, ..RunLimitsSettings::default() },
            developer_mode: true,
        };
        changed.save(&database).unwrap();
        assert_eq!(AppSettings::load(&database).unwrap(), changed);
        let ninety_days = AppSettings { run_history_retention_days: Some(90), ..changed };
        ninety_days.save(&database).unwrap();
        assert_eq!(AppSettings::load(&database).unwrap(), ninety_days);
    }

    #[test]
    fn new_fields_have_defaults_and_zero_retention_is_rejected() {
        let database = test_database();
        let settings = AppSettings::load(&database).unwrap();
        assert!(!settings.notify_on_chat_handoff && !settings.notify_daily_summary);
        assert_eq!(settings.run_history_retention_days, Some(DEFAULT_RUN_HISTORY_RETENTION_DAYS));
        let zero = AppSettings { run_history_retention_days: Some(0), ..AppSettings::default() };
        assert!(matches!(zero.save(&database), Err(crate::error::AppError::InvalidInput(_))));
        database.set_setting(KEY_RUN_HISTORY_RETENTION_DAYS, "0").unwrap();
        assert_eq!(AppSettings::load(&database).unwrap().run_history_retention_days, Some(30));
    }

    #[test]
    fn an_older_frontend_without_the_new_fields_still_deserializes() {
        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "openAtLogin": true, "showInMenuBar": true, "notifyOnApproval": true, "notifyOnFailure": true,
            "keepAwakeWhileRunning": true, "keepAwakeOnlyOnPower": true, "missedRunDefaultPolicy": "skip"
        }))
        .unwrap();
        assert!(settings.open_at_login);
        assert_eq!(settings.run_history_retention_days, Some(30));
        assert!(settings.auto_download_updates);
    }

    #[test]
    fn retention_prunes_only_when_limited() {
        let database = test_database();
        let forever = AppSettings { run_history_retention_days: None, ..AppSettings::default() };
        assert_eq!(forever.prune_run_history(&database).unwrap(), 0);
        assert_eq!(AppSettings::default().prune_run_history(&database).unwrap(), 0);
    }

    #[test]
    fn settings_round_trip_again() {
        let database = test_database();
        let changed = AppSettings { notify_daily_summary: true, ..AppSettings::default() };
        changed.save(&database).unwrap();
        assert_eq!(AppSettings::load(&database).unwrap(), changed);
    }

    #[test]
    fn updates_download_by_themselves_until_switched_off() {
        let database = test_database();
        assert!(AppSettings::load(&database).unwrap().auto_download_updates);
        let manual = AppSettings { auto_download_updates: false, ..AppSettings::default() };
        manual.save(&database).unwrap();
        assert!(!AppSettings::load(&database).unwrap().auto_download_updates);
    }

    #[test]
    fn plugins_update_by_themselves_until_switched_off() {
        let database = test_database();
        assert!(AppSettings::load(&database).unwrap().auto_update_plugins);
        let manual = AppSettings { auto_update_plugins: false, ..AppSettings::default() };
        manual.save(&database).unwrap();
        assert!(!AppSettings::load(&database).unwrap().auto_update_plugins);
        let older_frontend: AppSettings = serde_json::from_value(serde_json::json!({ "openAtLogin": false })).unwrap();
        assert!(older_frontend.auto_update_plugins);
        assert_eq!(serde_json::to_value(AppSettings::default()).unwrap()["autoUpdatePlugins"], true);
    }

    #[test]
    fn developer_mode_is_off_until_switched_on() {
        let database = test_database();
        assert!(!AppSettings::load(&database).unwrap().developer_mode);
        let developer = AppSettings { developer_mode: true, ..AppSettings::default() };
        developer.save(&database).unwrap();
        assert!(AppSettings::load(&database).unwrap().developer_mode);
        let older_frontend: AppSettings = serde_json::from_value(serde_json::json!({ "openAtLogin": false })).unwrap();
        assert!(!older_frontend.developer_mode);
        assert_eq!(serde_json::to_value(AppSettings::default()).unwrap()["developerMode"], false);
    }

    #[test]
    fn unreadable_values_fall_back_to_defaults() {
        let database = test_database();
        database.set_setting(KEY_SHOW_IN_MENU_BAR, "maybe").unwrap();
        database.set_setting(KEY_MISSED_RUN_POLICY, "sometimes").unwrap();
        assert_eq!(AppSettings::load(&database).unwrap(), AppSettings::default());
    }

    #[test]
    fn serializes_as_camel_case() {
        let json = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(json["openAtLogin"], false);
        assert_eq!(json["missedRunDefaultPolicy"], "run_once");
        assert_eq!(json["runHistoryRetentionDays"], 30);
        assert_eq!(json["notifyDailySummary"], false);
        assert_eq!(json["autoDownloadUpdates"], true);
    }
}
