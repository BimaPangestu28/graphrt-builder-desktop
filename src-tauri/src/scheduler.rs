//! Starts scheduled runs. Lives in the desktop app, not in graphrt: graphrt only
//! runs a flow when asked; when to ask is the host's job.
//!
//! A background task wakes every [`TICK_SECONDS`], starts due triggers through
//! `RunManager::start_run(.., RunTrigger::Schedule, trigger.inputs)` and stores the
//! next fire time. If the wall clock jumped forward by much more than a tick
//! (the computer slept), runs missed in between follow the trigger's
//! `MissedRunPolicy`: `RunOnce` starts one run now, `Skip` only moves `next_fire_at` on.

use std::sync::Arc;

use crate::engine::RunManager;
use crate::error::{AppError, AppResult};
use crate::storage::Database;

pub const TICK_SECONDS: u64 = 20;

/// Next fire time strictly after `after` (RFC 3339 UTC), or `None` if the cron
/// expression never fires again. Validates the expression and time zone.
pub fn next_fire_after(_cron_expression: &str, _timezone: &str, _after: chrono::DateTime<chrono::Utc>) -> AppResult<Option<String>> {
    Err(AppError::Internal("not implemented".into()))
}

/// The next `count` fire times from now (RFC 3339 UTC), for the schedule dialog preview.
pub fn preview_fire_times(_cron_expression: &str, _timezone: &str, _count: usize) -> AppResult<Vec<String>> {
    Err(AppError::Internal("not implemented".into()))
}

/// Handle to the running background loop; dropping it does not stop the loop.
#[derive(Debug, Clone)]
pub struct SchedulerHandle {
    _private: (),
}

/// Spawns the scheduler loop on the Tauri async runtime.
pub fn spawn(_db: Arc<Database>, _runs: Arc<RunManager>) -> SchedulerHandle {
    SchedulerHandle { _private: () }
}
