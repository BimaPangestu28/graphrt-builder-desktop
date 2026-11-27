//! Per-agent settings stored as JSON, removed with their agent (`ON DELETE CASCADE`).
//!
//! Keys are owned by the feature that writes them, e.g. `chatbot_setup`
//! (`crate::chatbot_setup`) and `team_guardrails` (`crate::teams`).

use rusqlite::{params, OptionalExtension};

use super::agents::ensure_agent_exists;
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

impl Database {
    /// The JSON stored under `key` for the agent, or `None` when never saved.
    ///
    /// # Errors
    /// `InvalidInput` for a blank key; `Serialization` when the stored text is not JSON.
    pub fn get_agent_setting(&self, agent_id: &str, key: &str) -> AppResult<Option<serde_json::Value>> {
        validate_key(key)?;
        let connection = self.lock()?;
        let stored: Option<String> = connection
            .query_row(
                "SELECT value_json FROM agent_settings WHERE agent_id = ?1 AND key = ?2",
                params![agent_id, key],
                |row| row.get(0),
            )
            .optional()?;
        stored.map(|text| serde_json::from_str(&text).map_err(AppError::from)).transpose()
    }

    /// Inserts or replaces the JSON stored under `key` for the agent.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` for a blank key.
    pub fn set_agent_setting(&self, agent_id: &str, key: &str, value: &serde_json::Value) -> AppResult<()> {
        validate_key(key)?;
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        connection.execute(
            "INSERT INTO agent_settings (agent_id, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (agent_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![agent_id, key, serde_json::to_string(value)?, now_rfc3339()],
        )?;
        Ok(())
    }

    /// Removes what is stored under `key` for the agent; succeeds when nothing was.
    ///
    /// # Errors
    /// `InvalidInput` for a blank key.
    pub fn delete_agent_setting(&self, agent_id: &str, key: &str) -> AppResult<()> {
        validate_key(key)?;
        let connection = self.lock()?;
        connection.execute("DELETE FROM agent_settings WHERE agent_id = ?1 AND key = ?2", params![agent_id, key])?;
        Ok(())
    }

    /// The agents that have something stored under `key`, oldest setting first.
    ///
    /// # Errors
    /// `InvalidInput` for a blank key.
    pub fn agents_with_setting(&self, key: &str) -> AppResult<Vec<String>> {
        validate_key(key)?;
        let connection = self.lock()?;
        let mut statement =
            connection.prepare("SELECT agent_id FROM agent_settings WHERE key = ?1 ORDER BY updated_at ASC")?;
        let agents = statement.query_map([key], |row| row.get(0))?.collect::<Result<Vec<String>, _>>()?;
        Ok(agents)
    }
}

fn validate_key(key: &str) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::InvalidInput("agent setting key must not be empty".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    #[test]
    fn stores_replaces_and_cascades_with_the_agent() {
        let database = test_database();
        let agent = create_test_agent(&database, "Bot");
        assert_eq!(database.get_agent_setting(&agent.id, "chatbot_setup").unwrap(), None);
        database.set_agent_setting(&agent.id, "chatbot_setup", &json!({"tone": "Formal"})).unwrap();
        database.set_agent_setting(&agent.id, "chatbot_setup", &json!({"tone": "Casual"})).unwrap();
        assert_eq!(database.get_agent_setting(&agent.id, "chatbot_setup").unwrap(), Some(json!({"tone": "Casual"})));

        database.delete_agent(&agent.id).unwrap();
        assert_eq!(database.get_agent_setting(&agent.id, "chatbot_setup").unwrap(), None);
    }

    #[test]
    fn rejects_unknown_agents_and_blank_keys() {
        let database = test_database();
        assert!(matches!(database.set_agent_setting("ghost", "k", &json!(1)), Err(AppError::NotFound(_))));
        let agent = create_test_agent(&database, "Bot");
        assert!(matches!(database.set_agent_setting(&agent.id, " ", &json!(1)), Err(AppError::InvalidInput(_))));
    }
}
