//! Payloads of the "When something goes wrong" screen (23). Sent to the
//! frontend as camelCase JSON; keep `src/api/problemTypes.ts` in sync.

use serde::Serialize;

use crate::storage::models::RunStatus;

/// What went wrong, so the UI can pick an icon or group problems.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemKind {
    /// The latest (non-test) run of an agent failed.
    FailedRun,
    /// An agent uses a model provider, workflow secret or plugin setting that is not set.
    MissingCredentials,
    /// An agent uses a plugin that is not installed.
    PluginMissing,
    /// An installed plugin failed to load.
    PluginNotLoaded,
    /// An agent uses a plugin the user has not trusted.
    PluginUntrusted,
    /// An agent uses a browser (Playwright) plugin but Chromium is not installed.
    BrowserMissing,
    /// An enabled schedule whose cron expression or time zone no longer parses.
    ScheduleInvalid,
    /// An agent's last scheduled runs all failed.
    ScheduleFailing,
}

/// What a button on a problem does. Every kind maps to real navigation or a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemActionKind {
    /// Show the failed run on screen 23 (`?runId=`).
    OpenRun,
    /// Start a new run of the same agent with the same inputs (`retry_run`).
    RetryRun,
    /// Connections (21): provider keys and workflow secrets.
    OpenConnections,
    /// Connections (21), Plugins section.
    OpenPlugins,
    /// The agent's builder (04).
    OpenBuilder,
    /// The agent's schedule dialog (08).
    OpenSchedule,
    /// Install Chromium for browser plugins (`install_browser_runtime`).
    InstallBrowser,
}

/// One button on a problem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemAction {
    pub kind: ProblemActionKind,
    pub label: String,
    pub agent_id: Option<String>,
    pub run_id: Option<String>,
}

impl ProblemAction {
    /// An action that needs no agent or run.
    pub fn new(kind: ProblemActionKind, label: &str) -> Self {
        Self { kind, label: label.to_owned(), agent_id: None, run_id: None }
    }

    /// An action about one agent.
    pub fn for_agent(kind: ProblemActionKind, label: &str, agent_id: &str) -> Self {
        Self { agent_id: Some(agent_id.to_owned()), ..Self::new(kind, label) }
    }

    /// An action about one run of an agent.
    pub fn for_run(kind: ProblemActionKind, label: &str, agent_id: &str, run_id: &str) -> Self {
        Self { run_id: Some(run_id.to_owned()), ..Self::for_agent(kind, label, agent_id) }
    }
}

/// One problem: what happened in plain words and the buttons that fix it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// Stable id, e.g. `failed_run:<run id>`.
    pub id: String,
    pub kind: ProblemKind,
    pub title: String,
    pub detail: String,
    /// Still waiting on the user (drawn with an amber border).
    pub needs_attention: bool,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub run_id: Option<String>,
    /// RFC 3339, when the problem happened (failed runs).
    pub occurred_at: Option<String>,
    pub actions: Vec<ProblemAction>,
}

/// How a step of the failed run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailedRunStepState {
    Done,
    Failed,
    /// Never reached (or skipped) because the run stopped earlier.
    Pending,
}

/// One step of the failed run, in workflow order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedRunStep {
    /// graphrt node id.
    pub id: String,
    pub name: String,
    pub state: FailedRunStepState,
    /// Short note next to a failed step, e.g. "Failed after 3 tries".
    pub note: Option<String>,
}

/// Whether "Retry from the start" can start a new run, and why not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryAvailability {
    pub can_retry: bool,
    /// Plain-language reason when `can_retry` is false.
    pub reason: Option<String>,
}

/// The failed run explained for the left column of screen 23.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedRunReport {
    pub run_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub status: RunStatus,
    pub started_at: String,
    pub title: String,
    pub explanation: String,
    pub fix_steps: Vec<String>,
    /// The button that fixes the cause (reconnect, open the step), if any.
    pub fix_action: Option<ProblemAction>,
    pub steps: Vec<FailedRunStep>,
    pub failed_step_id: Option<String>,
    /// graphrt's own error and ids, for the "Technical details" box.
    pub technical_details: String,
    pub retry: RetryAvailability,
}
