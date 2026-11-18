//! Schedule triggers. The scheduler computes `next_fire_at`; storage only persists it.
//!
//! Storage does not parse cron expressions or time zones (that is the
//! scheduler's job); it only rejects values that are blank or structurally
//! wrong, so a corrupt row can never reach the scheduler loop.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::agents::ensure_agent_exists;
use super::codec::{json_column, json_to_text};
use super::models::{NewTrigger, Trigger};
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

const TRIGGER_COLUMNS: &str = "id, agent_id, cron_expression, timezone, enabled, missed_run_policy, \
     inputs_json, last_fired_at, next_fire_at, created_at";

impl Database {
    /// Inserts an enabled trigger with the given `next_fire_at`.
    pub fn create_trigger(&self, new_trigger: NewTrigger, next_fire_at: Option<&str>) -> AppResult<Trigger> {
        validate_trigger_fields(&new_trigger)?;
        let trigger = Trigger {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: new_trigger.agent_id,
            cron_expression: new_trigger.cron_expression.trim().to_string(),
            timezone: new_trigger.timezone.trim().to_string(),
            enabled: true,
            missed_run_policy: new_trigger.missed_run_policy,
            inputs: new_trigger.inputs,
            last_fired_at: None,
            next_fire_at: next_fire_at.map(str::to_string),
            created_at: now_rfc3339(),
        };
        let connection = self.lock()?;
        ensure_agent_exists(&connection, &trigger.agent_id)?;
        connection.execute(
            &format!("INSERT INTO triggers ({TRIGGER_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
            params![
                trigger.id,
                trigger.agent_id,
                trigger.cron_expression,
                trigger.timezone,
                trigger.enabled,
                trigger.missed_run_policy,
                json_to_text(&trigger.inputs),
                trigger.last_fired_at,
                trigger.next_fire_at,
                trigger.created_at,
            ],
        )?;
        Ok(trigger)
    }

    pub fn get_trigger(&self, trigger_id: &str) -> AppResult<Trigger> {
        let connection = self.lock()?;
        fetch_trigger(&connection, trigger_id)
    }

    /// All triggers, or only one agent's.
    pub fn list_triggers(&self, agent_id: Option<&str>) -> AppResult<Vec<Trigger>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "SELECT {TRIGGER_COLUMNS} FROM triggers
             WHERE (?1 IS NULL OR agent_id = ?1)
             ORDER BY created_at ASC, rowid ASC"
        ))?;
        let triggers = statement.query_map([agent_id], map_trigger_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(triggers)
    }

    /// Replaces the editable fields and `next_fire_at`.
    ///
    /// The owning agent is not editable: moving a schedule between agents is
    /// not a UI action, so a differing `agent_id` is rejected rather than applied.
    pub fn update_trigger(
        &self,
        trigger_id: &str,
        changes: NewTrigger,
        next_fire_at: Option<&str>,
    ) -> AppResult<Trigger> {
        validate_trigger_fields(&changes)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let existing_trigger = fetch_trigger(&transaction, trigger_id)?;
        if existing_trigger.agent_id != changes.agent_id {
            return Err(AppError::InvalidInput(format!(
                "trigger {trigger_id} belongs to agent {} and cannot be moved",
                existing_trigger.agent_id
            )));
        }
        transaction.execute(
            "UPDATE triggers SET cron_expression = ?1, timezone = ?2, missed_run_policy = ?3,
                 inputs_json = ?4, next_fire_at = ?5
             WHERE id = ?6",
            params![
                changes.cron_expression.trim(),
                changes.timezone.trim(),
                changes.missed_run_policy,
                json_to_text(&changes.inputs),
                next_fire_at,
                trigger_id,
            ],
        )?;
        let updated_trigger = fetch_trigger(&transaction, trigger_id)?;
        transaction.commit()?;
        Ok(updated_trigger)
    }

    pub fn set_trigger_enabled(
        &self,
        trigger_id: &str,
        enabled: bool,
        next_fire_at: Option<&str>,
    ) -> AppResult<Trigger> {
        let connection = self.lock()?;
        let updated_rows = connection.execute(
            "UPDATE triggers SET enabled = ?1, next_fire_at = ?2 WHERE id = ?3",
            params![enabled, next_fire_at, trigger_id],
        )?;
        if updated_rows == 0 {
            return Err(trigger_not_found(trigger_id));
        }
        fetch_trigger(&connection, trigger_id)
    }

    /// Records a fire (or a skipped missed run) and the next planned time.
    pub fn record_trigger_fired(&self, trigger_id: &str, fired_at: &str, next_fire_at: Option<&str>) -> AppResult<()> {
        let connection = self.lock()?;
        let updated_rows = connection.execute(
            "UPDATE triggers SET last_fired_at = ?1, next_fire_at = ?2 WHERE id = ?3",
            params![fired_at, next_fire_at, trigger_id],
        )?;
        if updated_rows == 0 {
            return Err(trigger_not_found(trigger_id));
        }
        Ok(())
    }

    pub fn delete_trigger(&self, trigger_id: &str) -> AppResult<()> {
        let connection = self.lock()?;
        let deleted_rows = connection.execute("DELETE FROM triggers WHERE id = ?1", [trigger_id])?;
        if deleted_rows == 0 {
            return Err(trigger_not_found(trigger_id));
        }
        Ok(())
    }
}

fn trigger_not_found(trigger_id: &str) -> AppError {
    AppError::NotFound(format!("trigger {trigger_id}"))
}

fn fetch_trigger(connection: &Connection, trigger_id: &str) -> AppResult<Trigger> {
    connection
        .query_row(&format!("SELECT {TRIGGER_COLUMNS} FROM triggers WHERE id = ?1"), [trigger_id], map_trigger_row)
        .optional()?
        .ok_or_else(|| trigger_not_found(trigger_id))
}

fn validate_trigger_fields(new_trigger: &NewTrigger) -> AppResult<()> {
    if new_trigger.cron_expression.trim().is_empty() {
        return Err(AppError::InvalidInput("cron expression must not be empty".into()));
    }
    if new_trigger.timezone.trim().is_empty() {
        return Err(AppError::InvalidInput("time zone must not be empty".into()));
    }
    // Workflow inputs are always a JSON object; anything else would fail every scheduled run.
    if !new_trigger.inputs.is_object() {
        return Err(AppError::InvalidInput("schedule inputs must be a JSON object".into()));
    }
    Ok(())
}

fn map_trigger_row(row: &Row<'_>) -> rusqlite::Result<Trigger> {
    Ok(Trigger {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        cron_expression: row.get("cron_expression")?,
        timezone: row.get("timezone")?,
        enabled: row.get("enabled")?,
        missed_run_policy: row.get("missed_run_policy")?,
        inputs: json_column(row, "inputs_json")?,
        last_fired_at: row.get("last_fired_at")?,
        next_fire_at: row.get("next_fire_at")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::MissedRunPolicy;
    use crate::storage::test_support::{create_test_agent, test_database};

    const NEXT_FIRE: &str = "2026-11-19T09:00:00+00:00";

    fn weekday_trigger(agent_id: &str) -> NewTrigger {
        NewTrigger {
            agent_id: agent_id.into(),
            cron_expression: "0 0 9 * * Mon-Fri".into(),
            timezone: "Asia/Jakarta".into(),
            missed_run_policy: MissedRunPolicy::RunOnce,
            inputs: json!({"folder": "inbox"}),
        }
    }

    #[test]
    fn create_trigger_is_enabled_and_round_trips() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), Some(NEXT_FIRE)).unwrap();
        assert!(trigger.enabled);
        assert_eq!(trigger.next_fire_at.as_deref(), Some(NEXT_FIRE));
        assert!(trigger.last_fired_at.is_none());
        assert_eq!(trigger.inputs, json!({"folder": "inbox"}));
        assert_eq!(database.get_trigger(&trigger.id).unwrap(), trigger);
    }

    #[test]
    fn create_trigger_validates_input_and_agent() {
        let database = test_database();
        assert!(matches!(database.create_trigger(weekday_trigger("ghost"), None), Err(AppError::NotFound(_))));
        let agent = create_test_agent(&database, "Scheduled");
        let mut blank_cron = weekday_trigger(&agent.id);
        blank_cron.cron_expression = "  ".into();
        assert!(matches!(database.create_trigger(blank_cron, None), Err(AppError::InvalidInput(_))));
        let mut blank_zone = weekday_trigger(&agent.id);
        blank_zone.timezone = String::new();
        assert!(matches!(database.create_trigger(blank_zone, None), Err(AppError::InvalidInput(_))));
        let mut array_inputs = weekday_trigger(&agent.id);
        array_inputs.inputs = json!([1, 2]);
        assert!(matches!(database.create_trigger(array_inputs, None), Err(AppError::InvalidInput(_))));
        assert!(database.list_triggers(None).unwrap().is_empty());
    }

    #[test]
    fn list_triggers_filters_by_agent() {
        let database = test_database();
        let first_agent = create_test_agent(&database, "One");
        let second_agent = create_test_agent(&database, "Two");
        let first = database.create_trigger(weekday_trigger(&first_agent.id), None).unwrap();
        let second = database.create_trigger(weekday_trigger(&second_agent.id), None).unwrap();
        let third = database.create_trigger(weekday_trigger(&first_agent.id), None).unwrap();

        let all_ids: Vec<String> =
            database.list_triggers(None).unwrap().into_iter().map(|trigger| trigger.id).collect();
        assert_eq!(all_ids, [first.id.clone(), second.id, third.id.clone()]);
        let first_agent_ids: Vec<String> =
            database.list_triggers(Some(&first_agent.id)).unwrap().into_iter().map(|trigger| trigger.id).collect();
        assert_eq!(first_agent_ids, [first.id, third.id]);
        assert!(database.list_triggers(Some("ghost")).unwrap().is_empty());
    }

    #[test]
    fn update_trigger_replaces_editable_fields() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), Some(NEXT_FIRE)).unwrap();
        let changes = NewTrigger {
            agent_id: agent.id.clone(),
            cron_expression: "0 30 7 * * *".into(),
            timezone: "UTC".into(),
            missed_run_policy: MissedRunPolicy::Skip,
            inputs: json!({}),
        };
        let updated = database.update_trigger(&trigger.id, changes, None).unwrap();
        assert_eq!(updated.cron_expression, "0 30 7 * * *");
        assert_eq!(updated.timezone, "UTC");
        assert_eq!(updated.missed_run_policy, MissedRunPolicy::Skip);
        assert_eq!(updated.inputs, json!({}));
        assert!(updated.next_fire_at.is_none());
        assert_eq!(updated.created_at, trigger.created_at);
        assert!(updated.enabled);
    }

    #[test]
    fn update_trigger_rejects_moving_to_another_agent() {
        let database = test_database();
        let agent = create_test_agent(&database, "Owner");
        let other_agent = create_test_agent(&database, "Other");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), None).unwrap();
        assert!(matches!(
            database.update_trigger(&trigger.id, weekday_trigger(&other_agent.id), None),
            Err(AppError::InvalidInput(_))
        ));
        assert_eq!(database.get_trigger(&trigger.id).unwrap().agent_id, agent.id);
    }

    #[test]
    fn disable_and_reenable_trigger() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), Some(NEXT_FIRE)).unwrap();

        let disabled = database.set_trigger_enabled(&trigger.id, false, None).unwrap();
        assert!(!disabled.enabled);
        assert!(disabled.next_fire_at.is_none());

        let enabled = database.set_trigger_enabled(&trigger.id, true, Some(NEXT_FIRE)).unwrap();
        assert!(enabled.enabled);
        assert_eq!(enabled.next_fire_at.as_deref(), Some(NEXT_FIRE));
    }

    #[test]
    fn record_fire_updates_times() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), Some(NEXT_FIRE)).unwrap();
        let following = "2026-11-20T09:00:00+00:00";
        database.record_trigger_fired(&trigger.id, NEXT_FIRE, Some(following)).unwrap();
        let fired = database.get_trigger(&trigger.id).unwrap();
        assert_eq!(fired.last_fired_at.as_deref(), Some(NEXT_FIRE));
        assert_eq!(fired.next_fire_at.as_deref(), Some(following));
    }

    #[test]
    fn delete_trigger_then_not_found() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        let trigger = database.create_trigger(weekday_trigger(&agent.id), None).unwrap();
        database.delete_trigger(&trigger.id).unwrap();
        assert!(matches!(database.get_trigger(&trigger.id), Err(AppError::NotFound(_))));
        assert!(matches!(database.delete_trigger(&trigger.id), Err(AppError::NotFound(_))));
        // The agent is untouched.
        assert!(database.get_agent(&agent.id).is_ok());
    }

    #[test]
    fn missing_trigger_is_not_found_everywhere() {
        let database = test_database();
        let agent = create_test_agent(&database, "Scheduled");
        assert!(matches!(database.get_trigger("ghost"), Err(AppError::NotFound(_))));
        assert!(matches!(
            database.update_trigger("ghost", weekday_trigger(&agent.id), None),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(database.set_trigger_enabled("ghost", true, None), Err(AppError::NotFound(_))));
        assert!(matches!(database.record_trigger_fired("ghost", NEXT_FIRE, None), Err(AppError::NotFound(_))));
    }
}
