//! Starts scheduled runs. Lives in the desktop app, not in graphrt: graphrt only
//! runs a flow when asked; when to ask is the host's job.
//!
//! A background task wakes every [`TICK_SECONDS`] (and once immediately at
//! start-up, which catches runs missed while the app was closed) and calls
//! [`run_due_triggers`]. A trigger is due when `next_fire_at <= now`. If it is
//! late by more than two ticks, the run was missed (the computer slept or the
//! app was closed) and the trigger's `MissedRunPolicy` applies: `RunOnce`
//! starts a single run now, however many slots were missed; `Skip` only moves
//! `next_fire_at` on. Either way the next fire time is computed from *now*.
//!
//! The tick timer is monotonic and on macOS does not advance while the Mac is
//! asleep, so after a wake-up the first tick arrives within one tick of awake
//! time. [`SchedulerHandle::request_tick`] lets the app tick right away (for
//! example from a system wake notification).
//!
//! See [`cron_schedule`] for the accepted cron syntax.

pub mod cron_schedule;
pub mod tick;

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::MissedTickBehavior;

pub use self::cron_schedule::ZonedSchedule;
pub use self::tick::{run_due_triggers, ScheduledRunStarter, TickReport};
use crate::engine::RunManager;
use crate::error::AppResult;
use crate::storage::Database;

pub const TICK_SECONDS: u64 = 20;

/// Next fire time strictly after `after` (RFC 3339 UTC), or `None` if the cron
/// expression never fires again. Validates the expression and time zone.
///
/// @throws AppError::Schedule - when the expression or the zone is invalid
///
/// @example
/// // Weekdays at 09:00 in Jakarta
/// let next = next_fire_after("0 0 9 * * Mon-Fri", "Asia/Jakarta", chrono::Utc::now())?;
pub fn next_fire_after(
    cron_expression: &str,
    timezone: &str,
    after: chrono::DateTime<chrono::Utc>,
) -> AppResult<Option<String>> {
    let schedule = ZonedSchedule::parse(cron_expression, timezone)?;
    Ok(schedule.next_fire_after(after).map(cron_schedule::format_fire_time))
}

/// The next `count` fire times from now (RFC 3339 UTC), for the schedule dialog preview.
/// Fewer are returned if the schedule ends (e.g. a year field in the past).
///
/// @throws AppError::Schedule - when the expression or the zone is invalid
pub fn preview_fire_times(cron_expression: &str, timezone: &str, count: usize) -> AppResult<Vec<String>> {
    preview_fire_times_after(cron_expression, timezone, count, chrono::Utc::now())
}

fn preview_fire_times_after(
    cron_expression: &str,
    timezone: &str,
    count: usize,
    after: chrono::DateTime<chrono::Utc>,
) -> AppResult<Vec<String>> {
    let schedule = ZonedSchedule::parse(cron_expression, timezone)?;
    let fire_times = schedule.fire_times_after(after).take(count).map(cron_schedule::format_fire_time).collect();
    Ok(fire_times)
}

/// Handle to the running background loop; dropping it does not stop the loop.
/// Cheap to clone.
#[derive(Debug, Clone)]
pub struct SchedulerHandle {
    tick_requests: Arc<Notify>,
}

impl SchedulerHandle {
    /// Asks the loop to tick now instead of waiting for the timer, e.g. after
    /// the system wakes. Requests made while a tick is running coalesce into one.
    pub fn request_tick(&self) {
        self.tick_requests.notify_one();
    }
}

/// Spawns the scheduler loop on the Tauri async runtime.
pub fn spawn(db: Arc<Database>, runs: Arc<RunManager>) -> SchedulerHandle {
    let tick_requests = Arc::new(Notify::new());
    tauri::async_runtime::spawn(run_scheduler_loop(db, runs, tick_requests.clone()));
    SchedulerHandle { tick_requests }
}

/// Ticks forever, one tick at a time, so a trigger is never evaluated by two ticks at once.
async fn run_scheduler_loop(db: Arc<Database>, runs: Arc<RunManager>, tick_requests: Arc<Notify>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SECONDS));
    // After a long stall, tick once and resume the normal cadence instead of bursting.
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    log::info!("scheduler started, ticking every {TICK_SECONDS}s");
    loop {
        // The first `tick()` completes immediately: runs missed while the app was closed start now.
        tokio::select! {
            _ = ticker.tick() => {}
            _ = tick_requests.notified() => {}
        }
        match run_due_triggers(&db, runs.as_ref(), chrono::Utc::now()).await {
            Ok(report) if !report.is_empty() => log::info!("scheduler tick: {report:?}"),
            Ok(_) => {}
            Err(error) => log::error!("scheduler tick failed: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, TimeZone, Utc};

    use super::*;
    use crate::error::AppError;

    fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap()
    }

    #[test]
    fn weekday_jakarta_skips_the_weekend() {
        // Friday 2026-11-20 10:00 Jakarta (03:00 UTC): next is Monday 09:00 Jakarta = 02:00 UTC.
        let next = next_fire_after("0 0 9 * * Mon-Fri", "Asia/Jakarta", utc(2026, 11, 20, 3, 0)).unwrap();
        assert_eq!(next.as_deref(), Some("2026-11-23T02:00:00+00:00"));
    }

    #[test]
    fn weekday_jakarta_same_day_before_nine() {
        // Friday 08:00 Jakarta: fires the same day at 09:00.
        let next = next_fire_after("0 0 9 * * Mon-Fri", "Asia/Jakarta", utc(2026, 11, 20, 1, 0)).unwrap();
        assert_eq!(next.as_deref(), Some("2026-11-20T02:00:00+00:00"));
    }

    #[test]
    fn new_york_keeps_local_time_across_dst_end() {
        // DST ends 2026-11-01 in New York: 09:00 EDT is 13:00 UTC, 09:00 EST is 14:00 UTC.
        let fire_times =
            preview_fire_times_after("0 0 9 * * *", "America/New_York", 3, utc(2026, 10, 30, 12, 0)).unwrap();
        assert_eq!(fire_times, ["2026-10-30T13:00:00+00:00", "2026-10-31T13:00:00+00:00", "2026-11-01T14:00:00+00:00"]);
    }

    #[test]
    fn new_york_skips_nonexistent_time_at_dst_start() {
        // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 -> 03:00).
        let next = next_fire_after("0 30 2 * * *", "America/New_York", utc(2026, 3, 8, 5, 0)).unwrap();
        // 2026-03-09 02:30 EDT = 06:30 UTC.
        assert_eq!(next.as_deref(), Some("2026-03-09T06:30:00+00:00"));
    }

    #[test]
    fn invalid_cron_expression_is_a_schedule_error() {
        let error = next_fire_after("0 0 25 * * *", "UTC", Utc::now()).unwrap_err();
        assert!(matches!(&error, AppError::Schedule(message) if message.contains("invalid cron expression")));
        let garbage = preview_fire_times("every day at nine", "UTC", 3).unwrap_err();
        assert!(matches!(garbage, AppError::Schedule(_)));
    }

    #[test]
    fn invalid_timezone_is_a_schedule_error() {
        let error = next_fire_after("0 0 9 * * *", "Mars/Olympus_Mons", Utc::now()).unwrap_err();
        assert!(matches!(&error, AppError::Schedule(message) if message.contains("unknown time zone")));
    }

    #[test]
    fn preview_returns_requested_count_in_order() {
        let fire_times = preview_fire_times("0 */15 * * * *", "Asia/Jakarta", 5).unwrap();
        assert_eq!(fire_times.len(), 5);
        let parsed: Vec<DateTime<Utc>> = fire_times
            .iter()
            .map(|fire_time| DateTime::parse_from_rfc3339(fire_time).unwrap().with_timezone(&Utc))
            .collect();
        assert!(parsed.windows(2).all(|pair| pair[1] - pair[0] == chrono::Duration::minutes(15)));
        assert!(parsed[0] > Utc::now());
    }

    #[test]
    fn schedule_that_ended_has_no_next_fire() {
        assert_eq!(next_fire_after("0 0 9 1 1 * 2020", "UTC", utc(2026, 1, 1, 0, 0)).unwrap(), None);
        assert!(preview_fire_times("0 0 9 1 1 * 2020", "UTC", 5).unwrap().is_empty());
    }
}
