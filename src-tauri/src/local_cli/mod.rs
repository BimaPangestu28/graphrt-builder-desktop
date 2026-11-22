//! Local CLI model providers: the user's own, already signed-in AI command-line tools
//! (Claude Code, Codex, Gemini CLI, Cursor CLI, GitHub Copilot CLI, OpenCode, Qwen Code),
//! run as subprocesses (Experimental, each off until the user turns it on).
//!
//! graphrt never reads, copies or logs the CLIs' credential files or tokens and never
//! passes a secret on the command line: it only invokes the binary, the way the user
//! would in a terminal, and the CLI signs in with whatever it already has.
//!
//! Each call runs in a throwaway working directory with no tools (each CLI's own
//! sandbox / approval / allowed-tools switches, see `adapters/`), so the model cannot
//! touch the user's files or run commands. Calls have a timeout and the process is
//! killed when the call is dropped (Stop run, Stop the builder).
//!
//! Layout:
//! - `adapter`: the [`adapter::CliAdapter`] contract; `adapters`: one per CLI (flags,
//!   output parser, sign-in status, models), each citing the CLI's official docs.
//! - `detect`: finds the binaries (PATH, common install folders, a login shell on
//!   macOS/Linux where GUI apps do not inherit the shell PATH), their version, the flags
//!   their `--help` lists and whether they are signed in (their own status commands).
//! - `prompt`: turns a graphrt `ChatRequest` into instructions + one prompt text.
//! - `command`: the command line of one call (delegates to the adapter).
//! - `parse`: shared output-parsing helpers and plain-language failures.
//! - `model`: the `graphrt_llm::ChatModel` running a call.
//! - `check`: "Check connection" (one tiny prompt, only when the user asks).
//! - `models`: the model choices each CLI offers.

pub mod adapter;
#[cfg(test)]
mod adapter_tests;
mod adapters;
pub mod capability;
mod check;
mod command;
pub mod detect;
mod model;
mod models;
mod parse;
mod process;
mod prompt;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

use adapter::{CliAdapter, CliInfo};

pub use check::{check_connection, LocalCliCheck};
pub use model::LocalCliModel;
pub use models::list_models;

/// Upper bound on one model call through a CLI (a builder draft can take minutes).
pub const CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// A supported local CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalCli {
    ClaudeCode,
    Codex,
    GeminiCli,
    CursorCli,
    CopilotCli,
    OpenCode,
    QwenCode,
}

impl LocalCli {
    /// Every CLI, in the order the UI lists them (Claude Code and Codex first).
    pub const ALL: [LocalCli; 7] = [
        LocalCli::ClaudeCode,
        LocalCli::Codex,
        LocalCli::GeminiCli,
        LocalCli::CursorCli,
        LocalCli::CopilotCli,
        LocalCli::OpenCode,
        LocalCli::QwenCode,
    ];

    /// The adapter holding everything specific to this CLI.
    pub fn adapter(self) -> &'static dyn CliAdapter {
        adapters::adapter_for(self)
    }

    fn info(self) -> &'static CliInfo {
        self.adapter().info()
    }

    /// Name shown to the user.
    pub fn display_name(self) -> &'static str {
        self.info().display_name
    }

    /// The command the user types in a terminal (the first of its executable names).
    pub fn binary_name(self) -> &'static str {
        self.info().binary_names[0]
    }

    /// Every executable name it may be installed as, in the order they are looked for.
    pub fn binary_names(self) -> &'static [&'static str] {
        self.info().binary_names
    }

    /// Where the user learns to install it (the official page).
    pub fn install_url(self) -> &'static str {
        self.info().install_url
    }

    /// The graphrt `model.provider` name (also the serde name of the `ModelProvider`).
    pub fn provider_name(self) -> &'static str {
        self.info().provider_name
    }

    /// Parses a graphrt provider name.
    pub fn from_provider_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|cli| cli.provider_name() == name)
    }

    /// Setting key remembering that the user turned this CLI on in graphrt.
    pub fn enabled_setting_key(self) -> &'static str {
        self.info().enabled_setting_key
    }

    /// What to tell the user when the CLI is not signed in.
    pub fn sign_in_hint(self) -> &'static str {
        self.info().sign_in_hint
    }

    /// The plan the CLI's usage counts against.
    pub fn plan_name(self) -> &'static str {
        self.info().plan_name
    }
}

/// Model id meaning "whatever the CLI uses by default" (no `--model` / `-m` flag).
pub const CLI_DEFAULT_MODEL: &str = "default";

/// Whether the CLI says it is signed in (its own status command; no usage spent).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignInState {
    SignedIn,
    SignedOut,
    /// No status command, or its answer could not be read.
    #[default]
    Unknown,
}

/// What the Connections card and Welcome screen show about one CLI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCliStatus {
    /// The user turned it on in graphrt (opt-in).
    pub enabled: bool,
    /// The binary was found.
    pub installed: bool,
    /// First line of `--version`, e.g. `2.1.330 (Claude Code)`.
    pub version: Option<String>,
    /// Resolved binary path.
    pub path: Option<String>,
    pub sign_in: SignInState,
    pub install_url: String,
}

/// Reads whether the user turned `cli` on; read failures count as off (logged).
pub fn is_enabled(cli: LocalCli, db: &crate::storage::Database) -> bool {
    match db.get_setting(cli.enabled_setting_key()) {
        Ok(value) => value.as_deref().map(str::trim) == Some("true"),
        Err(error) => {
            log::warn!("could not read whether {} is turned on: {error}", cli.display_name());
            false
        }
    }
}

/// The status of `cli` from the cached detection (detects now when nothing is cached).
pub fn status(cli: LocalCli, db: &crate::storage::Database) -> LocalCliStatus {
    status_from(cli, is_enabled(cli, db), &detect::cached(cli, false))
}

/// The status of `cli` from one detection result.
pub fn status_from(cli: LocalCli, enabled: bool, detection: &detect::Detection) -> LocalCliStatus {
    LocalCliStatus {
        enabled,
        installed: detection.binary.is_some(),
        version: detection.version.clone(),
        path: detection.binary.as_ref().map(|path| path.display().to_string()),
        sign_in: detection.sign_in,
        install_url: cli.install_url().to_owned(),
    }
}
