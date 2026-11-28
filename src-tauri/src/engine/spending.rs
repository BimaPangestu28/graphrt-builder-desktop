//! An agent's spending limit per run: the most tokens and money one run may use, its helper
//! agents included. Stored as the agent setting [`SPENDING_LIMIT_KEY`] (no new version: it is
//! a limit on runs, not part of what the agent does) and applied to every run of the agent
//! through graphrt's run budget (`Limits::max_total_tokens` / `max_cost_micros`).
//!
//! When the budget runs low an agent step gives its last answer without tools (graphrt's
//! `budget` progress event); a run that starts a model call with nothing left fails with
//! `limit_exceeded`.

use graphrt_core::engine::Limits;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// `agent_settings` key of the stored limit.
pub const SPENDING_LIMIT_KEY: &str = "spending_limit";
/// Smallest token limit: one short answer of a small model.
pub const MIN_TOKENS: u64 = 1_000;
/// Largest token limit the app accepts (beyond it, leave the limit off).
pub const MAX_TOKENS: u64 = 100_000_000;
/// Smallest money limit, in millionths of a dollar ($0.001).
pub const MIN_COST_MICROS: u64 = 1_000;
/// Largest money limit, in millionths of a dollar ($1 000).
pub const MAX_COST_MICROS: u64 = 1_000_000_000;

/// The limit the owner set; both parts are optional (`None` is no limit).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SpendingLimit {
    pub max_total_tokens: Option<u64>,
    /// In millionths of a dollar (the prices of `engine::prices` are in dollars).
    pub max_cost_micros: Option<u64>,
}

impl SpendingLimit {
    /// # Errors
    /// `InvalidInput` naming the part outside its range.
    pub fn validate(&self) -> AppResult<()> {
        if let Some(tokens) = self.max_total_tokens {
            if !(MIN_TOKENS..=MAX_TOKENS).contains(&tokens) {
                return Err(AppError::InvalidInput(format!(
                    "the token limit must be between {MIN_TOKENS} and {MAX_TOKENS}, got {tokens}"
                )));
            }
        }
        if let Some(cost) = self.max_cost_micros {
            if !(MIN_COST_MICROS..=MAX_COST_MICROS).contains(&cost) {
                return Err(AppError::InvalidInput(
                    "the money limit must be between $0.001 and $1000 per run".to_owned(),
                ));
            }
        }
        Ok(())
    }

    /// `limits` with this limit applied: the lower of both wins.
    pub fn apply_to(self, mut limits: Limits) -> Limits {
        limits.max_total_tokens = lowest(limits.max_total_tokens, self.max_total_tokens);
        limits.max_cost_micros = lowest(limits.max_cost_micros, self.max_cost_micros);
        limits
    }
}

fn lowest(first: Option<u64>, second: Option<u64>) -> Option<u64> {
    match (first, second) {
        (Some(first), Some(second)) => Some(first.min(second)),
        (first, second) => first.or(second),
    }
}

/// The stored limit of `agent_id`.
///
/// # Errors
/// `Database` / `Serialization` when the setting cannot be read.
pub fn load(db: &Database, agent_id: &str) -> AppResult<SpendingLimit> {
    match db.get_agent_setting(agent_id, SPENDING_LIMIT_KEY)? {
        Some(stored) => Ok(serde_json::from_value(stored)?),
        None => Ok(SpendingLimit::default()),
    }
}

/// The limit runs of `agent_id` get. A setting that cannot be read refuses the run: the
/// owner set a limit, and running without it could spend more than they allowed.
///
/// # Errors
/// `Internal` naming the setting when it cannot be read.
pub(crate) fn load_for_run(db: &Database, agent_id: &str) -> AppResult<SpendingLimit> {
    load(db, agent_id).map_err(|error| {
        log::error!("could not read the spending limit of agent {agent_id}: {error}");
        AppError::Internal(
            "the spending limit of this agent could not be read: set it again in the agent's abilities".to_owned(),
        )
    })
}

/// Stores (or clears, when both parts are `None`) the limit.
///
/// # Errors
/// `InvalidInput` for a part outside its range; `NotFound` for an unknown agent.
pub fn save(db: &Database, agent_id: &str, limit: SpendingLimit) -> AppResult<SpendingLimit> {
    limit.validate()?;
    db.get_agent(agent_id)?;
    if limit == SpendingLimit::default() {
        db.delete_agent_setting(agent_id, SPENDING_LIMIT_KEY)?;
    } else {
        db.set_agent_setting(agent_id, SPENDING_LIMIT_KEY, &serde_json::to_value(limit)?)?;
    }
    Ok(limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    fn agent(db: &Database) -> String {
        let flow_yaml = include_str!("../../fixtures/flows/simple_answer.yaml").to_owned();
        let new_agent =
            NewAgent { name: "Support".into(), kind: AgentKind::Task, description: String::new(), flow_yaml };
        db.create_agent(new_agent).unwrap().id
    }

    #[test]
    fn a_saved_limit_round_trips_and_clearing_it_removes_the_setting() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = agent(&db);
        assert_eq!(load(&db, &agent_id).unwrap(), SpendingLimit::default());

        let limit = SpendingLimit { max_total_tokens: Some(20_000), max_cost_micros: Some(50_000) };
        save(&db, &agent_id, limit).unwrap();
        assert_eq!(load(&db, &agent_id).unwrap(), limit);

        save(&db, &agent_id, SpendingLimit::default()).unwrap();
        assert_eq!(db.get_agent_setting(&agent_id, SPENDING_LIMIT_KEY).unwrap(), None);
    }

    #[test]
    fn limits_outside_the_range_are_refused() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = agent(&db);
        let too_few = SpendingLimit { max_total_tokens: Some(10), max_cost_micros: None };
        assert!(
            matches!(save(&db, &agent_id, too_few), Err(AppError::InvalidInput(message)) if message.contains("token"))
        );
        let too_much = SpendingLimit { max_total_tokens: None, max_cost_micros: Some(MAX_COST_MICROS + 1) };
        assert!(
            matches!(save(&db, &agent_id, too_much), Err(AppError::InvalidInput(message)) if message.contains("money"))
        );
        assert!(matches!(save(&db, "nobody", SpendingLimit::default()), Err(AppError::NotFound(_))));
    }

    #[test]
    fn the_lower_limit_wins_and_a_missing_one_keeps_the_other() {
        let limits = Limits { max_total_tokens: Some(50_000), ..Limits::default() };
        let applied =
            SpendingLimit { max_total_tokens: Some(20_000), max_cost_micros: Some(9_000) }.apply_to(limits.clone());
        assert_eq!((applied.max_total_tokens, applied.max_cost_micros), (Some(20_000), Some(9_000)));
        let higher = SpendingLimit { max_total_tokens: Some(90_000), max_cost_micros: None }.apply_to(limits);
        assert_eq!((higher.max_total_tokens, higher.max_cost_micros), (Some(50_000), None));
    }

    #[test]
    fn an_unreadable_setting_refuses_the_run_instead_of_running_without_a_limit() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = agent(&db);
        db.set_agent_setting(&agent_id, SPENDING_LIMIT_KEY, &serde_json::json!("lots")).unwrap();
        assert!(
            matches!(load_for_run(&db, &agent_id), Err(AppError::Internal(message)) if message.contains("spending limit"))
        );
    }
}
