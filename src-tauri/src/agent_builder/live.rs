//! Live previews of a draft while the model writes it, for screens 03 and 04.
//!
//! The model's reply is a short plain-language opening, an `Agent name:` line
//! (new agents only) and a ```yaml document. [`DraftWatcher`] reads the stream
//! as it arrives and turns it into a [`DraftPreview`]: the opening so far, the
//! titles of the steps written so far, and a token count. Previews are sent at
//! most every [`MIN_PREVIEW_INTERVAL`], plus whenever a new step title appears.

use std::time::{Duration, Instant};

use graphrt_llm::ChatDelta;
use serde::{Deserialize, Serialize};

use super::prompt::AGENT_NAME_PREFIX;

/// At most ~8 previews a second: enough to feel live without flooding the UI.
pub(super) const MIN_PREVIEW_INTERVAL: Duration = Duration::from_millis(120);

/// Rough characters per token, for providers that report usage only at the end.
const CHARS_PER_TOKEN: usize = 4;

/// What the model has written so far.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPreview {
    /// The plain-language opening, growing as it streams.
    pub explanation: String,
    /// Titles of the steps written so far, in order.
    pub step_titles: Vec<String>,
    /// Output tokens so far (the provider's count when reported, else an estimate).
    pub output_tokens: u32,
}

/// Accumulates one model reply and decides when a new preview is worth sending.
#[derive(Debug)]
pub(super) struct DraftWatcher {
    text: String,
    reported_output_tokens: Option<u32>,
    last_sent: Option<Instant>,
    last_sent_title_count: usize,
}

impl DraftWatcher {
    pub(super) fn new() -> Self {
        Self { text: String::new(), reported_output_tokens: None, last_sent: None, last_sent_title_count: 0 }
    }

    /// Takes one stream delta; returns a preview when one should be sent now.
    pub(super) fn push(&mut self, delta: &ChatDelta, now: Instant) -> Option<DraftPreview> {
        match delta {
            ChatDelta::Text(text) => self.text.push_str(text),
            // Some providers send an all-zero snapshot first; keep estimating until a real count arrives.
            ChatDelta::Usage(usage) if usage.completion_tokens > 0 => {
                self.reported_output_tokens = Some(u32::try_from(usage.completion_tokens).unwrap_or(u32::MAX));
            }
            _ => return None,
        }
        let preview = self.preview();
        let has_new_title = preview.step_titles.len() > self.last_sent_title_count;
        let interval_passed = self.last_sent.is_none_or(|sent| now.duration_since(sent) >= MIN_PREVIEW_INTERVAL);
        if !(has_new_title || interval_passed) {
            return None;
        }
        self.last_sent = Some(now);
        self.last_sent_title_count = preview.step_titles.len();
        Some(preview)
    }

    /// The preview of everything received so far.
    pub(super) fn preview(&self) -> DraftPreview {
        DraftPreview {
            explanation: opening_text(&self.text),
            step_titles: step_titles(&self.text),
            output_tokens: self.reported_output_tokens.unwrap_or_else(|| estimate_tokens(&self.text)),
        }
    }
}

fn estimate_tokens(text: &str) -> u32 {
    u32::try_from(text.chars().count().div_ceil(CHARS_PER_TOKEN)).unwrap_or(u32::MAX)
}

/// Lines that end the opening: a code fence, the name line, or a bare document.
fn ends_opening(line: &str) -> bool {
    line.starts_with("```") || line.starts_with(AGENT_NAME_PREFIX) || line.starts_with("version:")
}

/// A line still being written that may yet become one of the [`ends_opening`] markers.
fn may_become_marker(partial_line: &str) -> bool {
    ["```", AGENT_NAME_PREFIX, "version:"].iter().any(|marker| marker.starts_with(partial_line))
}

/// The text before the `Agent name:` line or the first code fence, as one paragraph.
pub(super) fn opening_text(reply: &str) -> String {
    let (complete_lines, partial_line) = match reply.rfind('\n') {
        Some(last_newline) => (&reply[..last_newline], &reply[last_newline + 1..]),
        None => ("", reply),
    };
    let mut opening = Vec::new();
    for line in complete_lines.lines().map(str::trim) {
        if ends_opening(line) {
            return opening.join(" ");
        }
        if !line.is_empty() {
            opening.push(line);
        }
    }
    let partial_line = partial_line.trim();
    if !partial_line.is_empty() && !ends_opening(partial_line) && !may_become_marker(partial_line) {
        opening.push(partial_line);
    }
    opening.join(" ")
}

/// `title:` values inside the YAML part of the reply, in order. A title still being
/// written (its line has no newline yet) is left out until it is complete.
fn step_titles(reply: &str) -> Vec<String> {
    let Some(document_start) = reply.find("```").or_else(|| reply.find("version:")) else {
        return Vec::new();
    };
    let document = &reply[document_start..];
    let complete_part = match document.rfind('\n') {
        Some(last_newline) => &document[..last_newline],
        None => return Vec::new(),
    };
    complete_part
        .lines()
        .filter_map(|line| {
            let key_part = line.trim_start();
            let key_part = key_part.strip_prefix("- ").unwrap_or(key_part).trim_start();
            key_part.strip_prefix("title:")
        })
        .map(|title| title.trim().trim_matches(|character| character == '"' || character == '\'').trim().to_owned())
        .filter(|title| !title.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use graphrt_core::Usage;

    use super::*;

    const REPLY: &str = "I find businesses in Bandar Lampung and ask you before each message.\n\
Agent name: Bandar Lampung promotions\n```yaml\nversion: \"1\"\ngraph:\n  nodes:\n    - id: find\n      type: http-request\n      title: Find businesses on Google Maps\n    - id: ask\n      type: human-input\n      title: \"Ask me before sending\"\n```\n";

    fn feed(watcher: &mut DraftWatcher, text: &str, now: Instant) -> Option<DraftPreview> {
        watcher.push(&ChatDelta::Text(text.to_owned()), now)
    }

    #[test]
    fn opening_stops_at_the_name_line_or_fence() {
        assert_eq!(opening_text(REPLY), "I find businesses in Bandar Lampung and ask you before each message.");
        assert_eq!(opening_text("Changed the search.\n\n```yaml\nversion: 1\n```"), "Changed the search.");
        assert_eq!(opening_text("```yaml\nversion: 1"), "");
        assert_eq!(opening_text("Two lines\nof text"), "Two lines of text");
    }

    #[test]
    fn opening_hides_a_marker_still_being_written() {
        assert_eq!(opening_text("Changed the search.\n``"), "Changed the search.");
        assert_eq!(opening_text("Changed the search.\nAgent"), "Changed the search.");
    }

    #[test]
    fn step_titles_come_from_complete_lines_only() {
        assert_eq!(step_titles(REPLY), ["Find businesses on Google Maps", "Ask me before sending"]);
        assert_eq!(step_titles("Intro\n```yaml\n    - id: a\n      title: Find busi"), Vec::<String>::new());
        assert!(step_titles("Just an opening sentence").is_empty());
    }

    #[test]
    fn previews_are_throttled_but_new_titles_go_out_at_once() {
        let mut watcher = DraftWatcher::new();
        let start = Instant::now();
        assert!(feed(&mut watcher, "I find", start).is_some());
        assert!(feed(&mut watcher, " businesses", start + Duration::from_millis(10)).is_none());
        let later = feed(&mut watcher, " here.\n", start + MIN_PREVIEW_INTERVAL).unwrap();
        assert_eq!(later.explanation, "I find businesses here.");

        let soon = start + MIN_PREVIEW_INTERVAL + Duration::from_millis(5);
        let with_title = feed(&mut watcher, "```yaml\n  - title: Find businesses\n", soon).unwrap();
        assert_eq!(with_title.step_titles, ["Find businesses"]);
    }

    #[test]
    fn reported_usage_replaces_the_estimate() {
        let mut watcher = DraftWatcher::new();
        let start = Instant::now();
        feed(&mut watcher, "12345678", start);
        assert_eq!(watcher.preview().output_tokens, 2);
        let usage = Usage { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 };
        watcher.push(&ChatDelta::Usage(usage), start + MIN_PREVIEW_INTERVAL);
        assert_eq!(watcher.preview().output_tokens, 7);
    }
}
