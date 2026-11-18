//! Schema migrations, applied in order and tracked with `PRAGMA user_version`.
//!
//! `MIGRATIONS[i]` upgrades the schema from version `i` to `i + 1`. Migrations
//! are append-only: never edit a released entry, add a new one instead.
//!
//! Column conventions: enums are their serde `snake_case` names (guarded by
//! `CHECK` constraints), JSON is TEXT, timestamps are RFC 3339 UTC TEXT (which
//! sorts chronologically as plain text), booleans are INTEGER 0/1.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

const MIGRATIONS: &[&str] = &[
    // Version 1: initial schema.
    r#"
    CREATE TABLE agents (
        id              TEXT PRIMARY KEY NOT NULL,
        name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
        kind            TEXT NOT NULL CHECK (kind IN ('task', 'chatbot', 'chain', 'team')),
        description     TEXT NOT NULL,
        flow_yaml       TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('draft', 'tested', 'active', 'paused')),
        current_version INTEGER NOT NULL CHECK (current_version >= 1),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );
    CREATE INDEX agents_by_updated_at ON agents (updated_at DESC);

    CREATE TABLE agent_versions (
        agent_id       TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        version        INTEGER NOT NULL CHECK (version >= 1),
        flow_yaml      TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (agent_id, version)
    );

    CREATE TABLE runs (
        id                 TEXT PRIMARY KEY NOT NULL,
        agent_id           TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        agent_version      INTEGER NOT NULL,
        "trigger"          TEXT NOT NULL CHECK ("trigger" IN ('test', 'manual', 'schedule')),
        status             TEXT NOT NULL
                           CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'aborted')),
        started_at         TEXT NOT NULL,
        finished_at        TEXT,
        outputs_json       TEXT,
        error_message      TEXT,
        pause_reasons_json TEXT,
        snapshot_json      TEXT
    );
    CREATE INDEX runs_by_agent_started_at ON runs (agent_id, started_at DESC);
    CREATE INDEX runs_by_status ON runs (status);
    CREATE INDEX runs_by_started_at ON runs (started_at DESC);

    CREATE TABLE run_events (
        run_id     TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL CHECK (seq >= 1),
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
    );

    CREATE TABLE triggers (
        id                TEXT PRIMARY KEY NOT NULL,
        agent_id          TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        cron_expression   TEXT NOT NULL,
        timezone          TEXT NOT NULL,
        enabled           INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        missed_run_policy TEXT NOT NULL CHECK (missed_run_policy IN ('run_once', 'skip')),
        inputs_json       TEXT NOT NULL,
        last_fired_at     TEXT,
        next_fire_at      TEXT,
        created_at        TEXT NOT NULL
    );
    CREATE INDEX triggers_by_agent ON triggers (agent_id);
    CREATE INDEX triggers_by_enabled_next_fire_at ON triggers (enabled, next_fire_at);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    );
    "#,
    // Chatbot conversations and their messages (see `conversations::store`).
    r#"
    CREATE TABLE conversations (
        id              TEXT PRIMARY KEY NOT NULL,
        agent_id        TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        channel         TEXT NOT NULL CHECK (length(trim(channel)) > 0),
        customer_name   TEXT NOT NULL,
        customer_handle TEXT NOT NULL,
        status          TEXT NOT NULL
                        CHECK (status IN ('bot_answering', 'waiting_for_you', 'you_replying', 'closed')),
        origin          TEXT,
        handoff_reason  TEXT,
        summary         TEXT,
        suggested_reply TEXT,
        variables_json  TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );
    CREATE INDEX conversations_by_updated_at ON conversations (updated_at DESC);
    CREATE INDEX conversations_by_status ON conversations (status, updated_at DESC);
    CREATE INDEX conversations_by_customer ON conversations (agent_id, channel, customer_handle);

    CREATE TABLE conversation_messages (
        id              TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
        author          TEXT NOT NULL CHECK (author IN ('customer', 'bot', 'operator', 'system')),
        text            TEXT NOT NULL,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL
    );
    CREATE INDEX conversation_messages_by_conversation ON conversation_messages (conversation_id, created_at);
    "#,
    // Chains of agents: "when agent A finishes, start agent B" (screen 11).
    r#"
    CREATE TABLE chains (
        id         TEXT PRIMARY KEY NOT NULL,
        name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
        status     TEXT NOT NULL CHECK (status IN ('active', 'paused')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE chain_steps (
        chain_id           TEXT NOT NULL REFERENCES chains (id) ON DELETE CASCADE,
        position           INTEGER NOT NULL CHECK (position >= 0),
        agent_id           TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        input_mapping_json TEXT NOT NULL,
        run_condition      TEXT NOT NULL CHECK (run_condition IN ('on_success', 'always')),
        on_failure         TEXT NOT NULL CHECK (on_failure IN ('stop', 'continue')),
        PRIMARY KEY (chain_id, position)
    );
    CREATE INDEX chain_steps_by_agent ON chain_steps (agent_id);
    "#,
];

/// Applies every migration newer than the database's `user_version`.
///
/// Each migration and its version bump commit together, so a failure leaves
/// the database at the last fully applied version.
pub fn apply(connection: &Connection) -> AppResult<()> {
    let current_version = read_schema_version(connection)?;
    let latest_version = MIGRATIONS.len();
    if current_version > latest_version {
        // A newer app wrote this file; running old code against it could corrupt data.
        return Err(AppError::Internal(format!(
            "database schema version {current_version} is newer than this app supports ({latest_version})"
        )));
    }
    for (index, migration_sql) in MIGRATIONS.iter().enumerate().skip(current_version) {
        let target_version = index + 1;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(migration_sql)?;
        transaction.pragma_update(None, "user_version", target_version)?;
        transaction.commit()?;
        log::info!("applied database migration {target_version}");
    }
    Ok(())
}

fn read_schema_version(connection: &Connection) -> AppResult<usize> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    usize::try_from(version).map_err(|_| AppError::Internal(format!("invalid database schema version {version}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_names(connection: &Connection) -> Vec<String> {
        let mut statement =
            connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").unwrap();
        statement.query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }

    #[test]
    fn creates_every_table_and_sets_version() {
        let connection = Connection::open_in_memory().unwrap();
        apply(&connection).unwrap();
        assert_eq!(
            table_names(&connection),
            [
                "agent_versions",
                "agents",
                "chain_steps",
                "chains",
                "conversation_messages",
                "conversations",
                "run_events",
                "runs",
                "settings",
                "triggers"
            ]
        );
        assert_eq!(read_schema_version(&connection).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn applying_twice_is_a_no_op() {
        let connection = Connection::open_in_memory().unwrap();
        apply(&connection).unwrap();
        apply(&connection).unwrap();
        assert_eq!(read_schema_version(&connection).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn refuses_a_newer_schema() {
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", MIGRATIONS.len() + 1).unwrap();
        assert!(matches!(apply(&connection), Err(AppError::Internal(_))));
    }

    #[test]
    fn file_database_keeps_version_across_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("graphrt.db");
        drop(crate::storage::Database::open(&path).unwrap());
        let reopened = crate::storage::Database::open(&path).unwrap();
        let connection = reopened.lock().unwrap();
        assert_eq!(read_schema_version(&connection).unwrap(), MIGRATIONS.len());
    }
}
