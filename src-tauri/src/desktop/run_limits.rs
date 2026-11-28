//! Run limits (Settings › Runner › Run limits): how long a step or a run may
//! take and how much work one run may do, handed to graphrt as
//! [`graphrt_core::engine::Limits`] whenever a run's engine is built.
//!
//! Each limit is one `settings` row (`app.run_limits.<name>`). A missing or
//! unreadable row uses the default; a stored value outside the allowed range
//! is clamped into it, so a hand-edited database can never switch a limit off.
//! Saving a value outside its range is refused.
//!
//! Keep the defaults and bounds in sync with `src/data/runLimits.ts`.

use std::ops::RangeInclusive;

use graphrt_core::engine::Limits;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::storage::Database;

const KEY_STEP_TIMEOUT_SECONDS: &str = "app.run_limits.step_timeout_seconds";
const KEY_RUN_DURATION_MINUTES: &str = "app.run_limits.run_duration_minutes";
const KEY_MAX_STEP_ATTEMPTS: &str = "app.run_limits.max_step_attempts";
const KEY_MAX_NESTING_DEPTH: &str = "app.run_limits.max_nesting_depth";
const KEY_MAX_PARALLEL_STEPS: &str = "app.run_limits.max_parallel_steps";

/// Time for one step, unless the step sets its own: 10 seconds to 1 hour.
pub const STEP_TIMEOUT_SECONDS_RANGE: RangeInclusive<u32> = 10..=3_600;
/// Active time for one run (paused time does not count): 1 minute to 24 hours.
pub const RUN_DURATION_MINUTES_RANGE: RangeInclusive<u32> = 1..=1_440;
/// Step attempts per run, retries and loop rounds included.
pub const MAX_STEP_ATTEMPTS_RANGE: RangeInclusive<u32> = 100..=1_000_000;
/// Loops inside loops.
pub const MAX_NESTING_DEPTH_RANGE: RangeInclusive<u32> = 1..=32;
/// Steps running at the same time within one loop or branch.
pub const MAX_PARALLEL_STEPS_RANGE: RangeInclusive<u32> = 1..=256;

/// The limits every run gets. Sent to the frontend as camelCase JSON
/// (`AppSettings.runLimits` in `src/api/appSettingsTypes.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunLimitsSettings {
    pub step_timeout_seconds: u32,
    pub run_duration_minutes: u32,
    pub max_step_attempts: u32,
    pub max_nesting_depth: u32,
    pub max_parallel_steps: u32,
}

impl Default for RunLimitsSettings {
    /// 2 minutes per step, 30 minutes per run and graphrt's own defaults for the rest.
    fn default() -> Self {
        Self {
            step_timeout_seconds: 2 * 60,
            run_duration_minutes: 30,
            max_step_attempts: 10_000,
            max_nesting_depth: 8,
            max_parallel_steps: 64,
        }
    }
}

/// One limit: its settings key, allowed range and how it reads and writes on the struct.
struct LimitField {
    key: &'static str,
    label: &'static str,
    range: RangeInclusive<u32>,
    get: fn(&RunLimitsSettings) -> u32,
    set: fn(&mut RunLimitsSettings, u32),
}

const LIMIT_FIELDS: [LimitField; 5] = [
    LimitField {
        key: KEY_STEP_TIMEOUT_SECONDS,
        label: "time for one step (seconds)",
        range: STEP_TIMEOUT_SECONDS_RANGE,
        get: |limits| limits.step_timeout_seconds,
        set: |limits, value| limits.step_timeout_seconds = value,
    },
    LimitField {
        key: KEY_RUN_DURATION_MINUTES,
        label: "time for one run (minutes)",
        range: RUN_DURATION_MINUTES_RANGE,
        get: |limits| limits.run_duration_minutes,
        set: |limits, value| limits.run_duration_minutes = value,
    },
    LimitField {
        key: KEY_MAX_STEP_ATTEMPTS,
        label: "step attempts per run",
        range: MAX_STEP_ATTEMPTS_RANGE,
        get: |limits| limits.max_step_attempts,
        set: |limits, value| limits.max_step_attempts = value,
    },
    LimitField {
        key: KEY_MAX_NESTING_DEPTH,
        label: "loops inside loops",
        range: MAX_NESTING_DEPTH_RANGE,
        get: |limits| limits.max_nesting_depth,
        set: |limits, value| limits.max_nesting_depth = value,
    },
    LimitField {
        key: KEY_MAX_PARALLEL_STEPS,
        label: "steps at the same time",
        range: MAX_PARALLEL_STEPS_RANGE,
        get: |limits| limits.max_parallel_steps,
        set: |limits, value| limits.max_parallel_steps = value,
    },
];

impl RunLimitsSettings {
    /// Reads the stored limits; missing or unreadable values use the default, values
    /// outside their range are clamped into it.
    ///
    /// # Errors
    /// `Database` when the settings table cannot be read.
    pub fn load(db: &Database) -> AppResult<Self> {
        let mut limits = Self::default();
        for field in &LIMIT_FIELDS {
            let default_value = (field.get)(&limits);
            let value = match db.get_setting(field.key)? {
                Some(text) => match text.trim().parse::<u32>() {
                    Ok(stored_value) => stored_value.clamp(*field.range.start(), *field.range.end()),
                    Err(_) => {
                        log::warn!("ignoring unreadable setting {}={text:?}", field.key);
                        default_value
                    }
                },
                None => default_value,
            };
            (field.set)(&mut limits, value);
        }
        Ok(limits)
    }

    /// Checks every limit is inside its range.
    ///
    /// # Errors
    /// `InvalidInput` naming the first limit outside its range.
    pub fn validate(&self) -> AppResult<()> {
        for field in &LIMIT_FIELDS {
            let value = (field.get)(self);
            if !field.range.contains(&value) {
                return Err(AppError::InvalidInput(format!(
                    "{} must be between {} and {}, got {value}",
                    field.label,
                    field.range.start(),
                    field.range.end()
                )));
            }
        }
        Ok(())
    }

    /// Stores every limit (call [`Self::validate`] first).
    ///
    /// # Errors
    /// `Database` when a value cannot be written.
    pub fn save(&self, db: &Database) -> AppResult<()> {
        for field in &LIMIT_FIELDS {
            db.set_setting(field.key, &(field.get)(self).to_string())?;
        }
        Ok(())
    }

    /// The graphrt limits for one run.
    pub fn to_engine_limits(self) -> Limits {
        Limits {
            max_steps: u64::from(self.max_step_attempts),
            max_duration_ms: Some(u64::from(self.run_duration_minutes) * 60 * 1000),
            max_depth: self.max_nesting_depth,
            default_node_timeout_ms: Some(u64::from(self.step_timeout_seconds) * 1000),
            max_concurrency: usize::try_from(self.max_parallel_steps).unwrap_or(usize::MAX),
            // Token and cost limits are per agent (its "Spending limit"), applied per run.
            max_total_tokens: None,
            max_cost_micros: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_engine_values_the_app_always_used() {
        let limits = RunLimitsSettings::default().to_engine_limits();
        assert_eq!(limits.default_node_timeout_ms, Some(120_000));
        assert_eq!(limits.max_duration_ms, Some(30 * 60 * 1000));
        assert_eq!((limits.max_steps, limits.max_depth, limits.max_concurrency), (10_000, 8, 64));
        assert!(RunLimitsSettings::default().validate().is_ok());
    }

    #[test]
    fn stored_limits_round_trip_and_become_engine_limits() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(RunLimitsSettings::load(&db).unwrap(), RunLimitsSettings::default());
        let changed = RunLimitsSettings {
            step_timeout_seconds: 300,
            run_duration_minutes: 90,
            max_step_attempts: 500,
            max_nesting_depth: 3,
            max_parallel_steps: 4,
        };
        changed.save(&db).unwrap();
        assert_eq!(RunLimitsSettings::load(&db).unwrap(), changed);
        let limits = changed.to_engine_limits();
        assert_eq!(limits.default_node_timeout_ms, Some(300_000));
        assert_eq!(limits.max_duration_ms, Some(90 * 60 * 1000));
        assert_eq!((limits.max_steps, limits.max_depth, limits.max_concurrency), (500, 3, 4));
    }

    #[test]
    fn values_outside_the_bounds_are_refused_on_save_and_clamped_on_load() {
        let too_short = RunLimitsSettings { step_timeout_seconds: 1, ..RunLimitsSettings::default() };
        assert!(matches!(too_short.validate(), Err(AppError::InvalidInput(message)) if message.contains("one step")));
        let no_parallel = RunLimitsSettings { max_parallel_steps: 0, ..RunLimitsSettings::default() };
        assert!(no_parallel.validate().is_err());

        let db = Database::open_in_memory().unwrap();
        db.set_setting(KEY_MAX_NESTING_DEPTH, "1000").unwrap();
        db.set_setting(KEY_STEP_TIMEOUT_SECONDS, "0").unwrap();
        db.set_setting(KEY_MAX_STEP_ATTEMPTS, "lots").unwrap();
        let loaded = RunLimitsSettings::load(&db).unwrap();
        assert_eq!(loaded.max_nesting_depth, *MAX_NESTING_DEPTH_RANGE.end());
        assert_eq!(loaded.step_timeout_seconds, *STEP_TIMEOUT_SECONDS_RANGE.start());
        assert_eq!(loaded.max_step_attempts, RunLimitsSettings::default().max_step_attempts);
    }

    #[test]
    fn serializes_as_camel_case_and_fills_missing_fields() {
        let json = serde_json::to_value(RunLimitsSettings::default()).unwrap();
        assert_eq!(json["stepTimeoutSeconds"], 120);
        assert_eq!(json["maxParallelSteps"], 64);
        let partial: RunLimitsSettings = serde_json::from_value(serde_json::json!({"runDurationMinutes": 45})).unwrap();
        assert_eq!(partial.run_duration_minutes, 45);
        assert_eq!(partial.max_nesting_depth, 8);
    }
}
