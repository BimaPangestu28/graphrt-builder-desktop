//! Typed view over the `settings` table for the desktop preferences on the
//! Settings screen (22): launch at login, menu bar, notifications, keep awake
//! and the default missed-run policy.
//!
//! Each field is one row (`app.<name>`), stored as `true` / `false` or the
//! serde name of the enum. Missing or unreadable rows fall back to
//! [`AppSettings::default`], so a fresh install and a corrupted value behave
//! the same way.

use serde::{Deserialize, Serialize};

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

/// Desktop preferences. Sent to the frontend as camelCase JSON
/// (`src/api/appSettingsTypes.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Start graphrt when the user logs in (so schedules fire without opening the app).
    pub open_at_login: bool,
    /// Show the tray / menu bar icon. On Windows and Linux closing the window
    /// quits the app when this is off, since nothing would bring it back.
    pub show_in_menu_bar: bool,
    /// Notify when a run pauses and waits for the user's approval.
    pub notify_on_approval: bool,
    /// Notify when a run fails.
    pub notify_on_failure: bool,
    /// Keep the Mac from idle-sleeping while a run is active (macOS only).
    pub keep_awake_while_running: bool,
    /// Keep awake only while on AC power (macOS: `caffeinate -s`, ignored on battery).
    pub keep_awake_only_on_power: bool,
    /// Policy the schedule dialog proposes for new schedules.
    pub missed_run_default_policy: MissedRunPolicy,
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
    /// @throws AppError::Database - when a value cannot be written
    pub fn save(&self, db: &Database) -> AppResult<()> {
        let flags = [
            (KEY_OPEN_AT_LOGIN, self.open_at_login),
            (KEY_SHOW_IN_MENU_BAR, self.show_in_menu_bar),
            (KEY_NOTIFY_ON_APPROVAL, self.notify_on_approval),
            (KEY_NOTIFY_ON_FAILURE, self.notify_on_failure),
            (KEY_KEEP_AWAKE, self.keep_awake_while_running),
            (KEY_KEEP_AWAKE_ONLY_ON_POWER, self.keep_awake_only_on_power),
        ];
        for (key, value) in flags {
            db.set_setting(key, if value { "true" } else { "false" })?;
        }
        db.set_setting(KEY_MISSED_RUN_POLICY, policy_text(self.missed_run_default_policy))
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
        };
        changed.save(&database).unwrap();
        assert_eq!(AppSettings::load(&database).unwrap(), changed);
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
    }
}
