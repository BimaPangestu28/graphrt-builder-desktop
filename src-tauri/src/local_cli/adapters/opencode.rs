//! OpenCode (`opencode`, github.com/anomalyco/opencode, formerly sst/opencode).
//!
//! Docs and source (verified against v1.19.6, 2026-11):
//! - install: <https://opencode.ai/docs/> (`curl -fsSL https://opencode.ai/install | bash`,
//!   `npm i -g opencode-ai`, `brew install anomalyco/tap/opencode`)
//! - `opencode run`, `opencode models`, `opencode auth list`: <https://opencode.ai/docs/cli/>
//!   and `packages/opencode/src/cli/cmd/run.ts` (piped stdin is read to its end and is the
//!   message when no message argument is given; `--format json` prints one event per line)
//! - permissions: <https://opencode.ai/docs/permissions/> (`"*": "deny"`; the last matching
//!   rule wins and a `*` deny removes the tool from what the model sees; `run` auto-rejects
//!   anything left at "ask")
//! - agents and config: <https://opencode.ai/docs/agents/>, <https://opencode.ai/docs/config/>
//!   (`OPENCODE_CONFIG_CONTENT` inline config, loaded after the user's own config;
//!   `OPENCODE_PERMISSION`; `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`,
//!   `OPENCODE_DISABLE_PROJECT_CONFIG`)
//! - models: <https://opencode.ai/docs/models/> (`provider/model` ids)
//!
//! Command line (prompt on stdin, a graphrt agent with every tool denied):
//! `opencode run --format json --agent graphrt-text-only [--pure] [-m <provider/model>]`
//! with `OPENCODE_CONFIG_CONTENT` defining that agent (`permission: {"*": "deny"}`, a
//! plain-text system prompt replacing OpenCode's coding prompt), `OPENCODE_PERMISSION`
//! denying everything for any other agent too, and CLAUDE.md / project config loading
//! off. `--auto` (and its aliases) is never passed. The instructions go on top of the prompt.
//!
//! Output events: `text` (`part.text`, one final text per part), `reasoning`,
//! `step_start`, `step_finish` (`part.tokens.input` / `.output`), `tool_use` and `error`
//! (`error.name`, `error.data.message`); the process exits 1 after an error. Sign-in:
//! `opencode auth list` prints "N credentials" and the provider variables that are set,
//! by name only. Models: `opencode models` (one `provider/model` per line, read from the
//! local models.dev cache, no model call).

use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{CallPlan, CliAdapter, CliInfo, PLAIN_TEXT_PREAMBLE};
use super::super::command::{explicit_model, is_valid_model_name};
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, first_u64, parse_json_line, string_at, tool_use_refused, usage_delta,
    CliOutputParser,
};
use super::super::process::{run_quick, QuickOutput};
use super::super::{LocalCli, SignInState};
use crate::model_catalog::AvailableModel;

pub struct OpenCodeAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "OpenCode",
    binary_names: &["opencode"],
    install_url: "https://opencode.ai/docs/",
    provider_name: "opencode-cli",
    enabled_setting_key: "local_cli_enabled.opencode-cli",
    sign_in_hint: "open Terminal, run `opencode auth login` and sign in to a provider",
    plan_name: "AI provider",
};

/// A name no user agent is likely to have, so graphrt's settings are not merged into one.
pub const AGENT_NAME: &str = "graphrt-text-only";
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
/// `opencode models` lists every model of every configured provider; a picker needs fewer.
const MAX_LISTED_MODELS: usize = 200;

impl CliAdapter for OpenCodeAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn help_args(&self) -> &'static [&'static str] {
        &["run", "--help"]
    }

    fn sign_in_args(&self) -> Option<&'static [&'static str]> {
        Some(&["auth", "list"])
    }

    fn parse_sign_in(&self, output: &QuickOutput) -> SignInState {
        parse_opencode_auth_list(&format!("{}\n{}", output.stdout, output.stderr))
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        _workdir: &Path,
        _instructions_path: Option<&Path>,
    ) -> CallPlan {
        let mut args: Vec<String> = ["run", "--format", "json", "--agent", AGENT_NAME].map(str::to_owned).to_vec();
        if detection.supports("--pure") {
            args.push("--pure".to_owned());
        }
        if let Some(model) = explicit_model(model) {
            args.extend(["-m".to_owned(), model.to_owned()]);
        }
        let env = [
            ("OPENCODE_CONFIG_CONTENT", agent_config()),
            ("OPENCODE_PERMISSION", r#"{"*":"deny"}"#.to_owned()),
            ("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT", "1".to_owned()),
            ("OPENCODE_DISABLE_PROJECT_CONFIG", "1".to_owned()),
        ]
        .map(|(name, value)| (name.to_owned(), value))
        .to_vec();
        CallPlan { args, env, files: Vec::new() }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(OpenCodeJsonParser::default())
    }

    fn list_models(&self, detection: &Detection) -> Vec<AvailableModel> {
        opencode_models(detection)
    }
}

/// The inline config defining graphrt's agent: primary, every tool denied, and a fixed
/// plain-text system prompt (no user data: the instructions travel on stdin).
pub fn agent_config() -> String {
    serde_json::json!({
        "agent": {
            AGENT_NAME: {
                "mode": "primary",
                "description": "graphrt: answers text only, no tools",
                "prompt": PLAIN_TEXT_PREAMBLE.trim(),
                "permission": { "*": "deny" },
            }
        }
    })
    .to_string()
}

/// `opencode auth list`: "N credentials" (and "M environment variables") above or below
/// the provider names. Any credential or provider variable counts as signed in; none is
/// not conclusive (OpenCode's own free models need none).
pub fn parse_opencode_auth_list(output: &str) -> SignInState {
    static COUNT: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)\b(\d+)\s+(?:credentials?|environment variables?)\b").expect("valid count pattern")
    });
    let counts: Vec<u64> = COUNT.captures_iter(output).filter_map(|captures| captures[1].parse::<u64>().ok()).collect();
    if counts.iter().any(|count| *count > 0) {
        SignInState::SignedIn
    } else {
        SignInState::Unknown
    }
}

fn opencode_models(detection: &Detection) -> Vec<AvailableModel> {
    static CACHE: Mutex<Option<(PathBuf, Vec<AvailableModel>)>> = Mutex::new(None);
    let Some(binary) = &detection.binary else { return Vec::new() };
    if let Ok(cache) = CACHE.lock() {
        if let Some((_, models)) = cache.as_ref().filter(|(cached_binary, _)| cached_binary == binary) {
            return models.clone();
        }
    }
    let output = run_quick(binary, &["models"], detection.child_path.as_deref(), MODELS_TIMEOUT);
    let models = output.filter(|output| output.success).map(|output| parse_opencode_models(&output.stdout));
    let models = models.unwrap_or_default();
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((binary.clone(), models.clone()));
    }
    models
}

/// `opencode models`: one `provider/model` per line (other lines are skipped).
pub fn parse_opencode_models(stdout: &str) -> Vec<AvailableModel> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| line.contains('/') && !line.contains(char::is_whitespace) && is_valid_model_name(line))
        .take(MAX_LISTED_MODELS)
        .map(|line| AvailableModel { id: line.to_owned(), display_name: None, parameter_millions: None })
        .collect()
}

/// OpenCode `run --format json` events (`{"type", "timestamp", "sessionID", "part" | "error"}`).
#[derive(Debug, Default)]
pub struct OpenCodeJsonParser {
    text_parts: usize,
    prompt_tokens: u64,
    completion_tokens: u64,
    saw_step_finish: bool,
    finish_reason: Option<FinishReason>,
}

impl CliOutputParser for OpenCodeJsonParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        let part = event.get("part").unwrap_or(&Json::Null);
        match event.get("type").and_then(Json::as_str) {
            Some("text") => Ok(self.text_deltas(part)),
            Some("reasoning") => {
                let text = string_at(part, "text");
                Ok(if text.is_empty() { Vec::new() } else { vec![ChatDelta::Reasoning(text)] })
            }
            Some("step_finish") => {
                self.read_step_finish(part);
                Ok(Vec::new())
            }
            Some("tool_use") => Err(tool_use_refused(LocalCli::OpenCode, &string_at(part, "tool"))),
            Some("error") => Err(classify_failure(LocalCli::OpenCode, &opencode_error_text(&event))),
            _ => Ok(Vec::new()),
        }
    }

    /// OpenCode has no closing event: the run ends when the session is idle and the
    /// process exits (1 after an error, which then is in stderr).
    fn finish(&mut self, exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if !exited_successfully || (self.text_parts == 0 && !self.saw_step_finish) {
            return Err(classify_failure(LocalCli::OpenCode, &failure_text(stderr, "it stopped without an answer")));
        }
        let mut deltas = Vec::new();
        if self.saw_step_finish {
            deltas.push(usage_delta(self.prompt_tokens, self.completion_tokens));
        }
        deltas.push(ChatDelta::Finish(self.finish_reason.take().unwrap_or(FinishReason::Stop)));
        Ok(deltas)
    }
}

impl OpenCodeJsonParser {
    /// Each `text` event is one finished text part; synthetic / ignored parts are not the answer.
    fn text_deltas(&mut self, part: &Json) -> Vec<ChatDelta> {
        let is_hidden =
            ["synthetic", "ignored"].iter().any(|flag| part.get(*flag).and_then(Json::as_bool) == Some(true));
        let text = string_at(part, "text");
        if is_hidden || text.is_empty() {
            return Vec::new();
        }
        self.text_parts += 1;
        vec![ChatDelta::Text(if self.text_parts > 1 { format!("\n\n{text}") } else { text })]
    }

    /// Token counts add up over the steps of one run.
    fn read_step_finish(&mut self, part: &Json) {
        self.saw_step_finish = true;
        let tokens = part.get("tokens").unwrap_or(&Json::Null);
        let cache = tokens.get("cache").unwrap_or(&Json::Null);
        self.prompt_tokens +=
            first_u64(tokens, &["input"]) + first_u64(cache, &["read"]) + first_u64(cache, &["write"]);
        self.completion_tokens += first_u64(tokens, &["output"]);
        if part.get("reason").and_then(Json::as_str) == Some("length") {
            self.finish_reason = Some(FinishReason::Length);
        }
    }
}

/// `error.data.message`, else `error.name` ("ProviderAuthError").
fn opencode_error_text(event: &Json) -> String {
    let error = event.get("error").unwrap_or(&Json::Null);
    let message = error.pointer("/data/message").and_then(Json::as_str).unwrap_or_default();
    let name = string_at(error, "name");
    match (message.is_empty(), name.as_str()) {
        (false, "ProviderAuthError") => format!("not signed in: {message}"),
        (false, _) => message.to_owned(),
        (true, "") => "it reported an error".to_owned(),
        (true, "ProviderAuthError") => "authentication failed".to_owned(),
        (true, "MessageOutputLengthError") => "the answer was too long".to_owned(),
        (true, other) => other.to_owned(),
    }
}
