//! Agents and their version history.
//!
//! Every flow change appends a row to `agent_versions` and bumps
//! `agents.current_version` in the same transaction, so the agent row always
//! mirrors its newest version and history is never rewritten.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::models::{Agent, AgentStatus, AgentVersion, NewAgent};
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

const AGENT_COLUMNS: &str = "id, name, kind, description, flow_yaml, status, current_version, created_at, updated_at";

impl Database {
    /// Creates an agent as version 1 with status `Draft` and records that version.
    pub fn create_agent(&self, new_agent: NewAgent) -> AppResult<Agent> {
        let name = validated_name(&new_agent.name)?;
        validate_flow(&new_agent.flow_yaml)?;
        let now = now_rfc3339();
        let agent = Agent {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            kind: new_agent.kind,
            description: new_agent.description,
            flow_yaml: new_agent.flow_yaml,
            status: AgentStatus::Draft,
            current_version: 1,
            created_at: now.clone(),
            updated_at: now,
        };
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            &format!("INSERT INTO agents ({AGENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"),
            params![
                agent.id,
                agent.name,
                agent.kind,
                agent.description,
                agent.flow_yaml,
                agent.status,
                agent.current_version,
                agent.created_at,
                agent.updated_at,
            ],
        )?;
        insert_version(&transaction, &agent.id, 1, &agent.flow_yaml, "Created", &agent.created_at)?;
        transaction.commit()?;
        Ok(agent)
    }

    pub fn get_agent(&self, agent_id: &str) -> AppResult<Agent> {
        let connection = self.lock()?;
        fetch_agent(&connection, agent_id)
    }

    /// All agents, most recently updated first.
    pub fn list_agents(&self) -> AppResult<Vec<Agent>> {
        let connection = self.lock()?;
        // rowid breaks ties between agents touched within the same timestamp.
        let mut statement =
            connection.prepare(&format!("SELECT {AGENT_COLUMNS} FROM agents ORDER BY updated_at DESC, rowid DESC"))?;
        let agents = statement.query_map([], map_agent_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Saves a new flow as the next version and makes it current.
    pub fn update_agent_flow(&self, agent_id: &str, flow_yaml: &str, change_summary: &str) -> AppResult<Agent> {
        validate_flow(flow_yaml)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let agent = fetch_agent(&transaction, agent_id)?;
        append_version(&transaction, &agent, flow_yaml, change_summary)?;
        let updated_agent = fetch_agent(&transaction, agent_id)?;
        transaction.commit()?;
        Ok(updated_agent)
    }

    pub fn rename_agent(&self, agent_id: &str, name: &str) -> AppResult<Agent> {
        let name = validated_name(name)?;
        let connection = self.lock()?;
        update_agent_column(&connection, agent_id, "name", &name)?;
        fetch_agent(&connection, agent_id)
    }

    pub fn set_agent_status(&self, agent_id: &str, status: AgentStatus) -> AppResult<Agent> {
        let connection = self.lock()?;
        update_agent_column(&connection, agent_id, "status", &status)?;
        fetch_agent(&connection, agent_id)
    }

    /// Versions of one agent, newest first.
    pub fn list_agent_versions(&self, agent_id: &str) -> AppResult<Vec<AgentVersion>> {
        let connection = self.lock()?;
        // Distinguish "unknown agent" from "agent with no versions" for the caller.
        ensure_agent_exists(&connection, agent_id)?;
        let mut statement = connection.prepare(
            "SELECT agent_id, version, flow_yaml, change_summary, created_at
             FROM agent_versions WHERE agent_id = ?1 ORDER BY version DESC",
        )?;
        let versions = statement.query_map([agent_id], map_version_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(versions)
    }

    /// Copies an old version's flow into a NEW version on top (history is never rewritten).
    pub fn restore_agent_version(&self, agent_id: &str, version: i64) -> AppResult<Agent> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let agent = fetch_agent(&transaction, agent_id)?;
        let restored_flow: String = transaction
            .query_row(
                "SELECT flow_yaml FROM agent_versions WHERE agent_id = ?1 AND version = ?2",
                params![agent_id, version],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("version {version} of agent {agent_id}")))?;
        let change_summary = format!("Restored version {version}");
        append_version(&transaction, &agent, &restored_flow, &change_summary)?;
        let updated_agent = fetch_agent(&transaction, agent_id)?;
        transaction.commit()?;
        Ok(updated_agent)
    }

    /// Deletes the agent with its versions, runs, events and triggers.
    pub fn delete_agent(&self, agent_id: &str) -> AppResult<()> {
        let connection = self.lock()?;
        // Dependent rows go through ON DELETE CASCADE (foreign_keys is ON for every connection).
        let deleted_rows = connection.execute("DELETE FROM agents WHERE id = ?1", [agent_id])?;
        if deleted_rows == 0 {
            return Err(agent_not_found(agent_id));
        }
        Ok(())
    }
}

/// Loads one agent, or `NotFound`. Shared with other storage modules that need
/// to check an agent exists inside their own transaction.
pub(super) fn fetch_agent(connection: &Connection, agent_id: &str) -> AppResult<Agent> {
    connection
        .query_row(&format!("SELECT {AGENT_COLUMNS} FROM agents WHERE id = ?1"), [agent_id], map_agent_row)
        .optional()?
        .ok_or_else(|| agent_not_found(agent_id))
}

pub(super) fn ensure_agent_exists(connection: &Connection, agent_id: &str) -> AppResult<()> {
    let exists: bool =
        connection.query_row("SELECT EXISTS (SELECT 1 FROM agents WHERE id = ?1)", [agent_id], |row| row.get(0))?;
    if exists {
        Ok(())
    } else {
        Err(agent_not_found(agent_id))
    }
}

fn agent_not_found(agent_id: &str) -> AppError {
    AppError::NotFound(format!("agent {agent_id}"))
}

/// Updates one column plus `updated_at`. `column_name` is always a literal from
/// this file, never user input, so formatting it into the SQL is safe.
fn update_agent_column(
    connection: &Connection,
    agent_id: &str,
    column_name: &str,
    value: &dyn rusqlite::ToSql,
) -> AppResult<()> {
    let updated_rows = connection.execute(
        &format!("UPDATE agents SET {column_name} = ?1, updated_at = ?2 WHERE id = ?3"),
        params![value, now_rfc3339(), agent_id],
    )?;
    if updated_rows == 0 {
        return Err(agent_not_found(agent_id));
    }
    Ok(())
}

/// Records `flow_yaml` as `agent.current_version + 1` and makes it current.
/// Must run inside the caller's transaction.
fn append_version(connection: &Connection, agent: &Agent, flow_yaml: &str, change_summary: &str) -> AppResult<()> {
    let next_version = agent.current_version + 1;
    let now = now_rfc3339();
    insert_version(connection, &agent.id, next_version, flow_yaml, change_summary, &now)?;
    connection.execute(
        "UPDATE agents SET flow_yaml = ?1, current_version = ?2, updated_at = ?3 WHERE id = ?4",
        params![flow_yaml, next_version, now, agent.id],
    )?;
    Ok(())
}

fn insert_version(
    connection: &Connection,
    agent_id: &str,
    version: i64,
    flow_yaml: &str,
    change_summary: &str,
    created_at: &str,
) -> AppResult<()> {
    connection.execute(
        "INSERT INTO agent_versions (agent_id, version, flow_yaml, change_summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![agent_id, version, flow_yaml, change_summary, created_at],
    )?;
    Ok(())
}

/// Trims surrounding whitespace and rejects empty names.
fn validated_name(name: &str) -> AppResult<String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::InvalidInput("agent name must not be empty".into()));
    }
    Ok(trimmed_name.to_string())
}

fn validate_flow(flow_yaml: &str) -> AppResult<()> {
    if flow_yaml.trim().is_empty() {
        return Err(AppError::InvalidInput("agent flow must not be empty".into()));
    }
    Ok(())
}

fn map_agent_row(row: &Row<'_>) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: row.get("kind")?,
        description: row.get("description")?,
        flow_yaml: row.get("flow_yaml")?,
        status: row.get("status")?,
        current_version: row.get("current_version")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_version_row(row: &Row<'_>) -> rusqlite::Result<AgentVersion> {
    Ok(AgentVersion {
        agent_id: row.get("agent_id")?,
        version: row.get("version")?,
        flow_yaml: row.get("flow_yaml")?,
        change_summary: row.get("change_summary")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, MissedRunPolicy, NewTrigger, RunTrigger};
    use crate::storage::test_support::{create_test_agent, test_database};

    #[test]
    fn create_agent_starts_as_draft_version_one() {
        let database = test_database();
        let agent = create_test_agent(&database, "Inbox triage");
        assert_eq!(agent.status, AgentStatus::Draft);
        assert_eq!(agent.current_version, 1);
        assert_eq!(agent.kind, AgentKind::Task);
        assert_eq!(agent.created_at, agent.updated_at);
        assert_eq!(database.get_agent(&agent.id).unwrap(), agent);

        let versions = database.list_agent_versions(&agent.id).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].version, 1);
        assert_eq!(versions[0].flow_yaml, agent.flow_yaml);
    }

    #[test]
    fn create_agent_trims_name_and_rejects_blank_input() {
        let database = test_database();
        let agent = create_test_agent(&database, "  Padded  ");
        assert_eq!(agent.name, "Padded");

        let blank_name = NewAgent {
            name: "   ".into(),
            kind: AgentKind::Chatbot,
            description: String::new(),
            flow_yaml: "nodes: []".into(),
        };
        assert!(matches!(database.create_agent(blank_name), Err(AppError::InvalidInput(_))));

        let blank_flow = NewAgent {
            name: "Named".into(),
            kind: AgentKind::Chatbot,
            description: String::new(),
            flow_yaml: " \n ".into(),
        };
        assert!(matches!(database.create_agent(blank_flow), Err(AppError::InvalidInput(_))));
        assert_eq!(database.list_agents().unwrap().len(), 1);
    }

    #[test]
    fn missing_agent_is_not_found_everywhere() {
        let database = test_database();
        let missing = "no-such-agent";
        assert!(matches!(database.get_agent(missing), Err(AppError::NotFound(_))));
        assert!(matches!(database.rename_agent(missing, "x"), Err(AppError::NotFound(_))));
        assert!(matches!(database.set_agent_status(missing, AgentStatus::Active), Err(AppError::NotFound(_))));
        assert!(matches!(database.update_agent_flow(missing, "a: b", "x"), Err(AppError::NotFound(_))));
        assert!(matches!(database.list_agent_versions(missing), Err(AppError::NotFound(_))));
        assert!(matches!(database.restore_agent_version(missing, 1), Err(AppError::NotFound(_))));
        assert!(matches!(database.delete_agent(missing), Err(AppError::NotFound(_))));
    }

    #[test]
    fn not_found_message_names_the_agent() {
        let database = test_database();
        let error = database.get_agent("abc").unwrap_err();
        assert_eq!(error.to_string(), "agent abc not found");
    }

    #[test]
    fn list_agents_is_most_recently_updated_first() {
        let database = test_database();
        let first = create_test_agent(&database, "First");
        let second = create_test_agent(&database, "Second");
        let names: Vec<String> = database.list_agents().unwrap().into_iter().map(|agent| agent.name).collect();
        assert_eq!(names, ["Second", "First"]);

        database.rename_agent(&first.id, "First renamed").unwrap();
        let ids: Vec<String> = database.list_agents().unwrap().into_iter().map(|agent| agent.id).collect();
        assert_eq!(ids, [first.id, second.id]);
    }

    #[test]
    fn update_flow_appends_versions_and_keeps_history() {
        let database = test_database();
        let agent = create_test_agent(&database, "Reporter");
        let version_two = database.update_agent_flow(&agent.id, "nodes: [a]", "Added a").unwrap();
        assert_eq!(version_two.current_version, 2);
        assert_eq!(version_two.flow_yaml, "nodes: [a]");
        assert_eq!(version_two.created_at, agent.created_at);
        let version_three = database.update_agent_flow(&agent.id, "nodes: [a, b]", "Added b").unwrap();
        assert_eq!(version_three.current_version, 3);

        let versions = database.list_agent_versions(&agent.id).unwrap();
        let numbers: Vec<i64> = versions.iter().map(|version| version.version).collect();
        assert_eq!(numbers, [3, 2, 1]);
        assert_eq!(versions[0].change_summary, "Added b");
        assert_eq!(versions[2].flow_yaml, agent.flow_yaml);
    }

    #[test]
    fn update_flow_rejects_blank_flow_without_new_version() {
        let database = test_database();
        let agent = create_test_agent(&database, "Reporter");
        assert!(matches!(database.update_agent_flow(&agent.id, "   ", "oops"), Err(AppError::InvalidInput(_))));
        assert_eq!(database.get_agent(&agent.id).unwrap().current_version, 1);
        assert_eq!(database.list_agent_versions(&agent.id).unwrap().len(), 1);
    }

    #[test]
    fn restore_creates_a_new_version_with_old_flow() {
        let database = test_database();
        let agent = create_test_agent(&database, "Restorable");
        database.update_agent_flow(&agent.id, "nodes: [changed]", "Changed").unwrap();

        let restored = database.restore_agent_version(&agent.id, 1).unwrap();
        assert_eq!(restored.current_version, 3);
        assert_eq!(restored.flow_yaml, agent.flow_yaml);

        let versions = database.list_agent_versions(&agent.id).unwrap();
        assert_eq!(versions.len(), 3);
        assert_eq!(versions[0].change_summary, "Restored version 1");
        assert_eq!(versions[0].flow_yaml, agent.flow_yaml);
        assert_eq!(versions[1].flow_yaml, "nodes: [changed]");
    }

    #[test]
    fn restore_unknown_version_is_not_found_and_changes_nothing() {
        let database = test_database();
        let agent = create_test_agent(&database, "Restorable");
        let error = database.restore_agent_version(&agent.id, 7).unwrap_err();
        assert!(matches!(error, AppError::NotFound(_)));
        assert!(error.to_string().contains("version 7"));
        assert_eq!(database.get_agent(&agent.id).unwrap().current_version, 1);
    }

    #[test]
    fn rename_and_set_status_update_timestamp() {
        let database = test_database();
        let agent = create_test_agent(&database, "Old");
        let renamed = database.rename_agent(&agent.id, " New ").unwrap();
        assert_eq!(renamed.name, "New");
        assert!(renamed.updated_at >= agent.updated_at);
        assert!(matches!(database.rename_agent(&agent.id, ""), Err(AppError::InvalidInput(_))));

        let activated = database.set_agent_status(&agent.id, AgentStatus::Active).unwrap();
        assert_eq!(activated.status, AgentStatus::Active);
        assert_eq!(database.get_agent(&agent.id).unwrap().status, AgentStatus::Active);
        // Status changes are not flow changes.
        assert_eq!(activated.current_version, 1);
    }

    #[test]
    fn delete_agent_cascades_to_versions_runs_events_and_triggers() {
        let database = test_database();
        let agent = create_test_agent(&database, "Doomed");
        let survivor = create_test_agent(&database, "Survivor");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        database.append_run_event(&run.id, &serde_json::json!({"type": "run_started"})).unwrap();
        database
            .create_trigger(
                NewTrigger {
                    agent_id: agent.id.clone(),
                    cron_expression: "0 0 9 * * *".into(),
                    timezone: "UTC".into(),
                    missed_run_policy: MissedRunPolicy::Skip,
                    inputs: serde_json::json!({}),
                },
                None,
            )
            .unwrap();
        database.insert_run(&survivor.id, 1, RunTrigger::Test).unwrap();

        database.delete_agent(&agent.id).unwrap();

        assert!(matches!(database.get_agent(&agent.id), Err(AppError::NotFound(_))));
        let connection = database.lock().unwrap();
        let count_rows = |sql: &str| -> i64 { connection.query_row(sql, [&agent.id], |row| row.get(0)).unwrap() };
        assert_eq!(count_rows("SELECT COUNT(*) FROM agent_versions WHERE agent_id = ?1"), 0);
        assert_eq!(count_rows("SELECT COUNT(*) FROM runs WHERE agent_id = ?1"), 0);
        assert_eq!(count_rows("SELECT COUNT(*) FROM triggers WHERE agent_id = ?1"), 0);
        let event_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM run_events WHERE run_id = ?1", [&run.id], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count, 0);
        let surviving_runs: i64 = connection.query_row("SELECT COUNT(*) FROM runs", [], |row| row.get(0)).unwrap();
        assert_eq!(surviving_runs, 1);
    }
}
