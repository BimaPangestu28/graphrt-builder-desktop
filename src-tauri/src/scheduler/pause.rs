//! "Pause all agents for 1 hour" from the menu bar.
//!
//! The pause is one setting, [`SETTING_PAUSED_UNTIL`] (RFC 3339 UTC). While
//! `now < paused_until`, [`super::run_due_triggers`] returns without looking
//! at any trigger: nothing fires, nothing is planned or moved on. Once the
//! pause ends, triggers that fell due meanwhile are late like after a sleep,
//! so each one's `MissedRunPolicy` applies (`RunOnce` runs once, `Skip` moves
//! on). Runs started by hand are not affected.

use chrono::{DateTime, Duration, Utc};

use super::cron_schedule::format_fire_time;
use crate::error::AppResult;
use crate::storage::Database;

/// Setting key holding the end of the pause; absent or empty means not paused.
pub const SETTING_PAUSED_UNTIL: &str = "scheduler_paused_until";

/// The end of the current pause, or `None` when the scheduler is not paused at `now`.
/// An unreadable value is logged and treated as "not paused".
///
/// @throws AppError::Database - when the setting cannot be read
pub fn paused_until(db: &Database, now: DateTime<Utc>) -> AppResult<Option<DateTime<Utc>>> {
    let Some(stored_text) = db.get_setting(SETTING_PAUSED_UNTIL)? else {
        return Ok(None);
    };
    if stored_text.trim().is_empty() {
        return Ok(None);
    }
    match DateTime::parse_from_rfc3339(stored_text.trim()) {
        Ok(until) => Ok(Some(until.with_timezone(&Utc)).filter(|until| *until > now)),
        Err(error) => {
            log::warn!("ignoring unreadable {SETTING_PAUSED_UNTIL} {stored_text:?}: {error}");
            Ok(None)
        }
    }
}

/// Pauses scheduled runs until `now + duration` and returns that time.
///
/// @throws AppError::Database - when the setting cannot be written
pub fn pause_scheduler(db: &Database, now: DateTime<Utc>, duration: Duration) -> AppResult<DateTime<Utc>> {
    let until = now + duration;
    db.set_setting(SETTING_PAUSED_UNTIL, &format_fire_time(until))?;
    Ok(until)
}

/// Ends the pause right away.
///
/// @throws AppError::Database - when the setting cannot be written
pub fn resume_scheduler(db: &Database) -> AppResult<()> {
    db.set_setting(SETTING_PAUSED_UNTIL, "")
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn noon() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 19, 12, 0, 0).unwrap()
    }

    #[test]
    fn pause_lasts_until_its_end() {
        let database = Database::open_in_memory().unwrap();
        assert_eq!(paused_until(&database, noon()).unwrap(), None);
        let until = pause_scheduler(&database, noon(), Duration::hours(1)).unwrap();
        assert_eq!(paused_until(&database, noon() + Duration::minutes(59)).unwrap(), Some(until));
        assert_eq!(paused_until(&database, until).unwrap(), None);
    }

    #[test]
    fn resume_ends_the_pause() {
        let database = Database::open_in_memory().unwrap();
        pause_scheduler(&database, noon(), Duration::hours(1)).unwrap();
        resume_scheduler(&database).unwrap();
        assert_eq!(paused_until(&database, noon()).unwrap(), None);
    }

    #[test]
    fn unreadable_value_is_not_a_pause() {
        let database = Database::open_in_memory().unwrap();
        database.set_setting(SETTING_PAUSED_UNTIL, "soon").unwrap();
        assert_eq!(paused_until(&database, noon()).unwrap(), None);
    }
}
