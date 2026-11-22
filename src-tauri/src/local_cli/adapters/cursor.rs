//! Cursor CLI (`cursor-agent`, newer installs also `agent`).
//!
//! Docs (verified 2026-11):
//! - install: <https://cursor.com/docs/cli/installation> (`curl https://cursor.com/install -fsS | bash`,
//!   into `~/.local/bin`)
//! - print mode and its permissions: <https://cursor.com/docs/cli/headless>
//! - flags: <https://cursor.com/docs/cli/reference/parameters> (`-p/--print`, `--output-format`,
//!   `--stream-partial-output`, `--model`, `--mode plan|ask`, `--trust`, `--workspace`,
//!   `status`; `--force` / `--yolo` / `--approve-mcps` are never passed)
//! - output: <https://cursor.com/docs/cli/reference/output-format> (`stream-json` events)
//! - permissions: <https://cursor.com/docs/cli/reference/permissions> (project
//!   `.cursor/cli.json`, `Shell(…)` / `Read(…)` / `Write(…)` / `WebFetch(…)` / `Mcp(…)`
//!   tokens, deny beats allow)
//! - rules: <https://cursor.com/docs/cli/using> (`AGENTS.md` at the project root is
//!   applied as rules)
//!
//! Command line (print mode, Ask mode = read-only, trusted throwaway workspace):
//! `cursor-agent -p --output-format stream-json [--stream-partial-output] [--mode ask]
//! [--trust] [--workspace <workdir>] [--model <model>] "<fixed request>"`
//! (bracketed flags only when the installed version's `--help` lists them).
//!
//! The docs name the prompt only as a positional argument (piped stdin is not documented
//! as a prompt source), and graphrt never puts prompt text on the command line. So the
//! whole prompt goes into `AGENTS.md` in the throwaway workspace, which Cursor applies as
//! project rules, and the argument is the fixed [`FIXED_REQUEST`]. The workspace also
//! gets a `.cursor/cli.json` denying every shell, read, write, web and MCP tool; Ask mode
//! makes no edits; and a `tool_call` event ends the call anyway.
//!
//! Sign-in: `cursor-agent status` ("Not authenticated" when signed out, per the
//! authentication troubleshooting docs). Models: the ones the docs name (`auto`,
//! `gpt-5`, `sonnet-4-thinking`); `cursor-agent models` needs the network, so it is not run.

use std::path::Path;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{named_models, CallPlan, CliAdapter, CliInfo, PromptDelivery};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, lenient_usage_delta, parse_json_line, string_at, tool_use_refused, CliOutputParser,
};
use super::super::process::QuickOutput;
use super::super::{LocalCli, SignInState};
use crate::model_catalog::AvailableModel;

pub struct CursorAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "Cursor CLI",
    binary_names: &["cursor-agent", "agent"],
    install_url: "https://cursor.com/docs/cli/installation",
    provider_name: "cursor-cli",
    enabled_setting_key: "local_cli_enabled.cursor-cli",
    sign_in_hint: "open Terminal, run `cursor-agent login` and sign in",
    plan_name: "Cursor",
};

/// The rules file Cursor loads from the workspace root.
const RULES_FILE_NAME: &str = "AGENTS.md";

/// The only prompt text on the command line: no user data, just "answer the rules".
pub const FIXED_REQUEST: &str =
    "Answer the task in this project's AGENTS.md rules. Reply with the answer text only; use no tools.";

/// Project permissions denying every tool (`.cursor/cli.json`, deny beats allow).
const DENY_ALL_PERMISSIONS: &str = r#"{
  "permissions": {
    "allow": [],
    "deny": ["Shell(*)", "Read(**)", "Read(/**)", "Write(**)", "Write(/**)", "WebFetch(*)", "Mcp(*:*)"]
  }
}
"#;

/// Flags passed only when the installed version's help lists them.
const OPTIONAL_FLAGS: &[(&str, Option<&str>)] =
    &[("--stream-partial-output", None), ("--mode", Some("ask")), ("--trust", None)];

/// Models the Cursor docs name for `--model`.
const DOCUMENTED_MODELS: &[(&str, &str)] =
    &[("auto", "Auto"), ("gpt-5", "GPT-5"), ("sonnet-4-thinking", "Sonnet 4 Thinking")];

impl CliAdapter for CursorAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn sign_in_args(&self) -> Option<&'static [&'static str]> {
        Some(&["status"])
    }

    fn parse_sign_in(&self, output: &QuickOutput) -> SignInState {
        parse_cursor_status(&format!("{}\n{}", output.stdout, output.stderr))
    }

    /// `agent` is a generic name: it counts only when its help is Cursor's.
    fn is_own_binary(&self, file_name: &str, help: &str) -> bool {
        file_name != "agent" || help.to_ascii_lowercase().contains("cursor")
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::WorkdirRulesFile(RULES_FILE_NAME)
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        workdir: &Path,
        _instructions_path: Option<&Path>,
    ) -> CallPlan {
        let mut args: Vec<String> = ["-p", "--output-format", "stream-json"].map(str::to_owned).to_vec();
        for (flag, value) in OPTIONAL_FLAGS.iter().filter(|(flag, _)| detection.supports(flag)) {
            args.push((*flag).to_owned());
            args.extend(value.map(str::to_owned));
        }
        if detection.supports("--workspace") {
            args.extend(["--workspace".to_owned(), workdir.display().to_string()]);
        }
        if let Some(model) = explicit_model(model) {
            args.extend(["--model".to_owned(), model.to_owned()]);
        }
        args.push(FIXED_REQUEST.to_owned());
        CallPlan {
            args,
            env: Vec::new(),
            files: vec![(".cursor/cli.json".to_owned(), DENY_ALL_PERMISSIONS.to_owned())],
        }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(CursorStreamParser::default())
    }

    fn list_models(&self, _detection: &Detection) -> Vec<AvailableModel> {
        named_models(DOCUMENTED_MODELS)
    }
}

/// `cursor-agent status`: "Not authenticated" / "not logged in" is signed out; a line
/// saying it is logged in / authenticated is signed in. The account itself is not read.
pub fn parse_cursor_status(output: &str) -> SignInState {
    let lowered = output.to_ascii_lowercase();
    if ["not authenticated", "not logged in", "not signed in", "unauthenticated"]
        .iter()
        .any(|text| lowered.contains(text))
    {
        SignInState::SignedOut
    } else if ["logged in", "authenticated", "signed in"].iter().any(|text| lowered.contains(text)) {
        SignInState::SignedIn
    } else {
        SignInState::Unknown
    }
}

/// Cursor `--output-format stream-json` events (NDJSON).
///
/// - `assistant` with `timestamp_ms` and no `model_call_id`: a text delta
///   (`--stream-partial-output`); with `model_call_id`: a flush before a tool call
///   (duplicate, skipped); without `timestamp_ms`: a complete message, used only when no
///   delta streamed.
/// - `tool_call` (`started`): a tool graphrt switched off, so the call ends.
/// - `result`: the end; `is_error` / a `subtype` other than `success` is a failure, and
///   its `result` text is the answer when nothing streamed. Token usage is read when present.
#[derive(Debug, Default)]
pub struct CursorStreamParser {
    saw_delta: bool,
    emitted_text: bool,
    finished: bool,
}

impl CliOutputParser for CursorStreamParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        match event.get("type").and_then(Json::as_str) {
            Some("assistant") => Ok(self.assistant_deltas(&event)),
            Some("tool_call") => Err(tool_use_refused(LocalCli::CursorCli, &cursor_tool_name(&event))),
            Some("result") => self.result_deltas(&event),
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, _exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        Err(classify_failure(LocalCli::CursorCli, &failure_text(stderr, "it stopped without an answer")))
    }
}

impl CursorStreamParser {
    fn assistant_deltas(&mut self, event: &Json) -> Vec<ChatDelta> {
        let is_delta = event.get("timestamp_ms").is_some();
        if is_delta && event.get("model_call_id").is_some() {
            return Vec::new();
        }
        if !is_delta && self.saw_delta {
            return Vec::new();
        }
        self.saw_delta |= is_delta;
        let text: String = event
            .pointer("/message/content")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
            .filter(|block| block.get("type").and_then(Json::as_str) == Some("text"))
            .map(|block| string_at(block, "text"))
            .collect();
        if text.is_empty() {
            return Vec::new();
        }
        let text = if !is_delta && self.emitted_text { format!("\n\n{text}") } else { text };
        self.emitted_text = true;
        vec![ChatDelta::Text(text)]
    }

    fn result_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        self.finished = true;
        let is_error = event.get("is_error").and_then(Json::as_bool).unwrap_or(false)
            || event.get("subtype").and_then(Json::as_str).is_some_and(|subtype| subtype != "success");
        let result_text = string_at(event, "result");
        if is_error {
            let message = if result_text.is_empty() { "it reported an error".to_owned() } else { result_text };
            return Err(classify_failure(LocalCli::CursorCli, &message));
        }
        let mut deltas = Vec::new();
        if !self.emitted_text && !result_text.is_empty() {
            deltas.push(ChatDelta::Text(result_text));
        }
        deltas.extend(event.get("usage").and_then(lenient_usage_delta));
        deltas.push(ChatDelta::Finish(FinishReason::Stop));
        Ok(deltas)
    }
}

/// `{"tool_call": {"readToolCall": {...}}}` → `readToolCall`; `{"function": {"name": …}}` → its name.
fn cursor_tool_name(event: &Json) -> String {
    let Some(tool_call) = event.get("tool_call").and_then(Json::as_object) else {
        return String::new();
    };
    if let Some(name) = tool_call.get("function").and_then(|function| function.get("name")).and_then(Json::as_str) {
        return name.to_owned();
    }
    tool_call.keys().next().cloned().unwrap_or_default()
}
