//! OpenAI Codex CLI (`codex`).
//!
//! Docs: <https://developers.openai.com/codex/cli> (install),
//! <https://developers.openai.com/codex/cli/reference> (flags),
//! <https://developers.openai.com/codex/noninteractive> (`codex exec`, `--json` events).
//!
//! Command line (non-interactive, read-only sandbox, nothing saved):
//! `codex exec --json --skip-git-repo-check --sandbox read-only --color never
//! [--ephemeral] -C <workdir> [-m <model>] -` (`-` reads the prompt from stdin;
//! `--ephemeral` only when `codex exec --help` lists it). Codex takes no system prompt
//! flag: the instructions go on top of the prompt.
//!
//! Output (`exec --json`): one JSON event per line. The answer is the `agent_message`
//! item of `item.completed`; `turn.completed` carries usage, `turn.failed` the error.
//! The older `{"msg": {...}}` event shape is read too. Sign-in: `codex login status`.
//! Models: `codex debug models --bundled` (the bundled catalog, read locally).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{CallPlan, CliAdapter, CliInfo};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, json_text, parse_json_line, string_at, u64_at, usage_delta, CliOutputParser,
};
use super::super::process::{run_quick, QuickOutput};
use super::super::{LocalCli, SignInState};
use crate::model_catalog::AvailableModel;

pub struct CodexAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "Codex",
    binary_names: &["codex"],
    install_url: "https://developers.openai.com/codex/cli",
    provider_name: "codex-cli",
    enabled_setting_key: "local_cli_enabled.codex-cli",
    sign_in_hint: "open Terminal, run `codex login` and sign in",
    plan_name: "ChatGPT",
};

const CATALOG_TIMEOUT: Duration = Duration::from_secs(10);

impl CliAdapter for CodexAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn help_args(&self) -> &'static [&'static str] {
        &["exec", "--help"]
    }

    fn sign_in_args(&self) -> Option<&'static [&'static str]> {
        Some(&["login", "status"])
    }

    fn parse_sign_in(&self, output: &QuickOutput) -> SignInState {
        parse_codex_login_status(output.success, &format!("{}\n{}", output.stdout, output.stderr))
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        workdir: &Path,
        _instructions_path: Option<&Path>,
    ) -> CallPlan {
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
        CallPlan { args, ..CallPlan::default() }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(CodexJsonParser::default())
    }

    fn list_models(&self, detection: &Detection) -> Vec<AvailableModel> {
        codex_models(detection)
    }
}

/// `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1).
pub fn parse_codex_login_status(success: bool, output: &str) -> SignInState {
    let lowered = output.to_ascii_lowercase();
    if lowered.contains("not logged in") {
        SignInState::SignedOut
    } else if success && lowered.contains("logged in") {
        SignInState::SignedIn
    } else {
        SignInState::Unknown
    }
}

fn codex_models(detection: &Detection) -> Vec<AvailableModel> {
    static CACHE: Mutex<Option<(PathBuf, Vec<AvailableModel>)>> = Mutex::new(None);
    let Some(binary) = &detection.binary else { return Vec::new() };
    if let Ok(cache) = CACHE.lock() {
        if let Some((_, models)) = cache.as_ref().filter(|(cached_binary, _)| cached_binary == binary) {
            return models.clone();
        }
    }
    let output = run_quick(binary, &["debug", "models", "--bundled"], detection.child_path.as_deref(), CATALOG_TIMEOUT);
    let models =
        output.filter(|output| output.success).map(|output| parse_codex_catalog(&output.stdout)).unwrap_or_default();
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((binary.clone(), models.clone()));
    }
    models
}

/// The listed (not hidden) models of `codex debug models` output, in catalog order.
pub fn parse_codex_catalog(stdout: &str) -> Vec<AvailableModel> {
    let Ok(catalog) = serde_json::from_str::<Json>(stdout.trim()) else { return Vec::new() };
    let mut entries: Vec<&Json> = catalog.get("models").and_then(Json::as_array).into_iter().flatten().collect();
    entries.sort_by_key(|entry| entry.get("priority").and_then(Json::as_i64).unwrap_or(i64::MAX));
    entries
        .into_iter()
        .filter(|entry| entry.get("visibility").and_then(Json::as_str).is_none_or(|visibility| visibility == "list"))
        .filter_map(|entry| {
            let slug = entry.get("slug").and_then(Json::as_str)?.trim();
            let display_name = entry.get("display_name").and_then(Json::as_str).map(str::to_owned);
            (!slug.is_empty()).then(|| AvailableModel { id: slug.to_owned(), display_name })
        })
        .collect()
}

/// Codex `exec --json` events.
#[derive(Debug, Default)]
pub struct CodexJsonParser {
    message_count: usize,
    saw_legacy_delta: bool,
    finished: bool,
    /// Non-fatal `error` events (e.g. reconnecting); reported if the turn never completes.
    last_error: Option<String>,
}

impl CliOutputParser for CodexJsonParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        if let Some(legacy) = event.get("msg") {
            return self.legacy_deltas(legacy);
        }
        match event.get("type").and_then(Json::as_str) {
            Some("item.completed") => Ok(self.item_deltas(event.get("item").unwrap_or(&Json::Null))),
            Some("turn.completed") => {
                self.finished = true;
                let usage = event.get("usage").unwrap_or(&Json::Null);
                Ok(vec![
                    usage_delta(u64_at(usage, "input_tokens"), u64_at(usage, "output_tokens")),
                    ChatDelta::Finish(FinishReason::Stop),
                ])
            }
            Some("turn.failed") => {
                let message =
                    event.pointer("/error/message").and_then(json_text).unwrap_or_else(|| string_at(&event, "message"));
                Err(classify_failure(LocalCli::Codex, &message))
            }
            Some("error") => {
                self.last_error = json_text(event.get("message").unwrap_or(&Json::Null));
                Ok(Vec::new())
            }
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, _exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        let message = match &self.last_error {
            Some(message) => message.clone(),
            None => failure_text(stderr, "it stopped without an answer"),
        };
        Err(classify_failure(LocalCli::Codex, &message))
    }
}

impl CodexJsonParser {
    fn item_deltas(&mut self, item: &Json) -> Vec<ChatDelta> {
        let item_type = item.get("type").or_else(|| item.get("item_type")).and_then(Json::as_str);
        let text = string_at(item, "text");
        if text.is_empty() {
            return Vec::new();
        }
        match item_type {
            Some("agent_message" | "assistant_message") => self.message_deltas(text),
            Some("reasoning") => vec![ChatDelta::Reasoning(text)],
            _ => Vec::new(),
        }
    }

    /// Several agent messages in one turn are separated by a blank line.
    fn message_deltas(&mut self, text: String) -> Vec<ChatDelta> {
        self.message_count += 1;
        if self.message_count > 1 {
            vec![ChatDelta::Text(format!("\n\n{text}"))]
        } else {
            vec![ChatDelta::Text(text)]
        }
    }

    /// The `{"id": "...", "msg": {"type": ...}}` events of older Codex versions.
    fn legacy_deltas(&mut self, message: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        match message.get("type").and_then(Json::as_str) {
            Some("agent_message_delta") => {
                self.saw_legacy_delta = true;
                let delta = string_at(message, "delta");
                Ok(if delta.is_empty() { Vec::new() } else { vec![ChatDelta::Text(delta)] })
            }
            Some("agent_message") if !self.saw_legacy_delta => Ok(self.message_deltas(string_at(message, "message"))),
            Some("agent_reasoning") => Ok(vec![ChatDelta::Reasoning(string_at(message, "text"))]),
            Some("token_count") => {
                let usage = message.get("info").and_then(|info| info.get("total_token_usage")).unwrap_or(message);
                Ok(vec![usage_delta(u64_at(usage, "input_tokens"), u64_at(usage, "output_tokens"))])
            }
            Some("task_complete") => {
                self.finished = true;
                Ok(vec![ChatDelta::Finish(FinishReason::Stop)])
            }
            Some("error") => Err(classify_failure(LocalCli::Codex, &string_at(message, "message"))),
            _ => Ok(Vec::new()),
        }
    }
}
