//! The "when a meeting is recorded" trigger: an agent with it turned on runs once per
//! meeting the user chose to take notes of, after the recording stops.
//!
//! Stored per agent in `agent_settings` ([`TRIGGER_SETTING_KEY`]), next to the agent's
//! schedules on the Schedule screen; no new table. The run gets the meeting as inputs
//! ([`run_inputs`]); its steps transcribe (`meeting.transcribe`), summarize (`llm`) and
//! send (any plugin step), like any other agent.

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

use super::store::MeetingRecord;
use crate::engine::RunManager;
use crate::error::AppResult;
use crate::storage::models::{Agent, AgentStatus, RunTrigger};
use crate::storage::Database;

pub const TRIGGER_SETTING_KEY: &str = "meeting_trigger";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingTrigger {
    pub enabled: bool,
}

pub fn load(db: &Database, agent_id: &str) -> AppResult<MeetingTrigger> {
    let stored = db.get_agent_setting(agent_id, TRIGGER_SETTING_KEY)?;
    Ok(stored.and_then(|value| serde_json::from_value(value).ok()).unwrap_or_default())
}

/// Saves the trigger. Turning it on activates the agent, like saving a schedule does
/// (`commands::triggers`): a meeting agent cannot be test-run without a real meeting, so
/// it would otherwise stay a draft and never run.
pub fn save(db: &Database, agent_id: &str, trigger: MeetingTrigger) -> AppResult<MeetingTrigger> {
    let agent = db.get_agent(agent_id)?;
    db.set_agent_setting(agent_id, TRIGGER_SETTING_KEY, &serde_json::to_value(trigger)?)?;
    if trigger.enabled && matches!(agent.status, AgentStatus::Draft | AgentStatus::Tested | AgentStatus::Paused) {
        db.set_agent_status(agent_id, AgentStatus::Active)?;
    }
    Ok(trigger)
}

/// Agents that run when a meeting is recorded: trigger on, and tested or active
/// (a draft has never run; a paused agent is paused).
pub fn triggered_agents(db: &Database) -> AppResult<Vec<Agent>> {
    let mut agents = Vec::new();
    for agent in db.list_agents()? {
        if !matches!(agent.status, AgentStatus::Tested | AgentStatus::Active) {
            continue;
        }
        if load(db, &agent.id)?.enabled {
            agents.push(agent);
        }
    }
    Ok(agents)
}

/// What a meeting-triggered run receives (its `start` node declares the ones it uses).
pub fn run_inputs(record: &MeetingRecord) -> serde_json::Value {
    let duration_minutes =
        record.ended_at.map(|ended| ((ended - record.started_at).num_seconds().max(0) + 30) / 60).unwrap_or(0);
    serde_json::json!({
        "meeting_id": record.id,
        "meeting_title": record.title,
        "meeting_app": record.app.clone().unwrap_or_default(),
        "started_at": record.started_at.to_rfc3339(),
        "ended_at": record.ended_at.map(|ended| ended.to_rfc3339()).unwrap_or_default(),
        "duration_minutes": duration_minutes,
    })
}

/// Starts an agent's run for a meeting. The app uses [`RunManager`]; tests record calls.
pub trait MeetingRunStarter: Send + Sync + std::fmt::Debug {
    fn start_meeting_run<'a>(
        &'a self,
        agent_id: &'a str,
        inputs: serde_json::Value,
    ) -> BoxFuture<'a, AppResult<String>>;
}

impl MeetingRunStarter for RunManager {
    /// The user started it (Take notes, then Stop), so it is a manual run.
    fn start_meeting_run<'a>(
        &'a self,
        agent_id: &'a str,
        inputs: serde_json::Value,
    ) -> BoxFuture<'a, AppResult<String>> {
        Box::pin(async move { self.start_run(agent_id, RunTrigger::Manual, inputs).await.map(|run| run.id) })
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use crate::meeting::store::MeetingStatus;
    use crate::storage::models::{AgentKind, NewAgent};

    fn agent(db: &Database, name: &str) -> Agent {
        db.create_agent(NewAgent {
            name: name.into(),
            kind: AgentKind::Task,
            description: "notes".into(),
            flow_yaml: "nodes: []".into(),
        })
        .expect("agent")
    }

    #[test]
    fn turning_the_trigger_on_activates_the_agent() {
        let db = Database::open_in_memory().expect("db");
        let draft = agent(&db, "Meeting notes");
        save(&db, &draft.id, MeetingTrigger { enabled: true }).expect("save");
        assert_eq!(db.get_agent(&draft.id).expect("agent").status, AgentStatus::Active);
        assert_eq!(triggered_agents(&db).expect("list").len(), 1);

        let other = agent(&db, "Off");
        save(&db, &other.id, MeetingTrigger { enabled: false }).expect("save");
        assert_eq!(db.get_agent(&other.id).expect("agent").status, AgentStatus::Draft);
    }

    #[test]
    fn only_tested_or_active_agents_with_the_trigger_run() {
        let db = Database::open_in_memory().expect("db");
        let draft = agent(&db, "Draft");
        let active = agent(&db, "Notes to Notion");
        let paused = agent(&db, "Paused");
        let without = agent(&db, "Without trigger");
        db.set_agent_status(&without.id, AgentStatus::Active).expect("status");
        for agent in [&draft, &active, &paused] {
            save(&db, &agent.id, MeetingTrigger { enabled: true }).expect("save");
        }
        // Paused (by hand) or back to draft after the trigger was set: they do not run.
        db.set_agent_status(&paused.id, AgentStatus::Paused).expect("status");
        db.set_agent_status(&draft.id, AgentStatus::Draft).expect("status");

        let names: Vec<String> = triggered_agents(&db).expect("list").into_iter().map(|agent| agent.name).collect();
        assert_eq!(names, ["Notes to Notion"]);
        assert!(load(&db, &active.id).expect("load").enabled);
        assert!(!load(&db, &without.id).expect("load").enabled);
        assert!(save(&db, "missing", MeetingTrigger { enabled: true }).is_err());
    }

    #[test]
    fn a_run_gets_the_meeting() {
        let started_at = Utc.with_ymd_and_hms(2026, 11, 26, 9, 0, 0).single().expect("time");
        let record = MeetingRecord {
            id: "20261126-090000-abc123".into(),
            title: "Zoom meeting, Nov 26 09:00".into(),
            app: Some("Zoom".into()),
            started_at,
            ended_at: Some(started_at + chrono::Duration::seconds(29 * 60 + 40)),
            status: MeetingStatus::Recorded,
            tracks: Vec::new(),
            error: None,
            run_ids: Vec::new(),
            audio_deleted: false,
            folder: String::new(),
        };
        let inputs = run_inputs(&record);
        assert_eq!(inputs["meeting_id"], "20261126-090000-abc123");
        assert_eq!(inputs["meeting_app"], "Zoom");
        assert_eq!(inputs["duration_minutes"], 30);
        assert_eq!(inputs["started_at"], "2026-11-26T09:00:00+00:00");
    }
}
