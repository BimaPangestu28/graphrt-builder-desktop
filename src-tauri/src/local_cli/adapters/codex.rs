//! OpenAI Codex CLI (`codex`).
//!
//! Docs: <https://developers.openai.com/codex/cli> (install),
//! <https://developers.openai.com/codex/cli/reference> (flags),
//! <https://developers.openai.com/codex/noninteractive> (`codex exec`, `--json` events).
//!
//! <https://learn.chatgpt.com/docs/config-file/config-reference> (`features.*`,
//! `web_search`, `approval_policy`, `shell_environment_policy`),
//! <https://learn.chatgpt.com/docs/non-interactive-mode> (exec sandbox,
//! `--ignore-user-config`, `item.*` events).
//!
//! Command line (non-interactive, read-only sandbox, no tools, nothing saved):
//! `codex exec --json --skip-git-repo-check --sandbox read-only --color never
//! [--ephemeral] [--ignore-user-config] -c approval_policy="never"
//! -c shell_environment_policy.inherit="none" -c web_search="disabled"
//! -c tools.web_search=false -c features.<tool feature>=false ... -C <workdir>
//! [-m <model>] -` (`-` reads the prompt from stdin; the bracketed flags only when
//! `codex exec --help` lists them). Codex takes no system prompt flag: the instructions
//! go on top of the prompt.
//!
//! Why so many switches: `--sandbox read-only` still lets Codex run shell commands that
//! READ the whole disk, and exec mode never asks first. `features.shell_tool=false` and
//! `features.unified_exec=false` remove its command tools; the other `features.*`
//! switches remove images, browser, computer use, apps, plugins, hooks and sub-agents;
//! `--ignore-user-config` drops the user's own MCP servers and hooks (they run outside
//! the sandbox). Features go through `-c features.<name>=false`, not `--disable <name>`:
//! `--disable` refuses names the installed version does not know, `-c` ignores them, so
//! one list fits every version. That also means a renamed feature is silently left on,
//! hence the event guard below and [`CODEX_OUTPUT_NEEDS_SEND_APPROVAL`].
//!
//! Output (`exec --json`): one JSON event per line. The answer is the `agent_message`
//! item of `item.completed`; `turn.completed` carries usage, `turn.failed` the error.
//! The older `{"msg": {...}}` event shape is read too. Any other item (a
//! `command_execution`, `mcp_tool_call`, `web_search`, `file_change`, ...) or legacy
//! command / tool event stops the call: graphrt blocks it. Sign-in: `codex login status`.
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
    classify_failure, failure_text, json_text, parse_json_line, string_at, tool_use_refused, u64_at, usage_delta,
    CliOutputParser,
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

/// Codex features that give the model a tool, switched off on every call
/// (`-c features.<name>=false`; names an installed version does not know are ignored).
pub const DISABLED_FEATURES: &[&str] = &[
    "shell_tool",
    "unified_exec",
    "shell_snapshot",
    "code_mode",
    "js_repl",
    "view_image",
    "image_generation",
    "apps",
    "plugins",
    "remote_plugin",
    "browser_use",
    "browser_use_external",
    "in_app_browser",
    "computer_use",
    "multi_agent",
    "hooks",
    "memories",
    "tool_suggest",
    "skill_mcp_dependency_install",
    "workspace_dependencies",
    "web_search_request",
    "web_search_cached",
];

/// Config overrides besides the features: never ask (exec mode never does anyway), give a
/// command no environment, and no web search (current and older config keys).
const CONFIG_OVERRIDES: &[&str] = &[
    "approval_policy=\"never\"",
    "shell_environment_policy.inherit=\"none\"",
    "web_search=\"disabled\"",
    "tools.web_search=false",
];

/// Item types of `exec --json` that are only the answer, never a tool.
const ANSWER_ITEM_TYPES: &[&str] = &["agent_message", "assistant_message", "reasoning", "todo_list", "error"];

/// Legacy `msg` event types that mean a shell command started.
const LEGACY_COMMAND_EVENTS: &[&str] =
    &["exec_command_begin", "exec_command_output_delta", "exec_command_end", "exec_approval_request"];

/// Legacy `msg` event types that mean another tool started.
const LEGACY_TOOL_EVENTS: &[&str] = &[
    "mcp_tool_call_begin",
    "mcp_tool_call_end",
    "web_search_begin",
    "web_search_end",
    "patch_apply_begin",
    "apply_patch_approval_request",
    "view_image_tool_call",
];

/// Whether data from a Codex-backed step must be approved before a sending step uses it.
///
/// `true`: the switches above are the documented way to remove Codex's tools, but they
/// are matched by feature name and silently ignored when a version renames one, and a
/// command can run (and read the disk) before its event reaches graphrt's guard. So a
/// prompt-injected page summarised by Codex could still leak what such a command read.
pub const CODEX_OUTPUT_NEEDS_SEND_APPROVAL: bool = true;

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
        if detection.supports("--ignore-user-config") {
            args.push("--ignore-user-config".to_owned());
        }
        for override_value in CONFIG_OVERRIDES {
            args.extend(["-c".to_owned(), (*override_value).to_owned()]);
        }
        for feature in DISABLED_FEATURES {
            args.extend(["-c".to_owned(), format!("features.{feature}=false")]);
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

    fn output_needs_send_approval(&self) -> bool {
        CODEX_OUTPUT_NEEDS_SEND_APPROVAL
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
            Some("item.started" | "item.updated") => {
                refuse_tool_item(event.get("item").unwrap_or(&Json::Null))?;
                Ok(Vec::new())
            }
            Some("item.completed") => {
                let item = event.get("item").unwrap_or(&Json::Null);
                refuse_tool_item(item)?;
                Ok(self.item_deltas(item))
            }
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
            Some(event_type) if LEGACY_COMMAND_EVENTS.contains(&event_type) => Err(command_refused()),
            Some(event_type) if LEGACY_TOOL_EVENTS.contains(&event_type) => {
                Err(tool_use_refused(LocalCli::Codex, event_type))
            }
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

/// Stops the call when an `exec --json` item is anything but the answer: a command,
/// MCP tool call, web search, file change, or an item type this parser does not know.
fn refuse_tool_item(item: &Json) -> Result<(), LlmError> {
    let item_type = item.get("type").or_else(|| item.get("item_type")).and_then(Json::as_str).unwrap_or_default();
    if item_type.is_empty() || ANSWER_ITEM_TYPES.contains(&item_type) {
        return Ok(());
    }
    if item_type == "command_execution" {
        return Err(command_refused());
    }
    let tool_name = match (item.get("server").and_then(Json::as_str), item.get("tool").and_then(Json::as_str)) {
        (Some(server), Some(tool)) => format!("{server}.{tool}"),
        (None, Some(tool)) => tool.to_owned(),
        _ => item_type.to_owned(),
    };
    Err(tool_use_refused(LocalCli::Codex, &tool_name))
}

/// The error ending a call in which Codex started a shell command (the command itself is
/// not repeated: it may name what it tried to read).
fn command_refused() -> LlmError {
    LlmError::BadRequest(
        "Codex tried to run a command; graphrt blocks that, so graphrt stopped it: pick an API model for steps \
         that need tools"
            .to_owned(),
    )
}
