//! Records stored in the local SQLite database. These are also the payloads
//! returned to the frontend (camelCase JSON); keep `src/api/types.ts` in sync.

use serde::{Deserialize, Serialize};

/// What kind of agent the user built (the four options on screen 02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Task,
    Chatbot,
    Chain,
    Team,
}

/// Lifecycle of an agent: drafted → tested → active (scheduled) or paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Draft,
    Tested,
    Active,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub kind: AgentKind,
    /// The plain-language request the agent was built from.
    pub description: String,
    /// graphrt workflow document (YAML) of the current version.
    pub flow_yaml: String,
    pub status: AgentStatus,
    pub current_version: i64,
    /// RFC 3339 timestamps.
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersion {
    pub agent_id: String,
    pub version: i64,
    pub flow_yaml: String,
    /// Short human summary, e.g. "Changed 2 steps".
    pub change_summary: String,
    pub created_at: String,
}

/// Fields needed to create an agent; id, version and timestamps are assigned by storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgent {
    pub name: String,
    pub kind: AgentKind,
    pub description: String,
    pub flow_yaml: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunTrigger {
    /// Started from the builder's "Test" button.
    Test,
    Manual,
    Schedule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    /// Waiting for the user (approval / human input). A snapshot is stored.
    Paused,
    Succeeded,
    Failed,
    Aborted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    pub agent_version: i64,
    pub trigger: RunTrigger,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// Final outputs of a succeeded run (JSON object).
    pub outputs: Option<serde_json::Value>,
    pub error_message: Option<String>,
    /// The error kind a failed run stopped with (`run_failed.error_type`: `setup_required`,
    /// `timeout`...), so lists can explain it in the UI language. Read from the run's events.
    pub error_type: Option<String>,
    /// Why the run is paused (graphrt `PauseReason`s as JSON), when `status == Paused`.
    pub pause_reasons: Option<serde_json::Value>,
}

/// One persisted graphrt event of a run, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventRecord {
    pub run_id: String,
    pub seq: i64,
    /// The graphrt `Event` serialized as JSON (`{"type": "node_started", ...}`).
    pub event: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFilter {
    pub agent_id: Option<String>,
    pub status: Option<RunStatus>,
    /// Defaults to 100.
    pub limit: Option<i64>,
}

/// What to do with a scheduled run that was missed because the computer was asleep or off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissedRunPolicy {
    RunOnce,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub id: String,
    pub agent_id: String,
    /// Cron expression with seconds, as accepted by the `cron` crate: "0 0 9 * * Mon-Fri".
    pub cron_expression: String,
    /// IANA time zone, e.g. "Asia/Jakarta".
    pub timezone: String,
    pub enabled: bool,
    pub missed_run_policy: MissedRunPolicy,
    /// Workflow inputs passed to every scheduled run (JSON object).
    pub inputs: serde_json::Value,
    pub last_fired_at: Option<String>,
    pub next_fire_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTrigger {
    pub agent_id: String,
    pub cron_expression: String,
    pub timezone: String,
    pub missed_run_policy: MissedRunPolicy,
    pub inputs: serde_json::Value,
}

/// Who wrote a message in the builder chat (screen 04).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuilderMessageRole {
    /// A change the user asked for.
    User,
    /// The builder's reply: a finished change, a restore, or why a change failed.
    Builder,
}

/// Whether a builder chat message stands for a saved change or a failed one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuilderMessageStatus {
    Done,
    Failed,
}

/// One saved message of an agent's builder chat, so the conversation survives leaving the screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderMessage {
    pub id: String,
    pub agent_id: String,
    pub role: BuilderMessageRole,
    /// The user's request, the change summary, or the error message of a failed change.
    pub text: String,
    /// The model's own words about the change (builder replies only).
    pub explanation: Option<String>,
    pub status: BuilderMessageStatus,
    /// Agent version before and after the change, when known.
    pub version_before: Option<i64>,
    pub version_after: Option<i64>,
    /// Steps the change added or edited.
    pub changed_step_ids: Vec<String>,
    pub created_at: String,
}

/// Text of the builder's reply to a change the user stopped.
pub const STOPPED_REPLY_TEXT: &str = "Stopped by you";

/// Fields of a builder chat message to save; id and timestamp are assigned by storage.
#[derive(Debug, Clone, PartialEq)]
pub struct NewBuilderMessage {
    pub role: BuilderMessageRole,
    pub text: String,
    pub explanation: Option<String>,
    pub status: BuilderMessageStatus,
    pub version_before: Option<i64>,
    pub version_after: Option<i64>,
    pub changed_step_ids: Vec<String>,
}

impl NewBuilderMessage {
    /// What the user asked for, on the version it was asked against.
    pub fn user_request(text: &str, version_before: Option<i64>) -> Self {
        Self {
            role: BuilderMessageRole::User,
            text: text.to_owned(),
            explanation: None,
            status: BuilderMessageStatus::Done,
            version_before,
            version_after: None,
            changed_step_ids: Vec::new(),
        }
    }

    /// A builder reply about a saved change from `version_before` to `version_after`.
    pub fn builder_reply(text: &str, explanation: Option<String>, versions: (Option<i64>, i64)) -> Self {
        Self {
            role: BuilderMessageRole::Builder,
            text: text.to_owned(),
            explanation: explanation.filter(|words| !words.trim().is_empty()),
            status: BuilderMessageStatus::Done,
            version_before: versions.0,
            version_after: Some(versions.1),
            changed_step_ids: Vec::new(),
        }
    }

    /// A builder reply saying the user stopped the change before it was saved ("Stopped by you").
    pub fn builder_stopped(version_before: Option<i64>) -> Self {
        Self {
            role: BuilderMessageRole::Builder,
            text: STOPPED_REPLY_TEXT.to_owned(),
            explanation: None,
            status: BuilderMessageStatus::Done,
            version_before,
            version_after: None,
            changed_step_ids: Vec::new(),
        }
    }

    /// A builder reply saying a change failed, with the (secret-free) error message.
    pub fn builder_failure(error_message: &str, version_before: Option<i64>) -> Self {
        Self {
            role: BuilderMessageRole::Builder,
            text: error_message.to_owned(),
            explanation: None,
            status: BuilderMessageStatus::Failed,
            version_before,
            version_after: None,
            changed_step_ids: Vec::new(),
        }
    }
}
