//! Fixtures shared by the storage unit tests.

use super::models::{Agent, AgentKind, NewAgent};
use super::Database;

pub(crate) fn test_database() -> Database {
    Database::open_in_memory().unwrap()
}

pub(crate) fn create_test_agent(database: &Database, name: &str) -> Agent {
    database
        .create_agent(NewAgent {
            name: name.into(),
            kind: AgentKind::Task,
            description: "Summarize my inbox".into(),
            flow_yaml: "nodes: []".into(),
        })
        .unwrap()
}
