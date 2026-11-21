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
    // Knowledge bases (see `knowledge::records`). Passages live in one graphrt-rag
    // SQLite file per knowledge base (`store_path`); these tables hold what the UI
    // shows and what a re-sync compares against.
    r#"
    CREATE TABLE knowledge_bases (
        id                  TEXT PRIMARY KEY NOT NULL,
        name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description         TEXT NOT NULL,
        store_path          TEXT NOT NULL,
        embedding           TEXT NOT NULL CHECK (embedding IN ('local', 'openai')),
        passages_per_answer INTEGER NOT NULL CHECK (passages_per_answer BETWEEN 1 AND 20),
        min_score           REAL NOT NULL CHECK (min_score BETWEEN 0 AND 1),
        show_sources        INTEGER NOT NULL CHECK (show_sources IN (0, 1)),
        last_synced_at      TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
    );

    CREATE TABLE knowledge_sources (
        id                TEXT PRIMARY KEY NOT NULL,
        knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases (id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('file', 'folder', 'url')),
        location          TEXT NOT NULL,
        name              TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('pending', 'reading', 'indexed', 'failed')),
        status_message    TEXT,
        document_count    INTEGER NOT NULL DEFAULT 0,
        failed_count      INTEGER NOT NULL DEFAULT 0,
        passage_count     INTEGER NOT NULL DEFAULT 0,
        last_synced_at    TEXT,
        created_at        TEXT NOT NULL,
        UNIQUE (knowledge_base_id, location)
    );
    CREATE INDEX knowledge_sources_by_base ON knowledge_sources (knowledge_base_id, created_at);

    CREATE TABLE knowledge_documents (
        source_id     TEXT NOT NULL REFERENCES knowledge_sources (id) ON DELETE CASCADE,
        document_id   TEXT NOT NULL,
        fingerprint   TEXT NOT NULL,
        passage_count INTEGER NOT NULL,
        PRIMARY KEY (source_id, document_id)
    );
    "#,
    // Per-agent settings stored as JSON (see `storage::agent_settings`): the
    // chatbot setup (persona, hand-off rules, knowledge) and team guardrails.
    r#"
    CREATE TABLE agent_settings (
        agent_id   TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        key        TEXT NOT NULL CHECK (length(trim(key)) > 0),
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, key)
    );
    "#,
    // The inputs each run started with (see `run_inputs.rs`), so the next test
    // can be prefilled and a run can be repeated with the same inputs.
    r#"
    CREATE TABLE run_inputs (
        run_id      TEXT PRIMARY KEY NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        inputs_json TEXT NOT NULL
    );
    "#,
    // The builder chat of each agent (see `builder_messages.rs`): change requests,
    // the builder's replies and failed changes, so the chat survives a restart.
    r#"
    CREATE TABLE builder_messages (
        id               TEXT PRIMARY KEY NOT NULL,
        agent_id         TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        role             TEXT NOT NULL CHECK (role IN ('user', 'builder')),
        text             TEXT NOT NULL,
        explanation      TEXT,
        status           TEXT NOT NULL CHECK (status IN ('done', 'failed')),
        version_before   INTEGER,
        version_after    INTEGER,
        changed_step_ids TEXT NOT NULL DEFAULT '[]',
        created_at       TEXT NOT NULL
    );
    CREATE INDEX builder_messages_by_agent_created_at ON builder_messages (agent_id, created_at);
    "#,
    // Node positions of the Nodes view (see `node_layouts.rs`), per agent version and
    // node id; graphrt drops positions from workflow documents, so the app keeps them.
    // Plus the canvas zoom and pan of each agent.
    r#"
    CREATE TABLE node_layouts (
        agent_id  TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        version   INTEGER NOT NULL CHECK (version >= 1),
        node_id   TEXT NOT NULL CHECK (length(node_id) > 0),
        x         REAL NOT NULL,
        y         REAL NOT NULL,
        width     REAL,
        height    REAL,
        collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
        PRIMARY KEY (agent_id, version, node_id)
    );

    CREATE TABLE canvas_viewports (
        agent_id   TEXT PRIMARY KEY NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        zoom       REAL NOT NULL CHECK (zoom > 0),
        updated_at TEXT NOT NULL
    );
    "#,
    // Sticky notes on the Nodes canvas (see `canvas_notes.rs`), per agent version;
    // graphrt drops note nodes from workflow documents, so the app keeps them.
    r#"
    CREATE TABLE canvas_notes (
        agent_id   TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        version    INTEGER NOT NULL CHECK (version >= 1),
        note_id    TEXT NOT NULL CHECK (length(note_id) > 0),
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        w          REAL NOT NULL CHECK (w > 0),
        h          REAL NOT NULL CHECK (h > 0),
        text       TEXT NOT NULL,
        color      TEXT NOT NULL,
        PRIMARY KEY (agent_id, version, note_id)
    );
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
                "agent_settings",
                "agent_versions",
                "agents",
                "builder_messages",
                "canvas_notes",
                "canvas_viewports",
                "chain_steps",
                "chains",
                "conversation_messages",
                "conversations",
                "knowledge_bases",
                "knowledge_documents",
                "knowledge_sources",
                "node_layouts",
                "run_events",
                "run_inputs",
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
