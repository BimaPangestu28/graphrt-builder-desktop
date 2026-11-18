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
