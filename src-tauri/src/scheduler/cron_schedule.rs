//! Cron expression evaluation in an IANA time zone.
//!
//! Expressions use the `cron` crate syntax: 6 or 7 space-separated fields with
//! **seconds first** and an optional year last:
//!
//! ```text
//! sec  min  hour  day-of-month  month  day-of-week  [year]
//! 0    0    9     *             *      Mon-Fri
//! ```
//!
//! Day-of-week numbering differs from Unix cron: here `1` is Sunday and `7` is
//! Saturday (Unix uses `0`/`7` for Sunday, `1` for Monday). Names avoid the
//! confusion and are the recommended form: `Mon-Fri`, `Sat,Sun`, `Mon,Wed,Fri`.
//! Month names (`Jan`, `May-Aug`) work too. Five-field Unix expressions are
//! rejected rather than guessed, because silently shifting day numbers would
//! run schedules on the wrong day.
//!
//! Daylight saving: a local time that does not exist (spring forward) is
//! skipped that day; times are always computed in the zone's local clock, so
//! "09:00" stays 09:00 local on both sides of a transition.

use std::str::FromStr;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;

use crate::error::{AppError, AppResult};

const EXAMPLE_EXPRESSION: &str = "0 0 9 * * Mon-Fri";

/// A parsed cron schedule bound to its time zone.
#[derive(Debug, Clone)]
pub struct ZonedSchedule {
    schedule: Schedule,
    timezone: Tz,
}

impl ZonedSchedule {
    /// Parses and validates an expression and IANA zone name.
    ///
    /// @throws AppError::Schedule - when the expression or the zone is invalid
    pub fn parse(cron_expression: &str, timezone: &str) -> AppResult<Self> {
        let schedule = parse_cron_expression(cron_expression)?;
        let timezone = parse_timezone(timezone)?;
        Ok(Self { schedule, timezone })
    }

    /// The first fire time strictly after `after`, in UTC; `None` if the schedule has ended.
    pub fn next_fire_after(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.fire_times_after(after).next()
    }

    /// Fire times strictly after `after`, in UTC.
    pub fn fire_times_after(&self, after: DateTime<Utc>) -> impl Iterator<Item = DateTime<Utc>> + '_ {
        let zoned_after = after.with_timezone(&self.timezone);
        self.schedule.after(&zoned_after).map(|fire_time| fire_time.with_timezone(&Utc))
    }
}

fn parse_cron_expression(cron_expression: &str) -> AppResult<Schedule> {
    let trimmed_expression = cron_expression.trim();
    let field_count = trimmed_expression.split_whitespace().count();
    if !(6..=7).contains(&field_count) {
        return Err(AppError::Schedule(format!(
            "cron expression \"{trimmed_expression}\" has {field_count} fields; expected 6 or 7 \
             (seconds first, optional year last), e.g. \"{EXAMPLE_EXPRESSION}\""
        )));
    }
    Schedule::from_str(trimmed_expression).map_err(|error| {
        AppError::Schedule(format!(
            "invalid cron expression \"{trimmed_expression}\": {error}. \
             Use seconds first and day names for weekdays, e.g. \"{EXAMPLE_EXPRESSION}\""
        ))
    })
}

fn parse_timezone(timezone: &str) -> AppResult<Tz> {
    let trimmed_timezone = timezone.trim();
    trimmed_timezone.parse::<Tz>().map_err(|_| {
        AppError::Schedule(format!(
            "unknown time zone \"{trimmed_timezone}\"; use an IANA name such as \"Asia/Jakarta\" or \"UTC\""
        ))
    })
}

/// Formats a fire time the way every timestamp column stores it.
pub fn format_fire_time(fire_time: DateTime<Utc>) -> String {
    fire_time.to_rfc3339()
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap()
    }

    #[test]
    fn rejects_five_field_unix_expression() {
        let error = ZonedSchedule::parse("0 9 * * 1-5", "UTC").unwrap_err();
        assert!(matches!(&error, AppError::Schedule(message) if message.contains("expected 6 or 7")));
    }

    #[test]
    fn day_numbers_start_at_sunday() {
        // 2026-11-20 is a Friday; "2" in the cron crate is Monday.
        let schedule = ZonedSchedule::parse("0 0 9 * * 2", "UTC").unwrap();
        let next = schedule.fire_times_after(utc(2026, 11, 20, 12, 0)).next().unwrap();
        assert_eq!(next, utc(2026, 11, 23, 9, 0));
    }

    #[test]
    fn fire_times_are_strictly_after() {
        let schedule = ZonedSchedule::parse("0 0 9 * * *", "UTC").unwrap();
        let next = schedule.fire_times_after(utc(2026, 11, 20, 9, 0)).next().unwrap();
        assert_eq!(next, utc(2026, 11, 21, 9, 0));
    }
}
