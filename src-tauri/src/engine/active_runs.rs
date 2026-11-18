//! The table of runs whose task is currently driving a graphrt stream, and
//! the abort requests made against them (see [`super::RunManager::abort_run`]).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use graphrt_core::RunHandle;

use super::USER_ABORT_REASON;
use crate::error::{AppError, AppResult};

/// Control handle of a run whose task is currently driving its stream.
///
/// `drive_id` identifies one task: after a pause and quick resume, the old
/// task must not remove the handle the new task registered for the same run.
#[derive(Debug, Clone)]
struct ActiveRun {
    drive_id: u64,
    handle: RunHandle,
    /// Set by an abort; the task reads it when it unregisters.
    abort_requested: bool,
}

#[derive(Debug, Default)]
struct ActiveRunTable {
    runs: HashMap<String, ActiveRun>,
    /// Runs aborted while `Running` before their task registered (start /
    /// resume): the task aborts its graphrt run as soon as it registers.
    pending_aborts: HashSet<String>,
}

/// Runs in progress, keyed by run id. Shared with every driver task.
#[derive(Debug, Default)]
pub(crate) struct ActiveRuns {
    table: Mutex<ActiveRunTable>,
    next_drive_id: AtomicU64,
}

impl ActiveRuns {
    fn lock(&self) -> AppResult<MutexGuard<'_, ActiveRunTable>> {
        self.table.lock().map_err(|_| AppError::Internal("active run table lock poisoned".into()))
    }

    /// Registers the handle of a new driver task and returns its `drive_id`.
    /// A run aborted before this point is aborted in graphrt right away.
    pub(super) fn register(&self, run_id: &str, handle: RunHandle) -> AppResult<u64> {
        let drive_id = self.next_drive_id.fetch_add(1, Ordering::Relaxed);
        let mut table = self.lock()?;
        let abort_requested = table.pending_aborts.remove(run_id);
        if abort_requested {
            handle.abort(USER_ABORT_REASON);
        }
        table.runs.insert(run_id.to_owned(), ActiveRun { drive_id, handle, abort_requested });
        Ok(drive_id)
    }

    /// Removes the handle only if it still belongs to the task `drive_id`.
    /// Returns whether an abort was requested while that task owned the run.
    pub(super) fn remove(&self, run_id: &str, drive_id: u64) -> bool {
        let mut table = match self.lock() {
            Ok(table) => table,
            Err(error) => {
                log::warn!("could not unregister run {run_id}: {error}");
                return false;
            }
        };
        if table.runs.get(run_id).is_none_or(|active| active.drive_id != drive_id) {
            return false;
        }
        table.runs.remove(run_id).is_some_and(|active| active.abort_requested)
    }

    /// Asks the run's task to abort. Returns `false` when no task owns the run;
    /// the abort is then remembered for a task that registers later.
    pub(super) fn request_abort(&self, run_id: &str) -> AppResult<bool> {
        let mut table = self.lock()?;
        if let Some(active) = table.runs.get_mut(run_id) {
            active.abort_requested = true;
            active.handle.abort(USER_ABORT_REASON);
            return Ok(true);
        }
        table.pending_aborts.insert(run_id.to_owned());
        Ok(false)
    }

    /// Forgets a remembered abort (the run turned out to be finished already).
    pub(super) fn cancel_pending_abort(&self, run_id: &str) {
        match self.lock() {
            Ok(mut table) => {
                table.pending_aborts.remove(run_id);
            }
            Err(error) => log::warn!("could not clear the pending abort of run {run_id}: {error}"),
        }
    }

    #[cfg(test)]
    pub(super) fn is_registered(&self, run_id: &str) -> bool {
        self.lock().is_ok_and(|table| table.runs.contains_key(run_id))
    }
}
