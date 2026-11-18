//! Agents and their version history.

use super::models::{Agent, AgentStatus, AgentVersion, NewAgent};
use super::Database;
use crate::error::{AppError, AppResult};

fn not_implemented<T>() -> AppResult<T> {
    Err(AppError::Internal("not implemented".into()))
}

impl Database {
    /// Creates an agent as version 1 with status `Draft` and records that version.
    pub fn create_agent(&self, _new_agent: NewAgent) -> AppResult<Agent> {
        not_implemented()
    }

    pub fn get_agent(&self, _agent_id: &str) -> AppResult<Agent> {
        not_implemented()
    }

    /// All agents, most recently updated first.
    pub fn list_agents(&self) -> AppResult<Vec<Agent>> {
        not_implemented()
    }

    /// Saves a new flow as the next version and makes it current.
    pub fn update_agent_flow(&self, _agent_id: &str, _flow_yaml: &str, _change_summary: &str) -> AppResult<Agent> {
        not_implemented()
    }

    pub fn rename_agent(&self, _agent_id: &str, _name: &str) -> AppResult<Agent> {
        not_implemented()
    }

    pub fn set_agent_status(&self, _agent_id: &str, _status: AgentStatus) -> AppResult<Agent> {
        not_implemented()
    }

    /// Versions of one agent, newest first.
    pub fn list_agent_versions(&self, _agent_id: &str) -> AppResult<Vec<AgentVersion>> {
        not_implemented()
    }

    /// Copies an old version's flow into a NEW version on top (history is never rewritten).
    pub fn restore_agent_version(&self, _agent_id: &str, _version: i64) -> AppResult<Agent> {
        not_implemented()
    }

    /// Deletes the agent with its versions, runs, events and triggers.
    pub fn delete_agent(&self, _agent_id: &str) -> AppResult<()> {
        not_implemented()
    }
}
