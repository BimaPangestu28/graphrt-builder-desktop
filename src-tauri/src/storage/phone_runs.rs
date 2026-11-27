//! Reads of runs for Phone access (`crate::phone_access`): pages of runs with a cursor,
//! and events from a position, so a phone never loads a whole history at once.
//!
//! Test runs (the builder's "Test" button) are not for phones and are never returned.

use rusqlite::params;

use super::models::{Run, RunEventRecord, RunStatus, RunTrigger};
use super::runs::{map_event_row, map_run_row, RUN_COLUMNS};
use super::Database;
use crate::error::AppResult;

/// Most runs or events one call returns.
pub const MAX_PAGE: usize = 200;

/// A run with what a phone needs to show it.
#[derive(Debug, Clone, PartialEq)]
pub struct PhoneRun {
    pub run: Run,
    /// How many events the run stored.
    pub event_count: u64,
    /// When its newest event was stored (RFC 3339), if it has one.
    pub last_event_at: Option<String>,
}

impl Database {
    /// Runs newest first, without test runs.
    ///
    /// - `status`: only runs in that status.
    /// - `agent_ids`: only runs of these agents (`None`: every agent).
    /// - `before`: the id of the last run of the previous page (the cursor).
    pub fn list_phone_runs(
        &self,
        status: Option<RunStatus>,
        agent_ids: Option<&[String]>,
        before: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<PhoneRun>> {
        let limit = i64::try_from(limit.clamp(1, MAX_PAGE)).unwrap_or(1);
        let agent_ids = agent_ids.map(serde_json::to_string).transpose()?;
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "SELECT {RUN_COLUMNS},
                    (SELECT COUNT(*) FROM run_events e WHERE e.run_id = runs.id) AS event_count,
                    (SELECT MAX(e.created_at) FROM run_events e WHERE e.run_id = runs.id) AS last_event_at
             FROM runs
             WHERE \"trigger\" != ?1
               AND (?2 IS NULL OR status = ?2)
               AND (?3 IS NULL OR agent_id IN (SELECT value FROM json_each(?3)))
               AND (?4 IS NULL OR (started_at, rowid) < (SELECT started_at, rowid FROM runs WHERE id = ?4))
             ORDER BY started_at DESC, rowid DESC
             LIMIT ?5"
        ))?;
        let rows = statement.query_map(params![RunTrigger::Test, status, agent_ids, before, limit], |row| {
            let event_count: i64 = row.get("event_count")?;
            Ok(PhoneRun {
                run: map_run_row(row)?,
                event_count: u64::try_from(event_count).unwrap_or_default(),
                last_event_at: row.get("last_event_at")?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// One run for a phone; `None` for an unknown run or a test run.
    pub fn get_phone_run(&self, run_id: &str) -> AppResult<Option<PhoneRun>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "SELECT {RUN_COLUMNS},
                    (SELECT COUNT(*) FROM run_events e WHERE e.run_id = runs.id) AS event_count,
                    (SELECT MAX(e.created_at) FROM run_events e WHERE e.run_id = runs.id) AS last_event_at
             FROM runs WHERE id = ?1 AND \"trigger\" != ?2"
        ))?;
        let mut rows = statement.query_map(params![run_id, RunTrigger::Test], |row| {
            let event_count: i64 = row.get("event_count")?;
            Ok(PhoneRun {
                run: map_run_row(row)?,
                event_count: u64::try_from(event_count).unwrap_or_default(),
                last_event_at: row.get("last_event_at")?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    /// At most `limit` events of a run in order, from position `from` (0 is its first event).
    pub fn list_run_events_from(&self, run_id: &str, from: u64, limit: usize) -> AppResult<Vec<RunEventRecord>> {
        let limit = i64::try_from(limit.clamp(1, 10 * MAX_PAGE)).unwrap_or(1);
        let offset = i64::try_from(from).unwrap_or(i64::MAX);
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT run_id, seq, event_json, created_at FROM run_events
             WHERE run_id = ?1 ORDER BY seq ASC LIMIT ?2 OFFSET ?3",
        )?;
        let events =
            statement.query_map(params![run_id, limit, offset], map_event_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    #[test]
    fn pages_of_runs_follow_the_cursor_and_skip_test_runs() {
        let database = test_database();
        let agent = create_test_agent(&database, "A");
        let other = create_test_agent(&database, "B");
        let first = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        let test_run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        let second = database.insert_run(&other.id, 1, RunTrigger::Schedule).unwrap();
        let third = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        database.append_run_event(&third.id, &json!({"type": "run_started"})).unwrap();
        database.append_run_event(&third.id, &json!({"type": "node_started"})).unwrap();

        let ids = |runs: Vec<PhoneRun>| runs.into_iter().map(|run| run.run.id).collect::<Vec<_>>();
        let page = database.list_phone_runs(None, None, None, 2).unwrap();
        assert_eq!(page[0].event_count, 2);
        assert!(page[0].last_event_at.is_some());
        assert_eq!(ids(page), [third.id.clone(), second.id.clone()]);
        assert_eq!(ids(database.list_phone_runs(None, None, Some(&second.id), 2).unwrap()), [first.id.as_str()]);
        let of_agent = [agent.id.clone()];
        assert_eq!(
            ids(database.list_phone_runs(None, Some(&of_agent), None, 10).unwrap()),
            [third.id.clone(), first.id.clone()]
        );
        assert_eq!(ids(database.list_phone_runs(None, Some(&[]), None, 10).unwrap()), Vec::<String>::new());
        database.finish_run(&first.id, RunStatus::Succeeded, None, None).unwrap();
        assert_eq!(
            ids(database.list_phone_runs(Some(RunStatus::Succeeded), None, None, 10).unwrap()),
            [first.id.as_str()]
        );

        assert!(database.get_phone_run(&test_run.id).unwrap().is_none());
        assert!(database.get_phone_run("ghost").unwrap().is_none());
        assert_eq!(database.get_phone_run(&third.id).unwrap().unwrap().event_count, 2);
    }

    #[test]
    fn events_are_read_from_a_position() {
        let database = test_database();
        let agent = create_test_agent(&database, "A");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        for index in 0..5 {
            database.append_run_event(&run.id, &json!({"index": index})).unwrap();
        }
        let events = database.list_run_events_from(&run.id, 3, 10).unwrap();
        assert_eq!(events.iter().map(|event| event.event["index"].clone()).collect::<Vec<_>>(), [json!(3), json!(4)]);
        assert!(database.list_run_events_from(&run.id, 9, 10).unwrap().is_empty());
        assert_eq!(database.list_run_events_from(&run.id, 0, 2).unwrap().len(), 2);
    }
}
