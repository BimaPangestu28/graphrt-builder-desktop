//! The chatbot setup (persona, hand-off rules, knowledge) of each agent version.
//!
//! Saving a setup makes a new agent version with the same workflow, so a setup change is
//! checked, released, put online and gone back to like any other change. The setup in use
//! for a version is the newest one saved at or before it; `agent_settings` keeps the latest
//! one as well, for the bot's replies on this computer (`crate::chatbot_setup`).

use rusqlite::{params, OptionalExtension};

use super::agents::{append_version, fetch_agent};
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};
use crate::storage::models::Agent;

impl Database {
    /// Saves `settings` as the chatbot setup of a new version (same workflow) and as the
    /// latest setup under `setting_key`, in one transaction.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn save_chatbot_setup_version(
        &self,
        agent_id: &str,
        setting_key: &str,
        settings: &serde_json::Value,
        change_summary: &str,
    ) -> AppResult<Agent> {
        let settings_json = serde_json::to_string(settings)?;
        let now = now_rfc3339();
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let agent = fetch_agent(&transaction, agent_id)?;
        append_version(&transaction, &agent, &agent.flow_yaml, change_summary)?;
        let updated = fetch_agent(&transaction, agent_id)?;
        transaction.execute(
            "INSERT INTO chatbot_setup_versions (agent_id, agent_version, settings_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![agent_id, updated.current_version, settings_json, now],
        )?;
        transaction.execute(
            "INSERT INTO agent_settings (agent_id, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (agent_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![agent_id, setting_key, settings_json, now],
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    /// The chatbot setup of `version`: the newest one saved at or before it, `None` when the
    /// setup was never saved by then (the bot runs its workflow unchanged).
    ///
    /// # Errors
    /// `Serialization` for a corrupt stored value.
    pub fn chatbot_setup_at_version(&self, agent_id: &str, version: i64) -> AppResult<Option<serde_json::Value>> {
        let connection = self.lock()?;
        let stored: Option<String> = connection
            .query_row(
                "SELECT settings_json FROM chatbot_setup_versions
                 WHERE agent_id = ?1 AND agent_version <= ?2 ORDER BY agent_version DESC LIMIT 1",
                params![agent_id, version],
                |row| row.get(0),
            )
            .optional()?;
        stored.map(|text| serde_json::from_str(&text).map_err(AppError::from)).transpose()
    }
}

#[cfg(test)]
mod tests {
    use crate::storage::models::{AgentKind, NewAgent};
    use crate::storage::Database;

    const FLOW: &str = "name: bot\ngraph:\n  nodes:\n    - { id: start, type: start }\n  edges: []\n";

    #[test]
    fn each_saved_setup_is_a_version_and_older_versions_keep_theirs() {
        let database = Database::open_in_memory().unwrap();
        let agent = database
            .create_agent(NewAgent {
                name: "Bakery".into(),
                kind: AgentKind::Chatbot,
                description: "Answers".into(),
                flow_yaml: FLOW.into(),
            })
            .unwrap();
        assert_eq!(database.chatbot_setup_at_version(&agent.id, 1).unwrap(), None);

        let first = serde_json::json!({ "persona": "first" });
        let saved = database.save_chatbot_setup_version(&agent.id, "chatbot_setup", &first, "Setup").unwrap();
        assert_eq!(saved.current_version, 2);
        assert_eq!(saved.flow_yaml, agent.flow_yaml, "the workflow stays the same");
        assert_eq!(database.get_agent_version(&agent.id, 2).unwrap().change_summary, "Setup");
        assert_eq!(database.get_agent_setting(&agent.id, "chatbot_setup").unwrap(), Some(first.clone()));

        database.update_agent_flow(&agent.id, FLOW, "Chat change").unwrap();
        let second = serde_json::json!({ "persona": "second" });
        database.save_chatbot_setup_version(&agent.id, "chatbot_setup", &second, "Setup").unwrap();

        assert_eq!(database.chatbot_setup_at_version(&agent.id, 1).unwrap(), None);
        assert_eq!(database.chatbot_setup_at_version(&agent.id, 2).unwrap(), Some(first.clone()));
        assert_eq!(database.chatbot_setup_at_version(&agent.id, 3).unwrap(), Some(first), "a chat change keeps it");
        assert_eq!(database.chatbot_setup_at_version(&agent.id, 4).unwrap(), Some(second.clone()));
        assert_eq!(database.get_agent_setting(&agent.id, "chatbot_setup").unwrap(), Some(second));
    }

    #[test]
    fn saving_for_an_unknown_agent_changes_nothing() {
        let database = Database::open_in_memory().unwrap();
        let setup = serde_json::json!({});
        assert!(database.save_chatbot_setup_version("missing", "chatbot_setup", &setup, "Setup").is_err());
    }
}
