//! CLI output into graphrt deltas: the parser contract and the helpers every adapter's
//! parser shares (each CLI's own parser lives in its `adapters/` file).
//!
//! Lines that are not JSON (banners, warnings) are skipped. Error text is scrubbed of
//! home folders, emails and anything token-like before it reaches the user.

use std::sync::LazyLock;

use graphrt_core::event::Usage;
use graphrt_llm::{ChatDelta, LlmError};
use serde_json::Value as Json;

use super::LocalCli;

/// Reads one CLI's stdout line by line.
pub trait CliOutputParser: Send {
    /// Deltas for one stdout line. `Err` ends the call with that error.
    fn parse_line(&mut self, line: &str) -> Result<Vec<ChatDelta>, LlmError>;
    /// Called once stdout has closed, with whether the process exited successfully
    /// and the end of what it printed on stderr.
    fn finish(&mut self, exited_successfully: bool, stderr: &str) -> Result<Vec<ChatDelta>, LlmError>;
    /// True once the answer is complete and the process may be stopped without waiting
    /// for it to exit (a CLI that lingers on background work after its final event).
    fn is_complete(&self) -> bool {
        false
    }
}

/// The parser for `cli`'s output.
pub fn parser_for(cli: LocalCli) -> Box<dyn CliOutputParser> {
    cli.adapter().parser()
}

/// The error ending a call whose CLI tried to use a tool although graphrt switched them
/// off (its sandbox / approval settings should already have refused it).
pub fn tool_use_refused(cli: LocalCli, tool_name: &str) -> LlmError {
    let tool = if tool_name.trim().is_empty() {
        "a tool".to_owned()
    } else {
        format!("the `{}` tool", short_detail(tool_name))
    };
    LlmError::BadRequest(format!(
        "{} tried to use {tool}, which graphrt does not allow, so graphrt stopped it: pick an API model for steps that need tools",
        cli.display_name()
    ))
}

pub fn parse_json_line(line: &str) -> Option<Json> {
    let line = line.trim();
    if !line.starts_with('{') {
        return None;
    }
    serde_json::from_str(line).ok()
}

pub fn string_at(value: &Json, field: &str) -> String {
    value.get(field).and_then(Json::as_str).unwrap_or_default().to_owned()
}

pub fn u64_at(value: &Json, field: &str) -> u64 {
    value.get(field).and_then(Json::as_u64).unwrap_or(0)
}

pub fn json_text(value: &Json) -> Option<String> {
    match value {
        Json::String(text) => Some(text.clone()),
        Json::Object(object) => object.get("message").and_then(Json::as_str).map(str::to_owned),
        _ => None,
    }
}

pub fn usage_delta(prompt_tokens: u64, completion_tokens: u64) -> ChatDelta {
    ChatDelta::Usage(Usage { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens })
}

/// The first of `fields` holding a number (CLIs spell token counts differently).
pub fn first_u64(value: &Json, fields: &[&str]) -> u64 {
    fields.iter().find_map(|field| value.get(*field).and_then(Json::as_u64)).unwrap_or(0)
}

/// Usage from an object whose token fields are not documented exactly: snake_case or
/// camelCase input / output counts. `None` when it has neither.
pub fn lenient_usage_delta(usage: &Json) -> Option<ChatDelta> {
    let prompt_tokens = first_u64(usage, &["input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "input"]);
    let completion_tokens =
        first_u64(usage, &["output_tokens", "outputTokens", "completion_tokens", "completionTokens", "output"]);
    (prompt_tokens > 0 || completion_tokens > 0).then(|| usage_delta(prompt_tokens, completion_tokens))
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
        "auth method",
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
