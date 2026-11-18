//! Team guardrails: what the owner limits, and what the team's flow promises.
//!
//! Stored: `max_agent_calls_per_run` (agent setting [`GUARDRAILS_KEY`]), enforced
//! by the `agents` tool provider (`engine::agent_tools`), which counts every
//! member call of one run segment, nested calls included, and answers calls
//! beyond the limit with an error result the coordinator can read.
//!
//! Derived: whether the flow asks before sending anything out
//! (`flow::find_unapproved_sending_steps`). Nothing else is shown, because
//! nothing else is enforced.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::Database;

/// `agent_settings` key of the stored guardrails.
pub const GUARDRAILS_KEY: &str = "team_guardrails";
/// Highest limit the owner can set.
pub const MAX_AGENT_CALLS_LIMIT: u32 = 100;

/// Guardrails the owner sets.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StoredGuardrails {
    /// Most member-agent calls in one run; `None` means no limit beyond the
    /// coordinator's own step limits.
    pub max_agent_calls_per_run: Option<u32>,
}

/// The guardrails panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamGuardrails {
    pub agent_id: String,
    pub max_agent_calls_per_run: Option<u32>,
    /// Titles of steps that send data out without asking first (empty = always asks).
    pub unapproved_sending_steps: Vec<String>,
}

/// The stored limit of `agent_id`; `None` when never set or unreadable.
pub fn max_agent_calls_per_run(db: &Database, agent_id: &str) -> Option<u32> {
    match load_stored(db, agent_id) {
        Ok(stored) => stored.max_agent_calls_per_run,
        Err(error) => {
            log::warn!("could not read the guardrails of agent {agent_id}: {error}");
            None
        }
    }
}

/// # Errors
/// `NotFound` for an unknown agent; `Workflow` when its flow does not compile.
pub fn get_team_guardrails(db: &Database, agent_id: &str) -> AppResult<TeamGuardrails> {
    let agent = db.get_agent(agent_id)?;
    let stored = load_stored(db, agent_id)?;
    Ok(TeamGuardrails {
        agent_id: agent.id,
        max_agent_calls_per_run: stored.max_agent_calls_per_run,
        unapproved_sending_steps: flow::find_unapproved_sending_steps(&agent.flow_yaml)?,
    })
}

/// Sets (or clears, with `None`) the most member calls per run.
///
/// # Errors
/// `InvalidInput` for 0 or more than [`MAX_AGENT_CALLS_LIMIT`]; `NotFound` for an unknown agent.
pub fn set_max_agent_calls_per_run(db: &Database, agent_id: &str, limit: Option<u32>) -> AppResult<TeamGuardrails> {
    if let Some(limit) = limit {
        if limit == 0 || limit > MAX_AGENT_CALLS_LIMIT {
            return Err(AppError::InvalidInput(format!(
                "the limit must be between 1 and {MAX_AGENT_CALLS_LIMIT} agent calls"
            )));
        }
    }
    let stored = StoredGuardrails { max_agent_calls_per_run: limit };
    db.set_agent_setting(agent_id, GUARDRAILS_KEY, &serde_json::to_value(stored)?)?;
    get_team_guardrails(db, agent_id)
}

fn load_stored(db: &Database, agent_id: &str) -> AppResult<StoredGuardrails> {
    match db.get_agent_setting(agent_id, GUARDRAILS_KEY)? {
        Some(stored) => Ok(serde_json::from_value(stored)?),
        None => Ok(StoredGuardrails::default()),
    }
}
