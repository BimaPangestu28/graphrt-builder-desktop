//! Schedule commands. Besides saving triggers, these keep the agent's status in
//! step with its schedules: an agent with an enabled trigger is `Active`, and an
//! `Active` agent whose last enabled trigger goes away is `Paused`.

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::scheduler;
use crate::state::AppState;
use crate::storage::models::{AgentStatus, NewTrigger, Trigger};
use crate::storage::Database;

fn next_fire_from_now(cron_expression: &str, timezone: &str) -> AppResult<Option<String>> {
    scheduler::next_fire_after(cron_expression, timezone, chrono::Utc::now())
}

/// Marks a not-yet-scheduled agent `Active` because it now has an enabled trigger.
fn activate_scheduled_agent(db: &Database, agent_id: &str) -> AppResult<()> {
    let agent = db.get_agent(agent_id)?;
    if matches!(agent.status, AgentStatus::Draft | AgentStatus::Tested | AgentStatus::Paused) {
        db.set_agent_status(agent_id, AgentStatus::Active)?;
    }
    Ok(())
}

/// Marks an `Active` agent `Paused` when none of its triggers is enabled any more.
fn pause_agent_without_schedules(db: &Database, agent_id: &str) -> AppResult<()> {
    let has_enabled_trigger = db.list_triggers(Some(agent_id))?.iter().any(|trigger| trigger.enabled);
    if has_enabled_trigger {
        return Ok(());
    }
    let agent = db.get_agent(agent_id)?;
    if agent.status == AgentStatus::Active {
        db.set_agent_status(agent_id, AgentStatus::Paused)?;
    }
    Ok(())
}

/// The trigger change is already saved, so a status sync failure is logged rather
/// than reported as a failed command (the UI would otherwise retry a saved change).
fn log_status_sync_failure(result: AppResult<()>, agent_id: &str) {
    if let Err(error) = result {
        log::warn!("could not update the status of agent {agent_id} after a schedule change: {error}");
    }
}

fn create_trigger_in(db: &Database, new_trigger: NewTrigger) -> AppResult<Trigger> {
    let next_fire_at = next_fire_from_now(&new_trigger.cron_expression, &new_trigger.timezone)?;
    let trigger = db.create_trigger(new_trigger, next_fire_at.as_deref())?;
    log_status_sync_failure(activate_scheduled_agent(db, &trigger.agent_id), &trigger.agent_id);
    Ok(trigger)
}

fn update_trigger_in(db: &Database, trigger_id: &str, changes: NewTrigger) -> AppResult<Trigger> {
    let existing_trigger = db.get_trigger(trigger_id)?;
    // Validate even when disabled, so an invalid schedule is never saved.
    let next_fire_at = next_fire_from_now(&changes.cron_expression, &changes.timezone)?;
    let stored_next_fire_at = if existing_trigger.enabled { next_fire_at } else { None };
    db.update_trigger(trigger_id, changes, stored_next_fire_at.as_deref())
}

fn set_trigger_enabled_in(db: &Database, trigger_id: &str, enabled: bool) -> AppResult<Trigger> {
    let trigger = db.get_trigger(trigger_id)?;
    let next_fire_at = if enabled { next_fire_from_now(&trigger.cron_expression, &trigger.timezone)? } else { None };
    let updated_trigger = db.set_trigger_enabled(trigger_id, enabled, next_fire_at.as_deref())?;
    let status_sync = if enabled {
        activate_scheduled_agent(db, &updated_trigger.agent_id)
    } else {
        pause_agent_without_schedules(db, &updated_trigger.agent_id)
    };
    log_status_sync_failure(status_sync, &updated_trigger.agent_id);
    Ok(updated_trigger)
}

fn delete_trigger_in(db: &Database, trigger_id: &str) -> AppResult<()> {
    let trigger = db.get_trigger(trigger_id)?;
    db.delete_trigger(trigger_id)?;
    log_status_sync_failure(pause_agent_without_schedules(db, &trigger.agent_id), &trigger.agent_id);
    Ok(())
}

#[tauri::command]
pub fn list_triggers(state: State<'_, AppState>, agent_id: Option<String>) -> AppResult<Vec<Trigger>> {
    state.db.list_triggers(agent_id.as_deref())
}

#[tauri::command]
pub fn create_trigger(state: State<'_, AppState>, new_trigger: NewTrigger) -> AppResult<Trigger> {
    create_trigger_in(&state.db, new_trigger)
}

#[tauri::command]
pub fn update_trigger(state: State<'_, AppState>, trigger_id: String, changes: NewTrigger) -> AppResult<Trigger> {
    update_trigger_in(&state.db, &trigger_id, changes)
}

#[tauri::command]
pub fn set_trigger_enabled(state: State<'_, AppState>, trigger_id: String, enabled: bool) -> AppResult<Trigger> {
    set_trigger_enabled_in(&state.db, &trigger_id, enabled)
}

#[tauri::command]
pub fn delete_trigger(state: State<'_, AppState>, trigger_id: String) -> AppResult<()> {
    delete_trigger_in(&state.db, &trigger_id)
}

/// Upcoming fire times for the schedule dialog, without saving anything.
#[tauri::command]
pub fn preview_schedule(cron_expression: String, timezone: String, count: Option<usize>) -> AppResult<Vec<String>> {
    let count = count.unwrap_or(5);
    if count == 0 || count > 50 {
        return Err(AppError::InvalidInput("count must be between 1 and 50".into()));
    }
    scheduler::preview_fire_times(&cron_expression, &timezone, count)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, MissedRunPolicy, NewAgent};

    fn database_with_agent(status: AgentStatus) -> (Database, String) {
        let database = Database::open_in_memory().unwrap();
        let agent = database
            .create_agent(NewAgent {
                name: "Inbox digest".into(),
                kind: AgentKind::Task,
                description: "Summarize my inbox".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        database.set_agent_status(&agent.id, status).unwrap();
        (database, agent.id)
    }

    fn weekday_trigger(agent_id: &str) -> NewTrigger {
        NewTrigger {
            agent_id: agent_id.into(),
            cron_expression: "0 0 9 * * Mon-Fri".into(),
            timezone: "Asia/Jakarta".into(),
            missed_run_policy: MissedRunPolicy::RunOnce,
            inputs: json!({}),
        }
    }

    fn agent_status(database: &Database, agent_id: &str) -> AgentStatus {
        database.get_agent(agent_id).unwrap().status
    }

    #[test]
    fn creating_a_trigger_activates_the_agent() {
        for initial_status in [AgentStatus::Draft, AgentStatus::Tested, AgentStatus::Paused] {
            let (database, agent_id) = database_with_agent(initial_status);
            let trigger = create_trigger_in(&database, weekday_trigger(&agent_id)).unwrap();
            assert!(trigger.next_fire_at.is_some());
            assert_eq!(agent_status(&database, &agent_id), AgentStatus::Active);
        }
    }

    #[test]
    fn invalid_schedule_is_not_saved() {
        let (database, agent_id) = database_with_agent(AgentStatus::Tested);
        let mut invalid_trigger = weekday_trigger(&agent_id);
        invalid_trigger.timezone = "Nowhere/Land".into();
        assert!(matches!(create_trigger_in(&database, invalid_trigger), Err(AppError::Schedule(_))));
        assert!(database.list_triggers(None).unwrap().is_empty());
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Tested);
    }

    #[test]
    fn disabling_the_last_trigger_pauses_and_enabling_reactivates() {
        let (database, agent_id) = database_with_agent(AgentStatus::Tested);
        let first = create_trigger_in(&database, weekday_trigger(&agent_id)).unwrap();
        let second = create_trigger_in(&database, weekday_trigger(&agent_id)).unwrap();

        set_trigger_enabled_in(&database, &first.id, false).unwrap();
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Active);
        let disabled = set_trigger_enabled_in(&database, &second.id, false).unwrap();
        assert!(disabled.next_fire_at.is_none());
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Paused);

        let enabled = set_trigger_enabled_in(&database, &second.id, true).unwrap();
        assert!(enabled.next_fire_at.is_some());
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Active);
    }

    #[test]
    fn deleting_the_last_enabled_trigger_pauses_the_agent() {
        let (database, agent_id) = database_with_agent(AgentStatus::Draft);
        let trigger = create_trigger_in(&database, weekday_trigger(&agent_id)).unwrap();
        delete_trigger_in(&database, &trigger.id).unwrap();
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Paused);
    }

    #[test]
    fn updating_a_disabled_trigger_keeps_it_unplanned() {
        let (database, agent_id) = database_with_agent(AgentStatus::Tested);
        let trigger = create_trigger_in(&database, weekday_trigger(&agent_id)).unwrap();
        set_trigger_enabled_in(&database, &trigger.id, false).unwrap();
        let mut changes = weekday_trigger(&agent_id);
        changes.cron_expression = "0 30 7 * * *".into();
        let updated = update_trigger_in(&database, &trigger.id, changes).unwrap();
        assert!(updated.next_fire_at.is_none());
        assert_eq!(agent_status(&database, &agent_id), AgentStatus::Paused);
    }
}
