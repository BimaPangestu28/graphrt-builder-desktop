//! Error type shared by every module and returned to the frontend by Tauri commands.

use serde::Serialize;

/// Errors the desktop backend can report. Each variant maps to a stable `code`
/// the frontend can branch on; `message` is safe to show to the user and never
/// contains secrets.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0} not found")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("credential store error: {0}")]
    Credentials(String),
    #[error("not set up yet: {0}")]
    MissingCredentials(String),
    #[error("workflow error: {0}")]
    Workflow(String),
    #[error("model error: {0}")]
    Model(String),
    #[error("schedule error: {0}")]
    Schedule(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
    /// The action would replace something the user has not agreed to replace (e.g. a
    /// sideloaded plugin over one installed from the catalog); ask, then retry.
    #[error("{0}")]
    Conflict(String),
    /// The agent uses plugins that are not installed (technical names, sorted; the
    /// message shows them humanized).
    #[error("this agent needs plugins that are not installed: {}", humanized_plugin_names(.0))]
    MissingPlugins(Vec<String>),
    /// An edit was made on `base_version`, but the agent moved on to `latest_version`
    /// (the builder or another window saved meanwhile).
    #[error("this agent changed while you were editing (you edited version {base_version}, the latest is version {latest_version})")]
    VersionConflict { base_version: i64, latest_version: i64 },
    /// The builder (a chat change) is changing this agent; edits wait until it is done.
    #[error("the builder is changing this agent; try again when it is done")]
    BuilderBusy,
    /// An edited graph does not pass validation; nothing was saved.
    #[error("the edited steps have {} problem(s): {}", .0.len(), first_problem_message(.0))]
    InvalidGraph(Vec<crate::agent_graph::GraphProblem>),
    /// The user stopped a running builder change ("Stop the builder"); nothing was saved.
    #[error("Stopped by you")]
    Stopped,
}

fn first_problem_message(problems: &[crate::agent_graph::GraphProblem]) -> String {
    problems.first().map(|problem| problem.message.clone()).unwrap_or_default()
}

fn humanized_plugin_names(names: &[String]) -> String {
    let labels: Vec<String> =
        names.iter().map(|name| crate::plugins::display_name::humanize_plugin_name(name)).collect();
    labels.join(", ")
}

impl AppError {
    /// Stable machine-readable code sent to the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "not_found",
            Self::InvalidInput(_) => "invalid_input",
            Self::Database(_) => "database",
            Self::Credentials(_) => "credentials",
            Self::MissingCredentials(_) => "missing_credentials",
            Self::Workflow(_) => "workflow",
            Self::Model(_) => "model",
            Self::Schedule(_) => "schedule",
            Self::Serialization(_) => "serialization",
            Self::Internal(_) => "internal",
            Self::Conflict(_) => "conflict",
            Self::MissingPlugins(_) => "missing_plugins",
            Self::VersionConflict { .. } => "version_conflict",
            Self::BuilderBusy => "builder_busy",
            Self::InvalidGraph(_) => "invalid_graph",
            Self::Stopped => "stopped",
        }
    }

    /// Structured data for the variants the UI acts on (`None` for the others).
    pub fn details(&self) -> Option<serde_json::Value> {
        match self {
            Self::VersionConflict { base_version, latest_version } => {
                Some(serde_json::json!({ "baseVersion": base_version, "latestVersion": latest_version }))
            }
            Self::InvalidGraph(problems) => {
                serde_json::to_value(problems).ok().map(|problems| serde_json::json!({ "problems": problems }))
            }
            _ => None,
        }
    }
}

/// Serialized as `{ "code": "...", "message": "..." }` so the frontend gets a typed error,
/// plus `details` for the variants that carry data (see [`AppError::details`]).
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let details = self.details();
        let mut state = serializer.serialize_struct("AppError", if details.is_some() { 3 } else { 2 })?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        if let Some(details) = details {
            state.serialize_field("details", &details)?;
        } else {
            state.skip_field("details")?;
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
