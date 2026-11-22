//! Gemini CLI (`gemini`, Google, npm `@google/gemini-cli`).
//!
//! Docs and source (verified against `main`, 0.71, 2026-11):
//! - install: <https://github.com/google-gemini/gemini-cli> (README "Installation";
//!   `npm install -g @google/gemini-cli`, `brew install gemini-cli`)
//! - headless mode: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md>
//!   (a non-TTY stdin is headless and is the prompt; `--output-format stream-json`; exit
//!   codes 0 / 1 / 42 / 53)
//! - flags: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md>
//!   (`-m/--model`, `--approval-mode default|auto_edit|yolo|plan`, `--policy`, `--skip-trust`)
//! - policy engine: <https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md>
//!   (`toolName = "*"` matches every built-in and MCP tool; a deny rule removes the tool
//!   from what the model sees; "ask" is a deny in non-interactive runs)
//! - system prompt: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/system-prompt.md>
//!   (`GEMINI_SYSTEM_MD=<path>` fully replaces the built-in system prompt)
//! - folder trust: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md>
//!   (`--skip-trust`, `GEMINI_CLI_TRUST_WORKSPACE=true`)
//! - stream-json event shapes: `packages/core/src/output/types.ts`
//!
//! Command line (prompt on stdin, every tool denied by a policy file):
//! `gemini --output-format stream-json --approval-mode default --policy <workdir>/graphrt-deny-all.toml
//! [--skip-trust] [-m <model>]`, with `GEMINI_SYSTEM_MD=<workdir>/instructions.txt`,
//! `GEMINI_CLI_TRUST_WORKSPACE=true` and `GEMINI_TELEMETRY_ENABLED=false`. Plan mode is
//! never used (headless plan mode switches itself to YOLO to carry the plan out), nor
//! `--yolo`. The prompt is written to stdin right away (Gemini waits 1 s for piped input).
//!
//! Output (`stream-json`, JSONL): `init`, `message` (`role: "assistant"`, `content`,
//! `delta: true` for chunks), `tool_use`, `tool_result`, `error` (`severity`, `message`)
//! and `result` (`status: "success" | "error"`, `error`, `stats.input_tokens` /
//! `stats.output_tokens`). Sign-in: Gemini CLI has no status command, so it stays "not
//! confirmed" until a run or "Check connection" (a missing sign-in exits 41 with "Please
//! set an Auth method …").

use std::path::Path;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{named_models, CallPlan, CliAdapter, CliInfo, InstructionsDelivery};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, first_u64, parse_json_line, string_at, tool_use_refused, usage_delta,
    CliOutputParser,
};
use super::super::LocalCli;
use crate::model_catalog::AvailableModel;

pub struct GeminiCliAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "Gemini CLI",
    binary_names: &["gemini"],
    install_url: "https://github.com/google-gemini/gemini-cli",
    provider_name: "gemini-cli",
    enabled_setting_key: "local_cli_enabled.gemini-cli",
    sign_in_hint: "open Terminal, run `gemini` and sign in with Google",
    plan_name: "Google",
};

/// Policy file in the working directory denying every tool.
pub const POLICY_FILE_NAME: &str = "graphrt-deny-all.toml";

/// One deny rule for every tool (built-in and MCP), above any user or default rule.
const DENY_ALL_POLICY: &str = "# graphrt: Gemini CLI answers text only, no tools.\n\
[[rule]]\ntoolName = \"*\"\ndecision = \"deny\"\npriority = 999\n";

/// The aliases and models the docs name for `--model`.
const DOCUMENTED_MODELS: &[(&str, &str)] = &[
    ("auto", "Auto"),
    ("pro", "Pro (latest)"),
    ("flash", "Flash (latest)"),
    ("flash-lite", "Flash-Lite (latest)"),
    ("gemini-2.5-pro", "Gemini 2.5 Pro"),
    ("gemini-2.5-flash", "Gemini 2.5 Flash"),
];

impl CliAdapter for GeminiCliAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn instructions_delivery(&self) -> InstructionsDelivery {
        InstructionsDelivery::FileEnv("GEMINI_SYSTEM_MD")
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        workdir: &Path,
        instructions_path: Option<&Path>,
    ) -> CallPlan {
        let policy_path = workdir.join(POLICY_FILE_NAME);
        let mut args: Vec<String> =
            ["--output-format", "stream-json", "--approval-mode", "default", "--policy"].map(str::to_owned).to_vec();
        args.push(policy_path.display().to_string());
        if detection.supports("--skip-trust") {
            args.push("--skip-trust".to_owned());
        }
        if let Some(model) = explicit_model(model) {
            args.extend(["-m".to_owned(), model.to_owned()]);
        }
        let mut env = vec![
            ("GEMINI_CLI_TRUST_WORKSPACE".to_owned(), "true".to_owned()),
            ("GEMINI_TELEMETRY_ENABLED".to_owned(), "false".to_owned()),
        ];
        if let Some(instructions_path) = instructions_path {
            env.push(("GEMINI_SYSTEM_MD".to_owned(), instructions_path.display().to_string()));
        }
        CallPlan { args, env, files: vec![(POLICY_FILE_NAME.to_owned(), DENY_ALL_POLICY.to_owned())] }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(GeminiStreamParser::default())
    }

    fn list_models(&self, _detection: &Detection) -> Vec<AvailableModel> {
        named_models(DOCUMENTED_MODELS)
    }
}

/// Gemini CLI `--output-format stream-json` events.
#[derive(Debug, Default)]
pub struct GeminiStreamParser {
    finished: bool,
    /// The last `error` event of severity `error`, reported if the run fails.
    last_error: Option<String>,
}

impl CliOutputParser for GeminiStreamParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        match event.get("type").and_then(Json::as_str) {
            Some("message") if event.get("role").and_then(Json::as_str) == Some("assistant") => {
                let text = string_at(&event, "content");
                Ok(if text.is_empty() { Vec::new() } else { vec![ChatDelta::Text(text)] })
            }
            Some("tool_use") => Err(tool_use_refused(LocalCli::GeminiCli, &string_at(&event, "tool_name"))),
            Some("error") => {
                if event.get("severity").and_then(Json::as_str) != Some("warning") {
                    self.last_error = Some(string_at(&event, "message")).filter(|message| !message.is_empty());
                }
                Ok(Vec::new())
            }
            Some("result") => self.result_deltas(&event),
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, _exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        let message = match &self.last_error {
            Some(message) => message.clone(),
            None => gemini_stderr_error(stderr).unwrap_or_else(|| failure_text(stderr, "it stopped without an answer")),
        };
        Err(classify_failure(LocalCli::GeminiCli, &message))
    }
}

impl GeminiStreamParser {
    fn result_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        self.finished = true;
        if event.get("status").and_then(Json::as_str) == Some("error") {
            let message = event
                .pointer("/error/message")
                .and_then(Json::as_str)
                .filter(|message| !message.is_empty())
                .map(str::to_owned)
                .or_else(|| self.last_error.clone())
                .unwrap_or_else(|| "it reported an error".to_owned());
            return Err(classify_failure(LocalCli::GeminiCli, &message));
        }
        let mut deltas = Vec::new();
        if let Some(stats) = event.get("stats") {
            deltas.push(usage_delta(first_u64(stats, &["input_tokens"]), first_u64(stats, &["output_tokens"])));
        }
        deltas.push(ChatDelta::Finish(FinishReason::Stop));
        Ok(deltas)
    }
}

/// A fatal error printed on stderr as `{"error": {"type", "message"}}` (some failures
/// happen before stream-json output starts).
fn gemini_stderr_error(stderr: &str) -> Option<String> {
    let start = stderr.find('{')?;
    let value: Json = serde_json::Deserializer::from_str(&stderr[start..]).into_iter::<Json>().next()?.ok()?;
    value.pointer("/error/message").and_then(Json::as_str).map(str::to_owned)
}
