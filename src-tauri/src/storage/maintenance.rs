//! Whole-database operations (Settings › Privacy and data).

use super::Database;
use crate::error::AppResult;

/// Every table, children before parents so no foreign key blocks a delete.
/// A test checks that every table in the schema is listed here.
const DELETE_ALL_DATA_SQL: &str = "
    DELETE FROM run_events;
    DELETE FROM run_inputs;
    DELETE FROM runs;
    DELETE FROM triggers;
    DELETE FROM conversation_messages;
    DELETE FROM conversations;
    DELETE FROM chain_steps;
    DELETE FROM chains;
    DELETE FROM knowledge_documents;
    DELETE FROM knowledge_connectors;
    DELETE FROM knowledge_sources;
    DELETE FROM knowledge_bases;
    DELETE FROM agent_release_switches;
    DELETE FROM agent_releases;
    DELETE FROM agent_checks;
    DELETE FROM agent_tests;
    DELETE FROM agent_settings;
    DELETE FROM chatbot_setup_versions;
    DELETE FROM deployments;
    DELETE FROM own_servers;
    DELETE FROM node_layouts;
    DELETE FROM canvas_notes;
    DELETE FROM canvas_viewports;
    DELETE FROM builder_messages;
    DELETE FROM agent_versions;
    DELETE FROM agents;
    DELETE FROM settings;
";

impl Database {
    /// Deletes every agent, version, run, run event, schedule, conversation,
    /// chain, knowledge base record and setting in one transaction. Tables are emptied children first, so this does not
    /// depend on `ON DELETE CASCADE`.
    ///
    /// @throws AppError::Database - when a table cannot be emptied (nothing is deleted then)
    pub fn delete_all_data(&self) -> AppResult<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(DELETE_ALL_DATA_SQL)?;
        transaction.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_in_the_schema_is_emptied() {
        let db = Database::open_in_memory().unwrap();
        let connection = db.lock().unwrap();
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .unwrap();
        let table_names: Vec<String> = statement.query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert!(!table_names.is_empty());
        for table_name in table_names {
            assert!(
                DELETE_ALL_DATA_SQL.contains(&format!("DELETE FROM {table_name};")),
                "delete_all_data does not empty `{table_name}`; add it to DELETE_ALL_DATA_SQL"
            );
        }
    }

    #[test]
    fn delete_all_data_runs_against_the_full_schema() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting("default_model_name", "gpt-4o-mini").unwrap();
        db.delete_all_data().unwrap();
        assert_eq!(db.get_setting("default_model_name").unwrap(), None);
    }
}
