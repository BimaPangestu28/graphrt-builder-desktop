//! Claude Code (`claude`), Anthropic.
//!
//! Docs: <https://docs.claude.com/en/docs/claude-code/cli-reference> (flags),
//! <https://docs.claude.com/en/docs/claude-code/headless> (print mode, `stream-json`),
//! install: <https://docs.claude.com/en/docs/claude-code/setup>.
//!
//! Command line (print mode, no tools, nothing saved):
//! `claude -p --output-format stream-json --verbose --tools "" [--include-partial-messages]
//! [--no-session-persistence] [--strict-mcp-config] [--disable-slash-commands] [--safe-mode]
//! [--model <alias>] [--system-prompt-file <workdir>/instructions.txt]`
//! (bracketed flags only when the installed version's `--help` lists them). The prompt
//! goes through stdin.
//!
//! Output (`stream-json`): one JSON event per line. Answer text comes from
//! `stream_event` `text_delta`s (with `--include-partial-messages`) or else from
//! `assistant` messages; the final `result` event carries usage, or the error
//! (`is_error: true`). Sign-in: `claude auth status --json` (`loggedIn`).

use std::path::Path;
use std::sync::OnceLock;

use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::super::adapter::{CallPlan, CliAdapter, CliInfo, InstructionsDelivery};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::{
    classify_failure, failure_text, json_text, parse_json_line, string_at, tool_use_refused, u64_at, usage_delta,
    CliOutputParser,
};
use super::super::process::QuickOutput;
use super::super::{LocalCli, SignInState, CLI_DEFAULT_MODEL};
use crate::model_catalog::AvailableModel;

pub struct ClaudeCodeAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "Claude Code",
    binary_names: &["claude"],
    install_url: "https://docs.claude.com/en/docs/claude-code/setup",
    provider_name: "claude-code-cli",
    enabled_setting_key: "local_cli_enabled.claude-code-cli",
    sign_in_hint: "open Terminal, run `claude` and sign in",
    plan_name: "Claude",
};

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

/// Aliases every Claude Code version since 1.0 understands.
const CLAUDE_BASE_ALIASES: [&str; 3] = ["sonnet", "opus", "haiku"];

impl CliAdapter for ClaudeCodeAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn sign_in_args(&self) -> Option<&'static [&'static str]> {
        Some(&["auth", "status", "--json"])
    }

    fn parse_sign_in(&self, output: &QuickOutput) -> SignInState {
        parse_claude_auth_status(&output.stdout)
    }

    fn model_aliases_from_help(&self, help: &str) -> Vec<String> {
        claude_model_aliases(help)
    }

    fn instructions_delivery(&self) -> InstructionsDelivery {
        InstructionsDelivery::FileFlag("--system-prompt-file")
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        _workdir: &Path,
        instructions_path: Option<&Path>,
    ) -> CallPlan {
        let mut args: Vec<String> =
            ["-p", "--output-format", "stream-json", "--verbose", "--tools", ""].map(str::to_owned).to_vec();
        args.extend(
            CLAUDE_OPTIONAL_FLAGS.iter().filter(|flag| detection.supports(flag)).map(|flag| (*flag).to_owned()),
        );
        if let Some(model) = explicit_model(model) {
            args.extend(["--model".to_owned(), model.to_owned()]);
        }
        if let Some(instructions_path) = instructions_path {
            args.extend(["--system-prompt-file".to_owned(), instructions_path.display().to_string()]);
        }
        CallPlan { args, ..CallPlan::default() }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(ClaudeStreamParser::new(LocalCli::ClaudeCode, false))
    }

    fn list_models(&self, detection: &Detection) -> Vec<AvailableModel> {
        claude_models(&detection.model_aliases)
    }
}

/// `claude auth status --json`: only `loggedIn` is read (the rest names the account).
pub fn parse_claude_auth_status(stdout: &str) -> SignInState {
    let logged_in = serde_json::from_str::<Json>(stdout.trim())
        .ok()
        .and_then(|status| status.get("loggedIn").and_then(Json::as_bool));
    match logged_in {
        Some(true) => SignInState::SignedIn,
        Some(false) => SignInState::SignedOut,
        None => SignInState::Unknown,
    }
}

/// The quoted aliases in the `--model` description of `claude --help`
/// ("Use an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')").
pub fn claude_model_aliases(help: &str) -> Vec<String> {
    static ALIAS: OnceLock<regex::Regex> = OnceLock::new();
    let alias = ALIAS.get_or_init(|| regex::Regex::new(r"'([a-z][a-z0-9.-]*)'").expect("alias pattern is valid"));
    let Some((_, after_flag)) = help.split_once("--model <") else {
        return Vec::new();
    };
    let description = after_flag.split("\n  -").next().unwrap_or_default();
    alias.captures_iter(description).map(|captures| captures[1].to_owned()).collect()
}

/// Claude Code aliases as models: `sonnet` → "Sonnet (latest)".
pub fn claude_models(help_aliases: &[String]) -> Vec<AvailableModel> {
    let mut aliases: Vec<String> = CLAUDE_BASE_ALIASES.iter().map(|alias| (*alias).to_owned()).collect();
    for alias in help_aliases {
        if !aliases.contains(alias) && alias != CLI_DEFAULT_MODEL {
            aliases.push(alias.clone());
        }
    }
    aliases
        .into_iter()
        .map(|alias| AvailableModel { display_name: Some(alias_display_name(&alias)), id: alias, parameter_millions: None })
        .collect()
}

fn alias_display_name(alias: &str) -> String {
    let mut characters = alias.chars();
    let capitalized: String =
        characters.next().map(|first| first.to_uppercase().chain(characters).collect()).unwrap_or_default();
    format!("{capitalized} (latest)")
}

/// Claude Code `stream-json` events; Qwen Code prints the same shape
/// (`adapters/qwen.rs`), so it reuses this parser with tool use refused.
#[derive(Debug)]
pub struct ClaudeStreamParser {
    cli: LocalCli,
    /// Qwen Code mode: a `tool_use` block ends the call (tools graphrt excluded), and so
    /// does the `result` (Qwen may keep finishing background memory tasks afterwards).
    refuses_tool_use: bool,
    saw_text_delta: bool,
    emitted_text: bool,
    finished: bool,
}

impl ClaudeStreamParser {
    /// The parser of `cli`'s Claude-Code-style `stream-json` output.
    pub fn new(cli: LocalCli, refuses_tool_use: bool) -> Self {
        Self { cli, refuses_tool_use, saw_text_delta: false, emitted_text: false, finished: false }
    }
}

impl CliOutputParser for ClaudeStreamParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        match event.get("type").and_then(Json::as_str) {
            Some("stream_event") => self.stream_event_deltas(event.get("event").unwrap_or(&Json::Null)),
            Some("assistant") => self.assistant_deltas(&event),
            Some("result") => self.result_deltas(&event),
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, _exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        Err(classify_failure(self.cli, &failure_text(stderr, "it stopped without an answer")))
    }

    fn is_complete(&self) -> bool {
        self.finished && self.refuses_tool_use
    }
}

impl ClaudeStreamParser {
    fn stream_event_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        if event.get("type").and_then(Json::as_str) == Some("content_block_start") {
            let block = event.get("content_block").unwrap_or(&Json::Null);
            self.refuse_tool_use(block)?;
            return Ok(Vec::new());
        }
        if event.get("type").and_then(Json::as_str) != Some("content_block_delta") {
            return Ok(Vec::new());
        }
        let delta = event.get("delta").unwrap_or(&Json::Null);
        Ok(match delta.get("type").and_then(Json::as_str) {
            Some("text_delta") => {
                self.saw_text_delta = true;
                let text = string_at(delta, "text");
                if text.is_empty() {
                    return Ok(Vec::new());
                }
                self.emitted_text = true;
                vec![ChatDelta::Text(text)]
            }
            Some("thinking_delta") => {
                let thinking = string_at(delta, "thinking");
                if thinking.is_empty() {
                    Vec::new()
                } else {
                    vec![ChatDelta::Reasoning(thinking)]
                }
            }
            _ => Vec::new(),
        })
    }

    /// `Err` for a `tool_use` content block when this CLI's tools are refused.
    fn refuse_tool_use(&self, block: &Json) -> Result<(), LlmError> {
        if self.refuses_tool_use && block.get("type").and_then(Json::as_str) == Some("tool_use") {
            return Err(tool_use_refused(self.cli, &string_at(block, "name")));
        }
        Ok(())
    }

    /// Whole assistant messages: their text is the answer only when nothing streamed.
    fn assistant_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        let mut blocks = event.pointer("/message/content").and_then(Json::as_array).into_iter().flatten();
        blocks.try_for_each(|block| self.refuse_tool_use(block))?;
        if self.saw_text_delta || event.get("error").is_some_and(|error| !error.is_null()) {
            return Ok(Vec::new());
        }
        let blocks = event.pointer("/message/content").and_then(Json::as_array).into_iter().flatten();
        let texts: Vec<ChatDelta> = blocks
            .filter(|block| block.get("type").and_then(Json::as_str) == Some("text"))
            .map(|block| string_at(block, "text"))
            .filter(|text| !text.is_empty())
            .map(ChatDelta::Text)
            .collect();
        self.emitted_text |= !texts.is_empty();
        Ok(texts)
    }

    fn result_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        self.finished = true;
        let is_error = event.get("is_error").and_then(Json::as_bool).unwrap_or(false)
            || event.get("subtype").and_then(Json::as_str).is_some_and(|subtype| subtype != "success");
        if is_error {
            return Err(classify_failure(self.cli, &claude_error_text(event)));
        }
        let mut deltas = Vec::new();
        let result_text = string_at(event, "result");
        if !self.emitted_text && !result_text.is_empty() {
            deltas.push(ChatDelta::Text(result_text));
        }
        if let Some(usage) = event.get("usage") {
            let prompt_tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
                .iter()
                .map(|field| u64_at(usage, field))
                .sum::<u64>();
            deltas.push(usage_delta(prompt_tokens, u64_at(usage, "output_tokens")));
        }
        let finish = match event.get("stop_reason").and_then(Json::as_str) {
            Some("max_tokens") => FinishReason::Length,
            _ => FinishReason::Stop,
        };
        deltas.push(ChatDelta::Finish(finish));
        Ok(deltas)
    }
}

fn claude_error_text(event: &Json) -> String {
    let result = string_at(event, "result");
    if !result.is_empty() {
        return result;
    }
    let errors: Vec<String> =
        event.get("errors").and_then(Json::as_array).into_iter().flatten().filter_map(json_text).collect();
    if !errors.is_empty() {
        return errors.join("; ");
    }
    if let Some(message) = event.pointer("/error/message").and_then(Json::as_str).filter(|text| !text.is_empty()) {
        return message.to_owned();
    }
    match event.get("subtype").and_then(Json::as_str) {
        Some("error_max_turns") => "it stopped after too many turns".to_owned(),
        Some(subtype) => subtype.replace('_', " "),
        None => "it reported an error".to_owned(),
    }
}
