//! The command line of one call. No secret is ever part of it: the prompt goes through
//! stdin (or a rules file in the working directory) and the instructions through a file
//! in the throwaway working directory or the prompt. Each adapter documents its exact
//! command line (`adapters/*`).

use std::path::Path;

use super::adapter::CallPlan;
use super::detect::Detection;
use super::{LocalCli, CLI_DEFAULT_MODEL};

/// File in the working directory holding the system instructions (file deliveries).
pub const INSTRUCTIONS_FILE_NAME: &str = "instructions.txt";

/// Arguments, environment and working-folder files of one call.
pub fn plan_call(
    cli: LocalCli,
    detection: &Detection,
    model: &str,
    workdir: &Path,
    instructions_path: Option<&Path>,
) -> CallPlan {
    cli.adapter().plan_call(detection, model, workdir, instructions_path)
}

/// Arguments for one call; `instructions_path` when there are system instructions.
#[cfg(test)]
pub fn build_args(
    cli: LocalCli,
    detection: &Detection,
    model: &str,
    workdir: &Path,
    instructions_path: Option<&Path>,
) -> Vec<String> {
    plan_call(cli, detection, model, workdir, instructions_path).args
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
pub fn explicit_model(model: &str) -> Option<&str> {
    let model = model.trim();
    (!model.is_empty() && model != CLI_DEFAULT_MODEL).then_some(model)
}
