//! Schedule triggers. The scheduler computes `next_fire_at`; storage only persists it.

use super::models::{NewTrigger, Trigger};
use super::Database;
use crate::error::{AppError, AppResult};

fn not_implemented<T>() -> AppResult<T> {
    Err(AppError::Internal("not implemented".into()))
}

impl Database {
    /// Inserts an enabled trigger with the given `next_fire_at`.
    pub fn create_trigger(&self, _new_trigger: NewTrigger, _next_fire_at: Option<&str>) -> AppResult<Trigger> {
        not_implemented()
    }

    pub fn get_trigger(&self, _trigger_id: &str) -> AppResult<Trigger> {
        not_implemented()
    }

    /// All triggers, or only one agent's.
    pub fn list_triggers(&self, _agent_id: Option<&str>) -> AppResult<Vec<Trigger>> {
        not_implemented()
    }

    /// Replaces the editable fields and `next_fire_at`.
    pub fn update_trigger(&self, _trigger_id: &str, _changes: NewTrigger, _next_fire_at: Option<&str>) -> AppResult<Trigger> {
        not_implemented()
    }

    pub fn set_trigger_enabled(&self, _trigger_id: &str, _enabled: bool, _next_fire_at: Option<&str>) -> AppResult<Trigger> {
        not_implemented()
    }

    /// Records a fire (or a skipped missed run) and the next planned time.
    pub fn record_trigger_fired(&self, _trigger_id: &str, _fired_at: &str, _next_fire_at: Option<&str>) -> AppResult<()> {
        not_implemented()
    }

    pub fn delete_trigger(&self, _trigger_id: &str) -> AppResult<()> {
        not_implemented()
    }
}
