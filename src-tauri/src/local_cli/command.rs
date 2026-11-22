//! The exact command lines graphrt runs. No secret is ever part of them: the prompt
//! goes through stdin and the instructions through a file in the throwaway working
//! directory.
//!
//! Claude Code (print mode, no tools, nothing saved):
//! `claude -p --output-format stream-json --verbose --tools "" [--include-partial-messages]
//! [--no-session-persistence] [--strict-mcp-config] [--disable-slash-commands] [--safe-mode]
//! [--model <alias>] [--system-prompt-file <workdir>/instructions.txt]`
//!
//! Codex (non-interactive, read-only sandbox, nothing saved):
//! `codex exec --json --skip-git-repo-check --sandbox read-only --color never
//! [--ephemeral] -C <workdir> [-m <model>] -`
//!
//! Bracketed flags are passed only when the installed version's `--help` lists them.

use std::path::Path;

use super::detect::Detection;
use super::{LocalCli, CLI_DEFAULT_MODEL};

/// File in the working directory holding Claude Code's system prompt.
pub const INSTRUCTIONS_FILE_NAME: &str = "instructions.txt";

/// Claude Code flags passed only when its help lists them (older versions lack some).
const CLAUDE_OPTIONAL_FLAGS: &[&str] = &[
    // Partial messages make the answer stream token by token.
    "--include-partial-messages",
    "--no-session-persistence",
    // No MCP servers from the user's configuration.
    "--strict-mcp-config",
    "--disable-slash-commands",
    // No CLAUDE.md, hooks, plugins or MCP servers of the user's setup; sign-in still works.
    "--safe-mode",
];

/// Arguments for one call; `instructions_path` when there are system instructions.
pub fn build_args(
    cli: LocalCli,
    detection: &Detection,
    model: &str,
    workdir: &Path,
    instructions_path: Option<&Path>,
) -> Vec<String> {
    match cli {
        LocalCli::ClaudeCode => claude_args(detection, model, instructions_path),
        LocalCli::Codex => codex_args(detection, model, workdir),
    }
}

fn claude_args(detection: &Detection, model: &str, instructions_path: Option<&Path>) -> Vec<String> {
    let mut args: Vec<String> =
        ["-p", "--output-format", "stream-json", "--verbose", "--tools", ""].map(str::to_owned).to_vec();
    args.extend(CLAUDE_OPTIONAL_FLAGS.iter().filter(|flag| detection.supports(flag)).map(|flag| (*flag).to_owned()));
    if let Some(model) = explicit_model(model) {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    if let Some(instructions_path) = instructions_path {
        args.extend(["--system-prompt-file".to_owned(), instructions_path.display().to_string()]);
    }
    args
}

fn codex_args(detection: &Detection, model: &str, workdir: &Path) -> Vec<String> {
    let mut args: Vec<String> =
        ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never"]
            .map(str::to_owned)
            .to_vec();
    if detection.supports("--ephemeral") {
        args.push("--ephemeral".to_owned());
    }
    args.extend(["-C".to_owned(), workdir.display().to_string()]);
    if let Some(model) = explicit_model(model) {
        args.extend(["-m".to_owned(), model.to_owned()]);
    }
    // `-` reads the prompt from stdin.
    args.push("-".to_owned());
    args
}

/// Model names become one argument after `--model` / `-m`; anything that could read as
/// a flag (`--…`) or is not a plain model name is refused.
pub fn is_valid_model_name(model: &str) -> bool {
    let model = model.trim();
    model.len() <= 100
        && model.chars().next().is_some_and(|first| first.is_ascii_alphanumeric())
        && model.chars().all(|character| character.is_ascii_alphanumeric() || "._:-[]/".contains(character))
}

/// `None` for the CLI default; otherwise the trimmed model name.
fn explicit_model(model: &str) -> Option<&str> {
    let model = model.trim();
    (!model.is_empty() && model != CLI_DEFAULT_MODEL).then_some(model)
}
