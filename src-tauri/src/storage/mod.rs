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
//! - `triggers(id, agent_id, cron_expression, timezone, enabled, missed_run_policy,
//!    inputs_json, last_fired_at, next_fire_at, created_at)`
//! - `settings(key, value)`
//! - `chains(...)`, `chain_steps(...)`: chains of agents (see `chains.rs`)
//!
//! `Database` is cheap to share (`Arc<Database>`); every method takes `&self`
//! and locks the single connection for the duration of the call.

pub mod agents;
pub mod chains;
mod codec;
mod migrations;
pub mod models;
pub mod runs;
pub mod settings;
#[cfg(test)]
mod test_support;
pub mod triggers;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

#[derive(Debug)]
pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    /// Opens (creating if needed) the database file and applies pending migrations.
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    /// In-memory database for tests.
    pub fn open_in_memory() -> AppResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
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
