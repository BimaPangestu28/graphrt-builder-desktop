//! Runs, their ordered event log and paused-run snapshots.
//!
//! Status transitions enforced here:
//! `Running → Paused → Running → …` and `Running | Paused → Succeeded | Failed | Aborted`.
//! A terminal run is never changed again, so a late `finish_run` from a racing
//! task cannot overwrite e.g. an `Aborted` run with `Succeeded`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::agents::ensure_agent_exists;
use super::codec::{json_column, json_to_text, optional_json_column};
use super::models::{Run, RunEventRecord, RunFilter, RunStatus, RunTrigger};
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

const RUN_COLUMNS: &str = "id, agent_id, agent_version, \"trigger\", status, started_at, finished_at, \
     outputs_json, error_message, pause_reasons_json";

const DEFAULT_RUN_LIST_LIMIT: i64 = 100;
const MAX_RUN_LIST_LIMIT: i64 = 1000;
const INTERRUPTED_RUN_MESSAGE: &str = "The app closed while this run was in progress";

impl Database {
    /// Inserts a run in status `Running` with a new id, `started_at = now`.
    pub fn insert_run(&self, agent_id: &str, agent_version: i64, trigger: RunTrigger) -> AppResult<Run> {
        if agent_version < 1 {
            return Err(AppError::InvalidInput(format!("agent version must be at least 1, got {agent_version}")));
        }
        let run = Run {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            agent_version,
            trigger,
            status: RunStatus::Running,
            started_at: now_rfc3339(),
            finished_at: None,
            outputs: None,
            error_message: None,
            pause_reasons: None,
        };
        let connection = self.lock()?;
        // Checked up front so callers get NotFound instead of a raw foreign-key error.
        ensure_agent_exists(&connection, agent_id)?;
        connection.execute(
            "INSERT INTO runs (id, agent_id, agent_version, \"trigger\", status, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![run.id, run.agent_id, run.agent_version, run.trigger, run.status, run.started_at],
        )?;
        Ok(run)
    }

    /// Appends one event (graphrt `Event` as JSON) with the next `seq` for this run.
    pub fn append_run_event(&self, run_id: &str, event: &serde_json::Value) -> AppResult<i64> {
        let connection = self.lock()?;
        fetch_run_status(&connection, run_id)?;
        // Computing seq inside the INSERT keeps it atomic in a single statement;
        // the connection mutex plus the (run_id, seq) primary key rule out duplicates.
        let seq: i64 = connection.query_row(
            "INSERT INTO run_events (run_id, seq, event_json, created_at)
             SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3 FROM run_events WHERE run_id = ?1
             RETURNING seq",
            params![run_id, json_to_text(event), now_rfc3339()],
            |row| row.get(0),
        )?;
        Ok(seq)
    }

    /// Marks the run paused, storing the graphrt snapshot JSON and the pause reasons.
    pub fn mark_run_paused(
        &self,
        run_id: &str,
        snapshot_json: &str,
        pause_reasons: &serde_json::Value,
    ) -> AppResult<()> {
        // A snapshot that does not parse could never be resumed; reject it now.
        serde_json::from_str::<serde_json::Value>(snapshot_json)
            .map_err(|parse_error| AppError::InvalidInput(format!("run snapshot is not valid JSON: {parse_error}")))?;
        let connection = self.lock()?;
        require_status(&connection, run_id, &[RunStatus::Running], "pause")?;
        connection.execute(
            "UPDATE runs SET status = ?1, snapshot_json = ?2, pause_reasons_json = ?3 WHERE id = ?4",
            params![RunStatus::Paused, snapshot_json, json_to_text(pause_reasons), run_id],
        )?;
        Ok(())
    }

    /// Back to `Running` after a resume; clears the snapshot and pause reasons.
    pub fn mark_run_resumed(&self, run_id: &str) -> AppResult<()> {
        let connection = self.lock()?;
        require_status(&connection, run_id, &[RunStatus::Paused], "resume")?;
        connection.execute(
            "UPDATE runs SET status = ?1, snapshot_json = NULL, pause_reasons_json = NULL WHERE id = ?2",
            params![RunStatus::Running, run_id],
        )?;
        Ok(())
    }

    /// Terminal state: `Succeeded` (with outputs), `Failed` (with error) or `Aborted`.
    pub fn finish_run(
        &self,
        run_id: &str,
        status: RunStatus,
        outputs: Option<&serde_json::Value>,
        error_message: Option<&str>,
    ) -> AppResult<()> {
        if !is_terminal(status) {
            return Err(AppError::InvalidInput(format!("{} is not a terminal run status", status.as_db_text())));
        }
        let connection = self.lock()?;
        require_status(&connection, run_id, &[RunStatus::Running, RunStatus::Paused], "finish")?;
        // The snapshot is only needed to resume; a finished run drops it to save space.
        connection.execute(
            "UPDATE runs SET status = ?1, finished_at = ?2, outputs_json = ?3, error_message = ?4,
                 snapshot_json = NULL, pause_reasons_json = NULL
             WHERE id = ?5",
            params![status, now_rfc3339(), outputs.map(json_to_text), error_message, run_id],
        )?;
        Ok(())
    }

    /// The stored graphrt snapshot JSON of a paused run.
    pub fn get_run_snapshot(&self, run_id: &str) -> AppResult<String> {
        let connection = self.lock()?;
        let snapshot: Option<String> = connection
            .query_row("SELECT snapshot_json FROM runs WHERE id = ?1", [run_id], |row| row.get(0))
            .optional()?
            .ok_or_else(|| run_not_found(run_id))?;
        snapshot.ok_or_else(|| AppError::InvalidInput(format!("run {run_id} is not paused and has no snapshot")))
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<Run> {
        let connection = self.lock()?;
        connection
            .query_row(&format!("SELECT {RUN_COLUMNS} FROM runs WHERE id = ?1"), [run_id], map_run_row)
            .optional()?
            .ok_or_else(|| run_not_found(run_id))
    }

    /// Runs matching the filter, newest first.
    pub fn list_runs(&self, filter: &RunFilter) -> AppResult<Vec<Run>> {
        let limit = resolve_limit(filter.limit)?;
        let connection = self.lock()?;
        // `?1 IS NULL OR …` keeps one static, fully parameterized query for every filter combination.
        let mut statement = connection.prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM runs
             WHERE (?1 IS NULL OR agent_id = ?1) AND (?2 IS NULL OR status = ?2)
             ORDER BY started_at DESC, rowid DESC
             LIMIT ?3"
        ))?;
        let runs = statement
            .query_map(params![filter.agent_id, filter.status, limit], map_run_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(runs)
    }

    /// Events of a run in `seq` order.
    pub fn list_run_events(&self, run_id: &str) -> AppResult<Vec<RunEventRecord>> {
        let connection = self.lock()?;
        fetch_run_status(&connection, run_id)?;
        let mut statement = connection.prepare(
            "SELECT run_id, seq, event_json, created_at FROM run_events
             WHERE run_id = ?1 ORDER BY seq ASC",
        )?;
        let events = statement.query_map([run_id], map_event_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    /// Runs left in `Running` by a crash or quit are marked `Failed` at start-up.
    ///
    /// Paused runs are left alone: their snapshot is persisted, so they remain resumable.
    pub fn fail_interrupted_runs(&self) -> AppResult<usize> {
        let connection = self.lock()?;
        let failed_count = connection.execute(
            "UPDATE runs SET status = ?1, finished_at = ?2, error_message = ?3, snapshot_json = NULL
             WHERE status = ?4",
            params![RunStatus::Failed, now_rfc3339(), INTERRUPTED_RUN_MESSAGE, RunStatus::Running],
        )?;
        Ok(failed_count)
    }

    /// Deletes the event logs of runs that finished more than `older_than_days`
    /// days ago; returns how many events were deleted. The run rows (status,
    /// outputs, error) are kept.
    ///
    /// Only finished runs (`Succeeded`, `Failed`, `Aborted`) are pruned, and
    /// always their whole log: running and paused runs keep every event however
    /// old, since a paused run can be resumed at any time.
    ///
    /// # Errors
    /// `InvalidInput` when `older_than_days` is 0.
    pub fn prune_old_run_events(&self, older_than_days: u32) -> AppResult<usize> {
        if older_than_days == 0 {
            return Err(AppError::InvalidInput("run event retention must be at least 1 day".into()));
        }
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(i64::from(older_than_days))).to_rfc3339();
        let connection = self.lock()?;
        // `finished_at` is RFC 3339 UTC like `cutoff`, so text order is time order.
        let deleted_count = connection.execute(
            "DELETE FROM run_events WHERE run_id IN (
                 SELECT id FROM runs
                 WHERE status IN (?1, ?2, ?3) AND finished_at IS NOT NULL AND finished_at < ?4
             )",
            params![RunStatus::Succeeded, RunStatus::Failed, RunStatus::Aborted, cutoff],
        )?;
        Ok(deleted_count)
    }
}

fn is_terminal(status: RunStatus) -> bool {
    matches!(status, RunStatus::Succeeded | RunStatus::Failed | RunStatus::Aborted)
}

fn resolve_limit(requested_limit: Option<i64>) -> AppResult<i64> {
    match requested_limit {
        None => Ok(DEFAULT_RUN_LIST_LIMIT),
        Some(limit) if limit < 1 => {
            Err(AppError::InvalidInput(format!("run list limit must be at least 1, got {limit}")))
        }
        Some(limit) => Ok(limit.min(MAX_RUN_LIST_LIMIT)),
    }
}

fn run_not_found(run_id: &str) -> AppError {
    AppError::NotFound(format!("run {run_id}"))
}

fn fetch_run_status(connection: &Connection, run_id: &str) -> AppResult<RunStatus> {
    connection
        .query_row("SELECT status FROM runs WHERE id = ?1", [run_id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| run_not_found(run_id))
}

/// Fails with `InvalidInput` unless the run is in one of `allowed_statuses`.
fn require_status(
    connection: &Connection,
    run_id: &str,
    allowed_statuses: &[RunStatus],
    action: &str,
) -> AppResult<()> {
    let current_status = fetch_run_status(connection, run_id)?;
    if allowed_statuses.contains(&current_status) {
        return Ok(());
    }
    Err(AppError::InvalidInput(format!("cannot {action} run {run_id}: it is {}", current_status.as_db_text())))
}

fn map_run_row(row: &Row<'_>) -> rusqlite::Result<Run> {
    Ok(Run {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        agent_version: row.get("agent_version")?,
        trigger: row.get("trigger")?,
        status: row.get("status")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        outputs: optional_json_column(row, "outputs_json")?,
        error_message: row.get("error_message")?,
        pause_reasons: optional_json_column(row, "pause_reasons_json")?,
    })
}

fn map_event_row(row: &Row<'_>) -> rusqlite::Result<RunEventRecord> {
    Ok(RunEventRecord {
        run_id: row.get("run_id")?,
        seq: row.get("seq")?,
        event: json_column(row, "event_json")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    fn start_run(database: &Database) -> Run {
        let agent = create_test_agent(database, "Runner");
        database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap()
    }

    #[test]
    fn insert_run_starts_running() {
        let database = test_database();
        let run = start_run(&database);
        assert_eq!(run.status, RunStatus::Running);
        assert!(run.finished_at.is_none());
        assert_eq!(database.get_run(&run.id).unwrap(), run);
    }

    #[test]
    fn insert_run_requires_existing_agent_and_valid_version() {
        let database = test_database();
        assert!(matches!(database.insert_run("ghost", 1, RunTrigger::Test), Err(AppError::NotFound(_))));
        let agent = create_test_agent(&database, "Runner");
        assert!(matches!(database.insert_run(&agent.id, 0, RunTrigger::Test), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn events_get_increasing_seq_per_run() {
        let database = test_database();
        let first_run = start_run(&database);
        let second_run = start_run(&database);
        for index in 0..3 {
            let seq = database.append_run_event(&first_run.id, &json!({"index": index})).unwrap();
            assert_eq!(seq, index + 1);
        }
        assert_eq!(database.append_run_event(&second_run.id, &json!({})).unwrap(), 1);

        let events = database.list_run_events(&first_run.id).unwrap();
        let seqs: Vec<i64> = events.iter().map(|event| event.seq).collect();
        assert_eq!(seqs, [1, 2, 3]);
        assert_eq!(events[2].event, json!({"index": 2}));
        assert_eq!(database.list_run_events(&second_run.id).unwrap().len(), 1);
    }

    #[test]
    fn concurrent_appends_never_duplicate_seq() {
        let database = std::sync::Arc::new(test_database());
        let run = start_run(&database);
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let database = database.clone();
                let run_id = run.id.clone();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        database.append_run_event(&run_id, &json!({})).unwrap();
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let seqs: Vec<i64> = database.list_run_events(&run.id).unwrap().iter().map(|event| event.seq).collect();
        assert_eq!(seqs, (1..=100).collect::<Vec<i64>>());
    }

    #[test]
    fn events_for_missing_run_are_not_found() {
        let database = test_database();
        assert!(matches!(database.append_run_event("ghost", &json!({})), Err(AppError::NotFound(_))));
        assert!(matches!(database.list_run_events("ghost"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn paused_then_resumed_then_succeeded() {
        let database = test_database();
        let run = start_run(&database);
        let reasons = json!([{"kind": "approval", "node": "send_email"}]);
        database.mark_run_paused(&run.id, r#"{"state": 1}"#, &reasons).unwrap();

        let paused = database.get_run(&run.id).unwrap();
        assert_eq!(paused.status, RunStatus::Paused);
        assert_eq!(paused.pause_reasons, Some(reasons));
        assert_eq!(database.get_run_snapshot(&run.id).unwrap(), r#"{"state": 1}"#);

        database.mark_run_resumed(&run.id).unwrap();
        let resumed = database.get_run(&run.id).unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
        assert!(resumed.pause_reasons.is_none());
        assert!(matches!(database.get_run_snapshot(&run.id), Err(AppError::InvalidInput(_))));

        database.finish_run(&run.id, RunStatus::Succeeded, Some(&json!({"sent": true})), None).unwrap();
        let finished = database.get_run(&run.id).unwrap();
        assert_eq!(finished.status, RunStatus::Succeeded);
        assert_eq!(finished.outputs, Some(json!({"sent": true})));
        assert!(finished.finished_at.is_some());
    }

    #[test]
    fn invalid_transitions_are_rejected() {
        let database = test_database();
        let run = start_run(&database);
        assert!(matches!(database.mark_run_resumed(&run.id), Err(AppError::InvalidInput(_))));
        assert!(matches!(database.mark_run_paused(&run.id, "not json", &json!([])), Err(AppError::InvalidInput(_))));
        assert!(matches!(database.finish_run(&run.id, RunStatus::Paused, None, None), Err(AppError::InvalidInput(_))));

        database.finish_run(&run.id, RunStatus::Aborted, None, None).unwrap();
        // A late success from a racing task must not overwrite the abort.
        assert!(matches!(
            database.finish_run(&run.id, RunStatus::Succeeded, None, None),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(database.mark_run_paused(&run.id, "{}", &json!([])), Err(AppError::InvalidInput(_))));
        assert_eq!(database.get_run(&run.id).unwrap().status, RunStatus::Aborted);
    }

    #[test]
    fn paused_run_can_be_aborted_and_drops_snapshot() {
        let database = test_database();
        let run = start_run(&database);
        database.mark_run_paused(&run.id, "{}", &json!([])).unwrap();
        database.finish_run(&run.id, RunStatus::Aborted, None, None).unwrap();
        let aborted = database.get_run(&run.id).unwrap();
        assert_eq!(aborted.status, RunStatus::Aborted);
        assert!(aborted.pause_reasons.is_none());
        assert!(matches!(database.get_run_snapshot(&run.id), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn failed_run_keeps_error_message() {
        let database = test_database();
        let run = start_run(&database);
        database.finish_run(&run.id, RunStatus::Failed, None, Some("model timed out")).unwrap();
        let failed = database.get_run(&run.id).unwrap();
        assert_eq!(failed.error_message.as_deref(), Some("model timed out"));
        assert!(failed.outputs.is_none());
    }

    #[test]
    fn missing_run_is_not_found() {
        let database = test_database();
        assert!(matches!(database.get_run("ghost"), Err(AppError::NotFound(_))));
        assert!(matches!(database.get_run_snapshot("ghost"), Err(AppError::NotFound(_))));
        assert!(matches!(database.mark_run_resumed("ghost"), Err(AppError::NotFound(_))));
        assert!(matches!(database.mark_run_paused("ghost", "{}", &json!([])), Err(AppError::NotFound(_))));
        assert!(matches!(database.finish_run("ghost", RunStatus::Failed, None, None), Err(AppError::NotFound(_))));
    }

    #[test]
    fn interrupted_running_runs_fail_but_paused_runs_survive() {
        let database = test_database();
        let running = start_run(&database);
        let paused = start_run(&database);
        let succeeded = start_run(&database);
        database.mark_run_paused(&paused.id, r#"{"keep": true}"#, &json!([])).unwrap();
        database.finish_run(&succeeded.id, RunStatus::Succeeded, Some(&json!({})), None).unwrap();

        assert_eq!(database.fail_interrupted_runs().unwrap(), 1);

        let failed = database.get_run(&running.id).unwrap();
        assert_eq!(failed.status, RunStatus::Failed);
        assert_eq!(failed.error_message.as_deref(), Some(INTERRUPTED_RUN_MESSAGE));
        assert!(failed.finished_at.is_some());
        assert_eq!(database.get_run(&paused.id).unwrap().status, RunStatus::Paused);
        assert_eq!(database.get_run_snapshot(&paused.id).unwrap(), r#"{"keep": true}"#);
        assert_eq!(database.get_run(&succeeded.id).unwrap().status, RunStatus::Succeeded);
        assert_eq!(database.fail_interrupted_runs().unwrap(), 0);
    }

    fn set_finished_at(database: &Database, run_id: &str, days_ago: i64) {
        let finished_at = (chrono::Utc::now() - chrono::Duration::days(days_ago)).to_rfc3339();
        database
            .lock()
            .unwrap()
            .execute("UPDATE runs SET finished_at = ?1 WHERE id = ?2", params![finished_at, run_id])
            .unwrap();
    }

    #[test]
    fn prune_deletes_only_logs_of_runs_finished_before_the_cutoff() {
        let database = test_database();
        let old_finished = start_run(&database);
        let recent_finished = start_run(&database);
        let old_paused = start_run(&database);
        let running = start_run(&database);
        for run in [&old_finished, &recent_finished, &old_paused, &running] {
            database.append_run_event(&run.id, &json!({"type": "run_started"})).unwrap();
            database.append_run_event(&run.id, &json!({"type": "node_started"})).unwrap();
        }
        database.finish_run(&old_finished.id, RunStatus::Succeeded, Some(&json!({})), None).unwrap();
        set_finished_at(&database, &old_finished.id, 31);
        database.finish_run(&recent_finished.id, RunStatus::Failed, None, Some("boom")).unwrap();
        set_finished_at(&database, &recent_finished.id, 29);
        database.mark_run_paused(&old_paused.id, "{}", &json!([])).unwrap();

        assert_eq!(database.prune_old_run_events(30).unwrap(), 2);

        assert!(database.list_run_events(&old_finished.id).unwrap().is_empty());
        assert_eq!(database.get_run(&old_finished.id).unwrap().status, RunStatus::Succeeded);
        for kept in [&recent_finished, &old_paused, &running] {
            assert_eq!(database.list_run_events(&kept.id).unwrap().len(), 2);
        }
        assert_eq!(database.prune_old_run_events(30).unwrap(), 0);
        assert!(matches!(database.prune_old_run_events(0), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn list_runs_filters_orders_and_limits() {
        let database = test_database();
        let agent = create_test_agent(&database, "A");
        let other_agent = create_test_agent(&database, "B");
        let oldest = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        let middle = database.insert_run(&other_agent.id, 1, RunTrigger::Schedule).unwrap();
        let newest = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        database.finish_run(&oldest.id, RunStatus::Succeeded, None, None).unwrap();

        let ids = |runs: Vec<Run>| runs.into_iter().map(|run| run.id).collect::<Vec<_>>();
        assert_eq!(
            ids(database.list_runs(&RunFilter::default()).unwrap()),
            [newest.id.clone(), middle.id.clone(), oldest.id.clone()]
        );
        let by_agent = RunFilter { agent_id: Some(agent.id.clone()), ..RunFilter::default() };
        assert_eq!(ids(database.list_runs(&by_agent).unwrap()), [newest.id.clone(), oldest.id.clone()]);
        let by_status = RunFilter { status: Some(RunStatus::Running), ..RunFilter::default() };
        assert_eq!(ids(database.list_runs(&by_status).unwrap()), [newest.id.clone(), middle.id]);
        let both = RunFilter { agent_id: Some(agent.id), status: Some(RunStatus::Succeeded), limit: None };
        assert_eq!(ids(database.list_runs(&both).unwrap()), [oldest.id]);
        let limited = RunFilter { limit: Some(1), ..RunFilter::default() };
        assert_eq!(ids(database.list_runs(&limited).unwrap()), [newest.id]);
    }

    #[test]
    fn list_runs_limit_defaults_caps_and_validates() {
        assert_eq!(resolve_limit(None).unwrap(), 100);
        assert_eq!(resolve_limit(Some(5000)).unwrap(), 1000);
        assert_eq!(resolve_limit(Some(7)).unwrap(), 7);
        let database = test_database();
        let zero_limit = RunFilter { limit: Some(0), ..RunFilter::default() };
        assert!(matches!(database.list_runs(&zero_limit), Err(AppError::InvalidInput(_))));
    }
}
