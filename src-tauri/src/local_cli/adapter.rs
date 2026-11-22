//! The per-CLI adapter contract: everything that differs between the local CLIs lives
//! behind [`CliAdapter`] (one implementation per CLI in `adapters/`), and the shared code
//! (detection, the subprocess, timeouts, cancellation, prompts, capability errors) only
//! talks to this trait.
//!
//! Every adapter follows the same rules:
//! - never read, copy or log the CLI's credential files or tokens; sign-in state comes
//!   from the CLI's own status command, or stays `Unknown` when it has none;
//! - never put a secret on the command line: the prompt goes through stdin, system
//!   instructions through a file in the throwaway working directory (or the prompt);
//! - run with no tools, no file writes and no shell, using the CLI's own sandbox /
//!   approval / allowed-tools switches;
//! - spend no usage outside a run or "Check connection" (detection and model lists
//!   only run `--version`, `--help`, status and local catalog commands).

use std::path::Path;

use super::detect::Detection;
use super::parse::CliOutputParser;
use super::process::QuickOutput;
use super::SignInState;
use crate::model_catalog::AvailableModel;

/// Fixed facts about one CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CliInfo {
    /// Name shown to the user, e.g. "Gemini CLI".
    pub display_name: &'static str,
    /// Executable names, in the order they are looked for (without `.exe` / `.cmd`).
    pub binary_names: &'static [&'static str],
    /// The official install page (also in `open_model_install_page`'s fixed allowlist).
    pub install_url: &'static str,
    /// The graphrt `model.provider` name, e.g. `gemini-cli`.
    pub provider_name: &'static str,
    /// Setting key remembering that the user turned this CLI on (`local_cli_enabled.<provider>`).
    pub enabled_setting_key: &'static str,
    /// What to tell the user when the CLI is not signed in.
    pub sign_in_hint: &'static str,
    /// Whose plan or account the usage counts against ("Claude", "ChatGPT", "Google").
    pub plan_name: &'static str,
}

/// Where a CLI takes graphrt's system instructions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstructionsDelivery {
    /// A file in the working directory, named by this flag (Claude Code `--system-prompt-file`).
    FileFlag(&'static str),
    /// A file in the working directory, named by this environment variable
    /// (Gemini CLI `GEMINI_SYSTEM_MD`): the path is not a secret, the text stays in the file.
    FileEnv(&'static str),
    /// On top of the prompt on stdin, with a reminder that this is a plain text task.
    InPrompt,
}

/// How the prompt text reaches the CLI (never as a command-line argument).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptDelivery {
    /// Written to stdin, which is then closed.
    Stdin,
    /// For a CLI that reads no prompt from stdin: the whole prompt (instructions included)
    /// goes into this file in the working directory, which the CLI loads by itself as
    /// project rules, and the command line only carries a fixed, harmless request to
    /// answer it. Stdin is closed empty.
    WorkdirRulesFile(&'static str),
}

/// What one call needs besides the binary: arguments, environment and working-folder files.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CallPlan {
    pub args: Vec<String>,
    /// Extra environment variables (never secrets: switches and file paths only).
    pub env: Vec<(String, String)>,
    /// Files written into the throwaway working directory first (relative path, content),
    /// e.g. a project config that denies every tool.
    pub files: Vec<(String, String)>,
}

/// One supported CLI. Implementations are stateless unit structs (`adapters/*`).
pub trait CliAdapter: Send + Sync {
    fn info(&self) -> &'static CliInfo;

    /// Arguments printing the help whose `--flags` are recorded (optional flags are
    /// passed only when the installed version lists them).
    fn help_args(&self) -> &'static [&'static str] {
        &["--help"]
    }

    /// The CLI's own sign-in status command, when it has one that spends no usage.
    fn sign_in_args(&self) -> Option<&'static [&'static str]> {
        None
    }

    /// Reads the status command's output (only the signed-in / out part, never the account).
    fn parse_sign_in(&self, _output: &QuickOutput) -> SignInState {
        SignInState::Unknown
    }

    /// Model aliases named by the help text (Claude Code's `--model` description).
    fn model_aliases_from_help(&self, _help: &str) -> Vec<String> {
        Vec::new()
    }

    /// Whether the executable found under `file_name` is really this CLI, judged by its
    /// help (only matters for generic names such as Cursor's `agent`).
    fn is_own_binary(&self, _file_name: &str, _help: &str) -> bool {
        true
    }

    fn instructions_delivery(&self) -> InstructionsDelivery {
        InstructionsDelivery::InPrompt
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::Stdin
    }

    /// The call for `model` (`default` = the CLI's own) in `workdir`;
    /// `instructions_path` holds the system instructions for the file deliveries.
    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        workdir: &Path,
        instructions_path: Option<&Path>,
    ) -> CallPlan;

    /// A fresh parser for one call's stdout.
    fn parser(&self) -> Box<dyn CliOutputParser>;

    /// The models it offers besides "CLI default", without spending usage.
    fn list_models(&self, _detection: &Detection) -> Vec<AvailableModel> {
        Vec::new()
    }
}

/// The plain-text-task reminder put on top of an in-prompt delivery.
pub const PLAIN_TEXT_PREAMBLE: &str = "You are used as a plain text model. Do not run commands, read or change files, \
     or browse: answer only from the text below.\n";

/// Models as `AvailableModel`s with their display names.
pub fn named_models(models: &[(&str, &str)]) -> Vec<AvailableModel> {
    models
        .iter()
        .map(|(id, display_name)| AvailableModel {
            id: (*id).to_owned(),
            display_name: Some((*display_name).to_owned()),
        })
        .collect()
}
