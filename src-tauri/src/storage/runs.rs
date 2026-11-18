//! Runs, their ordered event log and paused-run snapshots.

use super::models::{Run, RunEventRecord, RunFilter, RunStatus, RunTrigger};
use super::Database;
use crate::error::{AppError, AppResult};

fn not_implemented<T>() -> AppResult<T> {
    Err(AppError::Internal("not implemented".into()))
}

impl Database {
    /// Inserts a run in status `Running` with a new id, `started_at = now`.
    pub fn insert_run(&self, _agent_id: &str, _agent_version: i64, _trigger: RunTrigger) -> AppResult<Run> {
        not_implemented()
    }

    /// Appends one event (graphrt `Event` as JSON) with the next `seq` for this run.
    pub fn append_run_event(&self, _run_id: &str, _event: &serde_json::Value) -> AppResult<i64> {
        not_implemented()
    }

    /// Marks the run paused, storing the graphrt snapshot JSON and the pause reasons.
    pub fn mark_run_paused(&self, _run_id: &str, _snapshot_json: &str, _pause_reasons: &serde_json::Value) -> AppResult<()> {
        not_implemented()
    }

    /// Back to `Running` after a resume; clears the snapshot and pause reasons.
    pub fn mark_run_resumed(&self, _run_id: &str) -> AppResult<()> {
        not_implemented()
    }

    /// Terminal state: `Succeeded` (with outputs), `Failed` (with error) or `Aborted`.
    pub fn finish_run(
        &self,
        _run_id: &str,
        _status: RunStatus,
        _outputs: Option<&serde_json::Value>,
        _error_message: Option<&str>,
    ) -> AppResult<()> {
        not_implemented()
    }

    /// The stored graphrt snapshot JSON of a paused run.
    pub fn get_run_snapshot(&self, _run_id: &str) -> AppResult<String> {
        not_implemented()
    }

    pub fn get_run(&self, _run_id: &str) -> AppResult<Run> {
        not_implemented()
    }

    /// Runs matching the filter, newest first.
    pub fn list_runs(&self, _filter: &RunFilter) -> AppResult<Vec<Run>> {
        not_implemented()
    }

    /// Events of a run in `seq` order.
    pub fn list_run_events(&self, _run_id: &str) -> AppResult<Vec<RunEventRecord>> {
        not_implemented()
    }

    /// Runs left in `Running` by a crash or quit are marked `Failed` at start-up.
    pub fn fail_interrupted_runs(&self) -> AppResult<usize> {
        not_implemented()
    }
}
