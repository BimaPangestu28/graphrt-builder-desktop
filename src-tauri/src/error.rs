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
    /// The OS credential store cannot keep or hand out secrets right now (Linux keyring
    /// missing, not set up, or locked). The message says how to fix it.
    #[error("{}", .0.message())]
    CredentialStoreUnavailable(CredentialStoreProblem),
    #[error("not set up yet: {0}")]
    MissingCredentials(String),
    #[error("workflow error: {0}")]
    Workflow(String),
    /// The builder's model did not produce a working agent after every repair round.
    /// `problem` is the last technical problem (for a "details" line, not the headline).
    #[error(
        "the AI model could not write a working agent for this request. Try again, describe the job in fewer \
         steps, or choose a stronger model in Connections > AI models"
    )]
    DraftNotValid { problem: String },
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
    /// A plugin needs a newer version of this app (see `plugins::app_requirement`); nothing
    /// was installed. `min_version` is the version it needs when known; `unknown_feature` is
    /// what its manifest uses that this version does not know (plugins from a folder or archive).
    #[error("{}", newer_app_message(.min_version.as_deref(), .unknown_feature.as_deref()))]
    NeedsNewerApp { min_version: Option<String>, unknown_feature: Option<String> },
    /// A plugin's own step failed (a one-off action from the UI). `kind` is the plugin's
    /// stable error kind (`setup_required`, `auth_error`...), which the screens explain in
    /// the UI language; `message` is the plugin's own English text, shown under it.
    #[error("{message}")]
    PluginStepFailed { kind: String, message: String },
    /// Only a released version goes online, and this agent has no release yet.
    #[error("release a checked version of this agent first (Versions > Release); only a release goes online")]
    NeedsRelease,
    /// The online copy could not go back to another release, so nothing changed: the release
    /// in use stays the same here and online. The cause is in the log.
    #[error("{}", online_switch_failed_message(*release_number, *in_use_number))]
    OnlineSwitchFailed { release_number: i64, in_use_number: Option<i64> },
}

/// "The online copy could not go back to release 1, so nothing changed: ..." in plain words; the
/// screens show their own translated text from the error's `details`.
fn online_switch_failed_message(release_number: i64, in_use_number: Option<i64>) -> String {
    let stays = match in_use_number {
        Some(number) => format!("release {number} stays in use here and online"),
        None => "the release in use stays the same here and online".to_owned(),
    };
    format!(
        "The online copy could not go back to release {release_number}, so nothing changed: {stays}. \
         Try again in a few minutes."
    )
}

/// "This plugin needs Graphrt Desktop 0.3.0 or newer. ..." in plain words; the screens show
/// their own translated text from the error's `details`.
fn newer_app_message(min_version: Option<&str>, unknown_feature: Option<&str>) -> String {
    let app_version = crate::plugins::app_requirement::APP_VERSION;
    let needs = match min_version {
        Some(min_version) => format!("This plugin needs Graphrt Desktop {min_version} or newer"),
        None => "This plugin was made for a newer version of Graphrt Desktop".to_owned(),
    };
    let detail = unknown_feature
        .map(|feature| format!(" It uses `{feature}`, which this version does not know."))
        .unwrap_or_default();
    format!("{needs}. You have {app_version}. Update Graphrt Desktop, then try again.{detail}")
}

/// Why the OS credential store cannot be used. Only the Secret Service on Linux reports
/// these; macOS Keychain and Windows Credential Manager are always there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialStoreProblem {
    /// A keyring service runs but has no default keyring (a fresh install where nobody
    /// created one): there is nowhere to save, and nothing saved to read.
    NoDefaultKeyring,
    /// No keyring service answers (none installed or started, or no session bus).
    NotRunning,
    /// The keyring is locked and was not unlocked when asked.
    Locked,
}

impl CredentialStoreProblem {
    /// Stable name sent to the frontend as `details.reason`, which shows its own
    /// translated wording for it.
    pub fn reason(self) -> &'static str {
        match self {
            Self::NoDefaultKeyring => "no_default_keyring",
            Self::NotRunning => "not_running",
            Self::Locked => "locked",
        }
    }

    /// Whether the store cannot hold any secret in this state, so a key that is looked
    /// up is simply not set. A locked keyring may hold keys, so it is not one of these.
    pub fn holds_no_secrets(self) -> bool {
        match self {
            Self::NoDefaultKeyring | Self::NotRunning => true,
            Self::Locked => false,
        }
    }

    /// What is wrong and how to fix it, in words a non-technical user can follow.
    pub fn message(self) -> &'static str {
        match self {
            Self::NoDefaultKeyring => {
                "This computer has no default password keyring yet, so there is no safe place to save this. \
                 Open the \"Passwords and Keys\" app, add a password keyring, right-click it and choose \
                 \"Set as default\", then try again."
            }
            Self::NotRunning => {
                "This computer has no password keyring running, so there is no safe place to save this. \
                 Install GNOME Keyring (or turn on KDE Wallet), sign out and back in, then try again."
            }
            Self::Locked => {
                "Your password keyring is locked. Unlock it with your computer password when asked, then try again."
            }
        }
    }
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
            Self::CredentialStoreUnavailable(_) => "credential_store_unavailable",
            Self::MissingCredentials(_) => "missing_credentials",
            Self::Workflow(_) => "workflow",
            Self::DraftNotValid { .. } => "draft_not_valid",
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
            Self::NeedsNewerApp { .. } => "needs_newer_app",
            Self::PluginStepFailed { .. } => "plugin_step_failed",
            Self::NeedsRelease => "needs_release",
            Self::OnlineSwitchFailed { .. } => "online_switch_failed",
        }
    }

    /// Structured data for the variants the UI acts on (`None` for the others).
    pub fn details(&self) -> Option<serde_json::Value> {
        match self {
            Self::VersionConflict { base_version, latest_version } => {
                Some(serde_json::json!({ "baseVersion": base_version, "latestVersion": latest_version }))
            }
            Self::CredentialStoreUnavailable(problem) => Some(serde_json::json!({ "reason": problem.reason() })),
            Self::DraftNotValid { problem } => Some(serde_json::json!({ "problem": problem })),
            Self::InvalidGraph(problems) => {
                serde_json::to_value(problems).ok().map(|problems| serde_json::json!({ "problems": problems }))
            }
            Self::NeedsNewerApp { min_version, unknown_feature } => Some(serde_json::json!({
                "minVersion": min_version,
                "appVersion": crate::plugins::app_requirement::APP_VERSION,
                "unknownFeature": unknown_feature,
            })),
            Self::PluginStepFailed { kind, .. } => Some(serde_json::json!({ "kind": kind })),
            Self::OnlineSwitchFailed { release_number, in_use_number } => {
                Some(serde_json::json!({ "releaseNumber": release_number, "inUseNumber": in_use_number }))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draft_that_stays_invalid_says_what_to_do_and_keeps_the_technical_problem_apart() {
        let error = AppError::DraftNotValid { problem: "invalid YAML workflow document: line 3".into() };
        let serialized = serde_json::to_value(&error).unwrap();

        assert_eq!(serialized["code"], "draft_not_valid");
        assert_eq!(serialized["details"]["problem"], "invalid YAML workflow document: line 3");
        let message = serialized["message"].as_str().unwrap();
        assert!(message.contains("Try again") && message.contains("stronger model"), "{message}");
        assert!(!message.contains("YAML"), "the headline stays in plain words: {message}");
    }

    #[test]
    fn a_failed_plugin_step_keeps_the_plugins_kind_and_message() {
        let error = AppError::PluginStepFailed {
            kind: "setup_required".into(),
            message: "DOCUMENT_TEMPLATES_OUTPUT_DIR is not set".into(),
        };
        let serialized = serde_json::to_value(&error).unwrap();

        assert_eq!(serialized["code"], "plugin_step_failed");
        assert_eq!(serialized["details"]["kind"], "setup_required");
        assert_eq!(serialized["message"], "DOCUMENT_TEMPLATES_OUTPUT_DIR is not set");
    }

    #[test]
    fn credential_store_problem_serializes_its_reason_and_fix() {
        let error = AppError::CredentialStoreUnavailable(CredentialStoreProblem::NoDefaultKeyring);
        let serialized = serde_json::to_value(&error).unwrap();

        assert_eq!(serialized["code"], "credential_store_unavailable");
        assert_eq!(serialized["details"]["reason"], "no_default_keyring");
        let message = serialized["message"].as_str().unwrap();
        assert!(message.contains("no default password keyring"), "{message}");
        assert!(message.contains("Passwords and Keys"), "{message}");
    }
}
