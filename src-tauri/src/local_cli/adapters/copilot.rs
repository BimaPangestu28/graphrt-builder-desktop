//! GitHub Copilot CLI (`copilot`, npm `@github/copilot`).
//!
//! Docs (verified 2026-11):
//! - install: <https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli>
//! - flags: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>
//!   (`--output-format json` = JSONL, `--model`, `--deny-tool`, `--excluded-tools`,
//!   `--disable-builtin-mcps`, `--no-ask-user`, `--no-custom-instructions`, `--no-color`;
//!   tool kinds `shell`, `write`, `read`, `url`, `memory`; deny beats every allow)
//! - programmatic use: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference>
//!   and <https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically>
//!   (piped stdin is the prompt when `-p` is not given; nothing can approve a tool in a
//!   non-interactive run, so requests needing approval are denied; `--no-auto-update`)
//! - changelog: <https://github.com/github/copilot-cli/blob/main/changelog.md> (0.0.422
//!   added `--output-format json`; 1.0.109/1.0.110 a final result record with the exit
//!   status, also for sign-in failures)
//!
//! Command line (prompt on stdin, every tool removed and denied):
//! `copilot --output-format json --no-color --deny-tool=shell --deny-tool=write
//! --deny-tool=read --deny-tool=url --deny-tool=memory [--excluded-tools=<tool>]…
//! [--disable-builtin-mcps] [--no-ask-user] [--no-custom-instructions] [--no-auto-update]
//! [--model <model>]` (bracketed flags only when `copilot --help` lists them). No
//! `--allow-*` flag is ever passed. Copilot takes no system prompt flag: the instructions
//! go on top of the prompt.
//!
//! The JSONL record shapes of a prompt run are not documented field by field. The parser
//! reads the documented `type` + `data` envelope as reported in the official repo
//! (issue github/copilot-cli#3544: `assistant.message` with `data.content`), streams
//! `assistant.message_delta` (`data.deltaContent`) when present, and treats the final
//! `result` record's `exitCode` as success or failure. Sign-in: Copilot has no status
//! command, so it stays "not confirmed" until a run or "Check connection".

use std::path::Path;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{named_models, CallPlan, CliAdapter, CliInfo};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, json_text, lenient_usage_delta, parse_json_line, string_at, tool_use_refused,
    CliOutputParser,
};
use super::super::LocalCli;
use crate::model_catalog::AvailableModel;

pub struct CopilotAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "GitHub Copilot CLI",
    binary_names: &["copilot"],
    install_url: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    provider_name: "copilot-cli",
    enabled_setting_key: "local_cli_enabled.copilot-cli",
    sign_in_hint: "open Terminal, run `copilot` and sign in with /login",
    plan_name: "GitHub Copilot",
};

/// Tool kinds denied outright (`--deny-tool`, which never prompts and beats every allow).
const DENIED_TOOL_KINDS: &[&str] = &["shell", "write", "read", "url", "memory"];

/// Every built-in tool the reference names, removed from what the model sees.
const EXCLUDED_TOOLS: &[&str] = &[
    "bash",
    "powershell",
    "list_bash",
    "list_powershell",
    "read_bash",
    "read_powershell",
    "stop_bash",
    "stop_powershell",
    "write_bash",
    "write_powershell",
    "apply_patch",
    "create",
    "edit",
    "view",
    "glob",
    "grep",
    "rg",
    "list_agents",
    "read_agent",
    "task",
    "write_agent",
    "ask_user",
    "skill",
    "web_fetch",
];

/// Switches passed only when the installed version's help lists them.
const OPTIONAL_FLAGS: &[&str] =
    &["--disable-builtin-mcps", "--no-ask-user", "--no-custom-instructions", "--no-auto-update"];

/// `auto` and the models of the reference's "Supported models" table.
const DOCUMENTED_MODELS: &[(&str, &str)] = &[
    ("auto", "Auto"),
    ("claude-sonnet-5.5", "Claude Sonnet 5.5"),
    ("claude-opus-5.5", "Claude Opus 5.5"),
    ("claude-haiku-5.5", "Claude Haiku 5.5"),
    ("gpt-5.4", "GPT-5.4"),
    ("gpt-5.3-codex", "GPT-5.3-Codex"),
];

impl CliAdapter for CopilotAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        _workdir: &Path,
        _instructions_path: Option<&Path>,
    ) -> CallPlan {
        let mut args: Vec<String> = ["--output-format", "json", "--no-color"].map(str::to_owned).to_vec();
        args.extend(DENIED_TOOL_KINDS.iter().map(|kind| format!("--deny-tool={kind}")));
        if detection.supports("--excluded-tools") {
            args.extend(EXCLUDED_TOOLS.iter().map(|tool| format!("--excluded-tools={tool}")));
        }
        args.extend(OPTIONAL_FLAGS.iter().filter(|flag| detection.supports(flag)).map(|flag| (*flag).to_owned()));
        if let Some(model) = explicit_model(model) {
            args.extend(["--model".to_owned(), model.to_owned()]);
        }
        CallPlan { args, ..CallPlan::default() }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(CopilotJsonParser::default())
    }

    fn list_models(&self, _detection: &Detection) -> Vec<AvailableModel> {
        named_models(DOCUMENTED_MODELS)
    }
}

/// Copilot `--output-format json` records (JSONL, `{"type": …, "data": {…}}`).
#[derive(Debug, Default)]
pub struct CopilotJsonParser {
    saw_delta: bool,
    message_count: usize,
    finished: bool,
    /// The last `session.error` / `error` message, reported if the run fails.
    last_error: Option<String>,
}

impl CliOutputParser for CopilotJsonParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        let data = event.get("data").unwrap_or(&Json::Null);
        match event.get("type").and_then(Json::as_str) {
            Some("assistant.message_delta") => Ok(self.delta(string_at(data, "deltaContent"))),
            Some("assistant.message") => Ok(self.message(string_at(data, "content"))),
            Some("tool.execution_start") => Err(tool_use_refused(LocalCli::CopilotCli, &string_at(data, "toolName"))),
            Some("session.error" | "error") => {
                self.last_error = json_text(data).or_else(|| json_text(event.get("message").unwrap_or(&Json::Null)));
                Ok(Vec::new())
            }
            Some("result") => self.result_deltas(&event),
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        if exited_successfully && self.message_count > 0 && self.last_error.is_none() {
            return Ok(vec![ChatDelta::Finish(FinishReason::Stop)]);
        }
        let message = match &self.last_error {
            Some(message) => message.clone(),
            None => failure_text(stderr, "it stopped without an answer"),
        };
        Err(classify_failure(LocalCli::CopilotCli, &message))
    }
}

impl CopilotJsonParser {
    fn delta(&mut self, text: String) -> Vec<ChatDelta> {
        if text.is_empty() {
            return Vec::new();
        }
        self.saw_delta = true;
        vec![ChatDelta::Text(text)]
    }

    /// A complete message: the answer only when no delta streamed; several are separated
    /// by a blank line.
    fn message(&mut self, text: String) -> Vec<ChatDelta> {
        if text.is_empty() {
            return Vec::new();
        }
        self.message_count += 1;
        if self.saw_delta {
            return Vec::new();
        }
        vec![ChatDelta::Text(if self.message_count > 1 { format!("\n\n{text}") } else { text })]
    }

    fn result_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        self.finished = true;
        let exit_code = event.get("exitCode").and_then(Json::as_i64).unwrap_or(0);
        if exit_code != 0 {
            let message = self.last_error.clone().unwrap_or_else(|| format!("it exited with code {exit_code}"));
            return Err(classify_failure(LocalCli::CopilotCli, &message));
        }
        let mut deltas: Vec<ChatDelta> = event.get("usage").and_then(lenient_usage_delta).into_iter().collect();
        deltas.push(ChatDelta::Finish(FinishReason::Stop));
        Ok(deltas)
    }
}
