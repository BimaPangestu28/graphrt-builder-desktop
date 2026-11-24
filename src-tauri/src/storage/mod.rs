//! Local persistence in one SQLite file in the app data directory.
//!
//! Owns: agents and their versions, runs and their events, schedule triggers,
//! and small app settings. API keys are NOT stored here (see `credentials`).
//!
//! Schema (see `migrations.rs`):
//! - `agents(id, name, kind, description, flow_yaml, status, current_version, created_at, updated_at)`
//! - `agent_versions(agent_id, version, flow_yaml, change_summary, created_at)`
//! - `runs(id, agent_id, agent_version, trigger, status, started_at, finished_at,
//!    outputs_json, error_message, pause_reasons_json, snapshot_json)`
//! - `run_events(run_id, seq, event_json, created_at)`
//! - `run_inputs(run_id, inputs_json)`: the inputs each run started with
//! - `triggers(id, agent_id, cron_expression, timezone, enabled, missed_run_policy,
//!    inputs_json, last_fired_at, next_fire_at, created_at)`
//! - `settings(key, value)`
//! - `chains(...)`, `chain_steps(...)`: chains of agents (see `chains.rs`)
//! - `agent_settings(agent_id, key, value_json, updated_at)`: per-agent JSON settings
//! - `builder_messages(id, agent_id, role, text, explanation, status, version_before,
//!    version_after, changed_step_ids, created_at)`: the builder chat (see `builder_messages.rs`)
//! - `node_layouts(agent_id, version, node_id, x, y, width, height, collapsed)` and
//!   `canvas_viewports(agent_id, x, y, zoom, updated_at)`: the Nodes view layout (see `node_layouts.rs`)
//! - `canvas_notes(agent_id, version, note_id, x, y, w, h, text, color)`: sticky notes on the
//!   Nodes canvas, per version and copied forward (see `canvas_notes.rs`)
//!
//! `Database` is cheap to share (`Arc<Database>`); every method takes `&self`
//! and locks the single connection for the duration of the call.

pub mod agent_settings;
pub mod agents;
pub mod builder_messages;
pub mod canvas_notes;
pub mod chains;
mod codec;
pub mod deployments;
mod maintenance;
mod migrations;
pub mod models;
pub mod node_layouts;
pub mod run_inputs;
pub mod runs;
pub mod settings;
#[cfg(test)]
mod test_support;
pub mod triggers;
pub mod trusted_hosts;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// How long a statement waits for another connection's lock before failing.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    /// Opens (creating if needed) the database file and applies pending migrations.
    ///
    /// The file uses write-ahead logging with `synchronous = NORMAL`: a write is one
    /// append to the `-wal` file instead of a rewrite of the journal plus two syncs,
    /// which makes the run-event inserts of a running agent much cheaper. A commit
    /// survives an app crash; only a power loss can drop the last commits, never
    /// corrupt the file.
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        let journal_mode: String = connection.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            log::warn!("the database stays in {journal_mode} journal mode (write-ahead logging is not available)");
        }
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        Self::from_connection(connection)
    }

    /// In-memory database for tests.
    pub fn open_in_memory() -> AppResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        // Another connection to the file (e.g. a second app instance starting up)
        // waits for a lock instead of failing at once with SQLITE_BUSY.
        connection.busy_timeout(BUSY_TIMEOUT)?;
        migrations::apply(&connection)?;
        Ok(Self { connection: Mutex::new(connection) })
    }

    /// Locks the connection. A poisoned lock means a previous call panicked mid-write.
    pub(crate) fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.connection.lock().map_err(|_| AppError::Internal("database lock poisoned".into()))
    }
}

/// Current time as an RFC 3339 string (UTC), the format of every timestamp column.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pragma_text(database: &Database, pragma: &str) -> String {
        let connection = database.lock().unwrap();
        let value: rusqlite::types::Value =
            connection.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get(0)).unwrap();
        match value {
            rusqlite::types::Value::Integer(number) => number.to_string(),
            rusqlite::types::Value::Text(text) => text,
            other => format!("{other:?}"),
        }
    }

    #[test]
    fn a_file_database_uses_write_ahead_logging() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("graphrt.db")).unwrap();
        assert_eq!(pragma_text(&database, "journal_mode"), "wal");
        // 1 = NORMAL
        assert_eq!(pragma_text(&database, "synchronous"), "1");
        assert_eq!(pragma_text(&database, "foreign_keys"), "1");
        assert_eq!(pragma_text(&database, "busy_timeout"), "5000");
    }

    #[test]
    fn write_ahead_logging_survives_a_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("graphrt.db");
        drop(Database::open(&path).unwrap());
        let reopened = Database::open(&path).unwrap();
        assert_eq!(pragma_text(&reopened, "journal_mode"), "wal");
    }

    #[test]
    fn an_in_memory_database_enforces_foreign_keys_and_waits_for_locks() {
        let database = Database::open_in_memory().unwrap();
        assert_eq!(pragma_text(&database, "foreign_keys"), "1");
        assert_eq!(pragma_text(&database, "busy_timeout"), "5000");
    }
}
