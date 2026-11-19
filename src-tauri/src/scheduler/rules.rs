//! Rules that apply to every schedule (Scheduler screen 10, "Rules for every
//! schedule") and that the scheduler itself enforces.
//!
//! Only rules the tick can enforce live here. The missed-run default and
//! "keep the computer awake" are desktop preferences already stored by
//! [`crate::desktop::app_settings::AppSettings`] (`app.missed_run_default_policy`,
//! `app.keep_awake_while_running`); the Scheduler screen edits those through
//! the app settings commands instead of keeping a second copy.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::storage::Database;

const KEY_MAX_CONCURRENT_RUNS: &str = "scheduler.max_concurrent_runs";
/// What a fresh install allows, as on the design ("Up to 2").
const DEFAULT_MAX_CONCURRENT_RUNS: u32 = 2;
/// Upper bound accepted from the UI; more parallel runs than this is never intended.
const MAX_ALLOWED_CONCURRENT_RUNS: u32 = 16;

/// Scheduler rules. Sent to the frontend as camelCase JSON (`src/api/scheduleRuleTypes.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRules {
    /// At most this many scheduled runs are `Running` at once. A schedule that
    /// comes due while the limit is reached skips that run (and says so in the
    /// log); runs started by hand are never limited.
    pub max_concurrent_runs: u32,
}

impl Default for ScheduleRules {
    fn default() -> Self {
        Self { max_concurrent_runs: DEFAULT_MAX_CONCURRENT_RUNS }
    }
}

impl ScheduleRules {
    /// Reads the rules; a missing or unreadable value falls back to the default.
    ///
    /// @throws AppError::Database - when the settings table cannot be read
    pub fn load(db: &Database) -> AppResult<Self> {
        let stored = db.get_setting(KEY_MAX_CONCURRENT_RUNS)?;
        let max_concurrent_runs = match stored.as_deref().map(str::parse::<u32>) {
            Some(Ok(value)) if is_allowed_limit(value) => value,
            Some(_) => {
                log::warn!("ignoring unreadable setting {KEY_MAX_CONCURRENT_RUNS}={stored:?}");
                DEFAULT_MAX_CONCURRENT_RUNS
            }
            None => DEFAULT_MAX_CONCURRENT_RUNS,
        };
        Ok(Self { max_concurrent_runs })
    }

    /// Validates and stores the rules.
    ///
    /// @throws AppError::InvalidInput - when the limit is 0 or above 16
    /// @throws AppError::Database - when the value cannot be written
    pub fn save(&self, db: &Database) -> AppResult<()> {
        if !is_allowed_limit(self.max_concurrent_runs) {
            return Err(AppError::InvalidInput(format!(
                "agents running at the same time must be between 1 and {MAX_ALLOWED_CONCURRENT_RUNS}, got {}",
                self.max_concurrent_runs
            )));
        }
        db.set_setting(KEY_MAX_CONCURRENT_RUNS, &self.max_concurrent_runs.to_string())
    }
}

fn is_allowed_limit(value: u32) -> bool {
    (1..=MAX_ALLOWED_CONCURRENT_RUNS).contains(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_allows_two_runs() {
        let database = Database::open_in_memory().unwrap();
        assert_eq!(ScheduleRules::load(&database).unwrap(), ScheduleRules { max_concurrent_runs: 2 });
    }

    #[test]
    fn rules_round_trip() {
        let database = Database::open_in_memory().unwrap();
        ScheduleRules { max_concurrent_runs: 4 }.save(&database).unwrap();
        assert_eq!(ScheduleRules::load(&database).unwrap().max_concurrent_runs, 4);
    }

    #[test]
    fn out_of_range_limits_are_rejected_and_ignored() {
        let database = Database::open_in_memory().unwrap();
        assert!(matches!(ScheduleRules { max_concurrent_runs: 0 }.save(&database), Err(AppError::InvalidInput(_))));
        assert!(matches!(ScheduleRules { max_concurrent_runs: 99 }.save(&database), Err(AppError::InvalidInput(_))));
        database.set_setting(KEY_MAX_CONCURRENT_RUNS, "lots").unwrap();
        assert_eq!(ScheduleRules::load(&database).unwrap(), ScheduleRules::default());
    }

    #[test]
    fn serializes_as_camel_case() {
        let json = serde_json::to_value(ScheduleRules::default()).unwrap();
        assert_eq!(json["maxConcurrentRuns"], 2);
    }
}
