//! Sharing a crash report, which only ever happens by hand: graphrt sends no
//! telemetry and has no crash server. When the user opts in ("Help improve
//! graphrt: offer to share crash reports"), the next-launch notice offers to
//! open a prefilled GitHub issue in the browser; the user reads it and decides
//! whether to submit it.
//!
//! The opt-in and the last dismissed notice are rows of the `settings` table,
//! apart from [`crate::desktop::app_settings::AppSettings`].

use std::process::Command;

use super::report::{CrashReport, CrashReportKind};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

const KEY_OFFER_SHARING: &str = "app.offer_crash_report_sharing";
const KEY_NOTICE_DISMISSED_THROUGH: &str = "app.crash_notice_dismissed_through";

/// Where a prefilled issue is opened. Never changed by user input.
pub const NEW_ISSUE_URL: &str = "https://github.com/Graphrt/graphrt-builder-desktop/issues/new";
/// Longest percent-encoded issue body; keeps the whole URL under browsers' and GitHub's limits.
const MAX_ENCODED_BODY_CHARS: usize = 6_000;
const MAX_TITLE_MESSAGE_CHARS: usize = 80;
/// Lines of the backtrace or stack put in the issue body.
const MAX_TRACE_LINES: usize = 25;
const BODY_TRUNCATED_NOTE: &str =
    "\n\n… (shortened; the full report is in Settings > Privacy and data > Crash reports)";

/// Whether the user opted in to being offered to share crash reports (off by default).
///
/// @throws AppError::Database - when the settings table cannot be read
pub fn load_offers_sharing(db: &Database) -> AppResult<bool> {
    Ok(db.get_setting(KEY_OFFER_SHARING)?.as_deref() == Some("true"))
}

/// @throws AppError::Database - when the value cannot be written
pub fn save_offers_sharing(db: &Database, offers_sharing: bool) -> AppResult<()> {
    db.set_setting(KEY_OFFER_SHARING, if offers_sharing { "true" } else { "false" })
}

/// Id of the newest report whose notice the user dismissed.
///
/// @throws AppError::Database - when the settings table cannot be read
pub fn load_dismissed_through(db: &Database) -> AppResult<Option<String>> {
    db.get_setting(KEY_NOTICE_DISMISSED_THROUGH)
}

/// Remembers that notices up to `report_id` were dismissed (never moves backwards).
///
/// @throws AppError::Database - when the value cannot be read or written
pub fn save_dismissed_through(db: &Database, report_id: &str) -> AppResult<()> {
    let previous = load_dismissed_through(db)?;
    if previous.as_deref().is_some_and(|previous_id| previous_id >= report_id) {
        return Ok(());
    }
    db.set_setting(KEY_NOTICE_DISMISSED_THROUGH, report_id)
}

/// The "new issue" link with a title and a short, already-scrubbed summary filled in.
pub fn build_issue_url(report: &CrashReport) -> String {
    let title =
        format!("Crash: {}", shorten(report.message.lines().next().unwrap_or_default(), MAX_TITLE_MESSAGE_CHARS));
    format!(
        "{NEW_ISSUE_URL}?title={}&body={}",
        percent_encode(&title),
        encode_within(&issue_body(report), MAX_ENCODED_BODY_CHARS)
    )
}

fn issue_body(report: &CrashReport) -> String {
    let kind_text = match report.kind {
        CrashReportKind::Panic => "the app closed (backend panic)",
        CrashReportKind::Frontend => "error in the window",
    };
    let mut body = format!(
        "**What I was doing**\n\n<!-- A sentence or two helps. Please do not paste secrets or personal data. -->\n\n\
         **Crash report** (scrubbed by graphrt; review before submitting)\n\n\
         - graphrt: {}\n- System: {} {}\n- What happened: {kind_text}\n- When: {}\n",
        report.app_version,
        report.os,
        report.arch,
        report.created_at.to_rfc3339(),
    );
    if let Some(location) = &report.location {
        body.push_str(&format!("- Where: `{location}`\n"));
    }
    if let Some(route) = &report.route {
        body.push_str(&format!("- Screen: `{route}`\n"));
    }
    body.push_str(&format!("\n```text\n{}\n```\n", report.message));
    if let Some(trace) = report.backtrace.as_ref().or(report.stack.as_ref()) {
        let first_lines: Vec<&str> = trace.lines().take(MAX_TRACE_LINES).collect();
        body.push_str(&format!(
            "\n<details><summary>Trace</summary>\n\n```text\n{}\n```\n</details>\n",
            first_lines.join("\n")
        ));
    }
    body
}

fn shorten(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((cut_index, _)) => format!("{}…", &text[..cut_index]),
        None => text.to_owned(),
    }
}

/// Percent-encodes `text`, cutting whole characters so the result stays within `max_encoded_chars`.
fn encode_within(text: &str, max_encoded_chars: usize) -> String {
    let encoded_note = percent_encode(BODY_TRUNCATED_NOTE);
    let full = percent_encode(text);
    if full.len() <= max_encoded_chars {
        return full;
    }
    let budget = max_encoded_chars.saturating_sub(encoded_note.len());
    let mut encoded = String::new();
    for character in text.chars() {
        let encoded_character = percent_encode(character.encode_utf8(&mut [0; 4]));
        if encoded.len() + encoded_character.len() > budget {
            break;
        }
        encoded.push_str(&encoded_character);
    }
    encoded.push_str(&encoded_note);
    encoded
}

/// RFC 3986 percent-encoding: everything but unreserved characters.
fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// The platform's "open this link in the browser" program and its arguments (no shell).
fn browser_command(url: &str) -> (&'static str, Vec<String>) {
    if cfg!(target_os = "macos") {
        ("open", vec![url.to_owned()])
    } else if cfg!(windows) {
        ("rundll32", vec!["url.dll,FileProtocolHandler".to_owned(), url.to_owned()])
    } else {
        ("xdg-open", vec![url.to_owned()])
    }
}

/// Opens a GitHub "new issue" page in the default browser. Only links under
/// [`NEW_ISSUE_URL`] are accepted. Nothing is submitted: the user does that.
///
/// @throws AppError::InvalidInput - when the link is not a graphrt new-issue link
/// @throws AppError::Internal - when the browser cannot be started
pub fn open_issue_in_browser(url: &str) -> AppResult<()> {
    if !url.starts_with(&format!("{NEW_ISSUE_URL}?")) {
        return Err(AppError::InvalidInput("only graphrt's new-issue page can be opened".into()));
    }
    open_in_browser(url)
}

/// Opens a link in the default browser without a shell. Callers check the link first.
///
/// @throws AppError::Internal - when the browser cannot be started
pub(crate) fn open_in_browser(url: &str) -> AppResult<()> {
    let (program, arguments) = browser_command(url);
    let mut command = Command::new(program);
    crate::child_env::apply(&mut command);
    command
        .args(&arguments)
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || child.wait());
        })
        .map_err(|error| AppError::Internal(format!("could not open the browser: {error}")))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::super::report::{PanicDetails, ReportEnvironment};
    use super::super::scrub::Scrubber;
    use super::*;

    fn panic_report(message: &str, backtrace: &str) -> CrashReport {
        let environment = ReportEnvironment { app_version: "0.1.0".into(), scrubber: Scrubber::new(None) };
        let details = PanicDetails {
            message: message.into(),
            location: Some("src/engine.rs:1:2".into()),
            thread_name: None,
            backtrace: backtrace.into(),
        };
        CrashReport::from_panic(details, &environment, Utc::now())
    }

    #[test]
    fn sharing_is_off_until_the_user_opts_in() {
        let database = Database::open_in_memory().unwrap();
        assert!(!load_offers_sharing(&database).unwrap());
        save_offers_sharing(&database, true).unwrap();
        assert!(load_offers_sharing(&database).unwrap());
        save_offers_sharing(&database, false).unwrap();
        assert!(!load_offers_sharing(&database).unwrap());
    }

    #[test]
    fn the_dismissed_marker_only_moves_forward() {
        let database = Database::open_in_memory().unwrap();
        save_dismissed_through(&database, "20260102T000000000Z-bbbbbbbb").unwrap();
        save_dismissed_through(&database, "20260101T000000000Z-aaaaaaaa").unwrap();
        assert_eq!(load_dismissed_through(&database).unwrap().as_deref(), Some("20260102T000000000Z-bbbbbbbb"));
    }

    #[test]
    fn the_issue_link_has_a_title_and_the_summary() {
        let url = build_issue_url(&panic_report("index out of bounds", "0: graphrt_lib::engine"));
        assert!(url.starts_with(&format!("{NEW_ISSUE_URL}?title=Crash%3A%20index%20out%20of%20bounds&body=")));
        assert!(url.contains("graphrt_lib%3A%3Aengine"));
        assert!(url.contains("src%2Fengine.rs%3A1%3A2"));
    }

    #[test]
    fn a_long_body_is_shortened_to_a_safe_url_length() {
        let long_message = "é".repeat(5_000);
        let url = build_issue_url(&panic_report(&long_message, &"frame\n".repeat(1_000)));
        let body = url.split("&body=").nth(1).unwrap();
        assert!(body.len() <= MAX_ENCODED_BODY_CHARS);
        assert!(body.ends_with(&percent_encode(BODY_TRUNCATED_NOTE)));
        assert!(url.len() < 8_000);
    }

    #[test]
    fn percent_encoding_keeps_only_unreserved_characters() {
        assert_eq!(percent_encode("a b&c=d/é~"), "a%20b%26c%3Dd%2F%C3%A9~");
    }

    #[test]
    fn only_graphrt_issue_links_can_be_opened() {
        assert!(matches!(open_issue_in_browser("https://example.com/?x"), Err(AppError::InvalidInput(_))));
        assert!(matches!(open_issue_in_browser(NEW_ISSUE_URL), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn the_browser_gets_the_link_as_one_argument() {
        let (program, arguments) = browser_command("https://github.com/x?a=1&b=2");
        assert!(["open", "rundll32", "xdg-open"].contains(&program));
        assert_eq!(arguments.last().unwrap(), "https://github.com/x?a=1&b=2");
    }
}
