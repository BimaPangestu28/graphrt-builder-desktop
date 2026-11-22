//! CLI output into graphrt deltas.
//!
//! - Claude Code `--output-format stream-json`: one JSON event per line. Answer text
//!   comes from `stream_event` `text_delta`s (with `--include-partial-messages`) or
//!   else from `assistant` messages; the final `result` event carries usage, or the
//!   error (`is_error: true`).
//! - Codex `exec --json`: one JSON event per line. The answer is the `agent_message`
//!   item of `item.completed`; `turn.completed` carries usage, `turn.failed` the error.
//!   The older `{"msg": {...}}` event shape is read too.
//!
//! Lines that are not JSON (banners, warnings) are skipped. Error text is scrubbed of
//! home folders, emails and anything token-like before it reaches the user.

use std::sync::LazyLock;

use graphrt_core::event::Usage;
use graphrt_llm::{ChatDelta, FinishReason, LlmError};
use serde_json::Value as Json;

use super::LocalCli;

/// Reads one CLI's stdout line by line.
pub trait CliOutputParser: Send {
    /// Deltas for one stdout line. `Err` ends the call with that error.
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError>;
    /// Called once stdout has closed, with whether the process exited successfully
    /// and the end of what it printed on stderr.
    fn finish(&mut self, exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError>;
}

/// The parser for `cli`'s JSON output.
pub fn parser_for(cli: LocalCli) -> Box<dyn CliOutputParser> {
    match cli {
        LocalCli::ClaudeCode => Box::new(ClaudeStreamParser::default()),
        LocalCli::Codex => Box::new(CodexJsonParser::default()),
    }
}

/// Claude Code `stream-json` events.
#[derive(Debug, Default)]
pub struct ClaudeStreamParser {
    saw_text_delta: bool,
    emitted_text: bool,
    finished: bool,
}

impl CliOutputParser for ClaudeStreamParser {
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError> {
        let Some(event) = parse_json_line(line) else {
            return Ok(Vec::new());
        };
        match event.get("type").and_then(Json::as_str) {
            Some("stream_event") => Ok(self.stream_event_deltas(event.get("event").unwrap_or(&Json::Null))),
            Some("assistant") => Ok(self.assistant_deltas(&event)),
            Some("result") => self.result_deltas(&event),
            _ => Ok(Vec::new()),
        }
    }

    fn finish(&mut self, _exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError> {
        if self.finished {
            return Ok(Vec::new());
        }
        Err(classify_failure(LocalCli::ClaudeCode, &failure_text(stderr, "it stopped without an answer")))
    }
}

impl ClaudeStreamParser {
    fn stream_event_deltas(&mut self, event: &Json) -> Vec<ChatDelta> {
        if event.get("type").and_then(Json::as_str) != Some("content_block_delta") {
            return Vec::new();
        }
        let delta = event.get("delta").unwrap_or(&Json::Null);
        match delta.get("type").and_then(Json::as_str) {
            Some("text_delta") => {
                self.saw_text_delta = true;
                let text = string_at(delta, "text");
                if text.is_empty() {
                    return Vec::new();
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
        }
    }

    /// Whole assistant messages: their text is the answer only when nothing streamed.
    fn assistant_deltas(&mut self, event: &Json) -> Vec<ChatDelta> {
        if self.saw_text_delta || event.get("error").is_some_and(|error| !error.is_null()) {
            return Vec::new();
        }
        let blocks = event.pointer("/message/content").and_then(Json::as_array).into_iter().flatten();
        let texts: Vec<ChatDelta> = blocks
            .filter(|block| block.get("type").and_then(Json::as_str) == Some("text"))
            .map(|block| string_at(block, "text"))
            .filter(|text| !text.is_empty())
            .map(ChatDelta::Text)
            .collect();
        self.emitted_text |= !texts.is_empty();
        texts
    }

    fn result_deltas(&mut self, event: &Json) -> Result<Vec<ChatDelta>, LlmError> {
        self.finished = true;
        let is_error = event.get("is_error").and_then(Json::as_bool).unwrap_or(false)
            || event.get("subtype").and_then(Json::as_str).is_some_and(|subtype| subtype != "success");
        if is_error {
            return Err(classify_failure(LocalCli::ClaudeCode, &claude_error_text(event)));
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
    match event.get("subtype").and_then(Json::as_str) {
        Some("error_max_turns") => "it stopped after too many turns".to_owned(),
        Some(subtype) => subtype.replace('_', " "),
        None => "it reported an error".to_owned(),
    }
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

fn parse_json_line(line: &str) -> Option<Json> {
    let line = line.trim();
    if !line.starts_with('{') {
        return None;
    }
    serde_json::from_str(line).ok()
}

fn string_at(value: &Json, field: &str) -> String {
    value.get(field).and_then(Json::as_str).unwrap_or_default().to_owned()
}

fn u64_at(value: &Json, field: &str) -> u64 {
    value.get(field).and_then(Json::as_u64).unwrap_or(0)
}

fn json_text(value: &Json) -> Option<String> {
    match value {
        Json::String(text) => Some(text.clone()),
        Json::Object(object) => object.get("message").and_then(Json::as_str).map(str::to_owned),
        _ => None,
    }
}

fn usage_delta(prompt_tokens: u64, completion_tokens: u64) -> ChatDelta {
    ChatDelta::Usage(Usage { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens })
}

/// Log prefixes like `2026-11-22T00:00:50.066285Z ERROR codex_login::auth::manager: `.
static LOG_PREFIX_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^\S+\s+(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+\S+:\s*").expect("valid log prefix pattern")
});

/// The last meaningful stderr line, or `fallback`.
pub fn failure_text(stderr: &str, fallback: &str) -> String {
    stderr
        .lines()
        .rev()
        .map(|line| LOG_PREFIX_PATTERN.replace(line.trim(), "").trim().to_owned())
        .find(|line| !line.is_empty() && !line.starts_with('}') && !line.starts_with('{'))
        .unwrap_or_else(|| fallback.to_owned())
}

/// Most characters of CLI error text shown to the user.
const MAX_ERROR_CHARS: usize = 300;

/// A CLI failure as a graphrt model error with a plain-language message.
pub fn classify_failure(cli: LocalCli, raw_message: &str) -> LlmError {
    let detail = short_detail(raw_message);
    let lowered = raw_message.to_ascii_lowercase();
    let name = cli.display_name();
    let has_any = |needles: &[&str]| needles.iter().any(|needle| lowered.contains(needle));
    if has_any(&[
        "not logged in",
        "log in",
        "login",
        "sign in",
        "signed out",
        "authenticat",
        "unauthorized",
        "invalid api key",
        "refresh token",
        "session has ended",
        "401",
    ]) {
        return LlmError::Auth(format!("{name} is not signed in on this computer: {} ({detail})", cli.sign_in_hint()));
    }
    if has_any(&[
        "rate limit",
        "usage limit",
        "limit reached",
        "too many requests",
        "429",
        "quota",
        "out of credits",
        "hit your limit",
    ]) {
        return LlmError::RateLimit {
            message: format!("{name} reached a limit of your {} plan ({detail})", cli.plan_name()),
            retry_after_ms: None,
        };
    }
    if lowered.contains("model")
        && has_any(&["not found", "not exist", "invalid", "not supported", "unknown", "not available"])
    {
        return LlmError::BadRequest(format!("{name} does not offer this model: {detail}"));
    }
    if has_any(&["unknown option", "unexpected argument", "unrecognized"]) {
        return LlmError::Config(format!("this {name} version is too old for graphrt: update it ({detail})"));
    }
    LlmError::BadRequest(format!("{name} failed: {detail}"))
}

/// One scrubbed line of at most [`MAX_ERROR_CHARS`].
fn short_detail(message: &str) -> String {
    let one_line = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let scrubbed = crate::crash_reports::scrub::Scrubber::new(None).scrub(&one_line);
    if scrubbed.chars().count() <= MAX_ERROR_CHARS {
        return scrubbed;
    }
    let mut shortened: String = scrubbed.chars().take(MAX_ERROR_CHARS).collect();
    shortened.push('…');
    shortened
}
