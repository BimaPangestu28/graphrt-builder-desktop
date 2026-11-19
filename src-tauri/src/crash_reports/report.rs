//! What one crash report contains, built from a Rust panic or a frontend
//! error, scrubbed and capped in size before it is written.
//!
//! A report never holds workflow inputs, run outputs, secrets or file contents:
//! only the app version, the system, where the error happened and the error
//! text itself, which [`Scrubber`] cleans first.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::scrub::{route_without_query, Scrubber};

/// Version of the report JSON layout, bumped when a field changes meaning.
pub const REPORT_SCHEMA_VERSION: u32 = 1;
/// Largest report written, in bytes of pretty-printed JSON.
pub const MAX_REPORT_BYTES: usize = 64 * 1024;
/// Longest panic or error message kept, in characters.
const MAX_MESSAGE_CHARS: usize = 4_000;
/// Longest route kept, in characters.
const MAX_ROUTE_CHARS: usize = 200;
const TRUNCATION_MARKER: &str = "\n… [truncated]";

/// Where the report comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashReportKind {
    /// A Rust panic in the backend (the app usually closes).
    Panic,
    /// A JavaScript error in the window (the app keeps running).
    Frontend,
}

/// How the frontend caught the error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontendErrorSource {
    /// `window.onerror`: an uncaught exception.
    WindowError,
    /// `unhandledrejection`: a promise rejected with nobody handling it.
    UnhandledRejection,
    /// The React error boundary at the app root (the screen showed the fallback).
    ErrorBoundary,
}

/// A frontend error as sent by `report_frontend_error` (`src/api/crashReports.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendErrorInput {
    pub message: String,
    pub stack: Option<String>,
    /// React's component stack, for errors caught by the error boundary.
    pub component_stack: Option<String>,
    /// The in-app route (hash path); its query string is dropped.
    pub route: Option<String>,
    pub source: FrontendErrorSource,
}

/// What the panic hook captures from `std::panic::PanicHookInfo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanicDetails {
    pub message: String,
    /// `file:line:column` of the panic.
    pub location: Option<String>,
    pub thread_name: Option<String>,
    pub backtrace: String,
}

/// The app version and system, plus the scrubber, shared by every report of a launch.
#[derive(Debug, Clone)]
pub struct ReportEnvironment {
    pub app_version: String,
    pub scrubber: Scrubber,
}

/// One crash report, as stored in `crash-reports/<id>.json` and shown in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub schema_version: u32,
    /// File stem: `<UTC timestamp>-<8 hex>`, so names sort by time.
    pub id: String,
    pub kind: CrashReportKind,
    pub created_at: DateTime<Utc>,
    pub app_version: String,
    /// `macos`, `windows` or `linux`.
    pub os: String,
    /// `aarch64`, `x86_64`, …
    pub arch: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_name: Option<String>,
    /// Rust backtrace of a panic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backtrace: Option<String>,
    /// JavaScript stack (plus React component stack) of a frontend error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frontend_source: Option<FrontendErrorSource>,
}

impl CrashReport {
    /// A scrubbed, size-capped report for a backend panic.
    pub fn from_panic(details: PanicDetails, environment: &ReportEnvironment, created_at: DateTime<Utc>) -> Self {
        let scrubber = &environment.scrubber;
        let mut report = Self::blank(CrashReportKind::Panic, environment, created_at);
        report.message = truncate_chars(&scrubber.scrub(&details.message), MAX_MESSAGE_CHARS);
        report.location = details.location.map(|location| scrubber.scrub(&location));
        report.thread_name = details.thread_name.map(|name| scrubber.scrub(&name));
        report.backtrace = Some(scrubber.scrub(&details.backtrace));
        report.fit_within(MAX_REPORT_BYTES);
        report
    }

    /// A scrubbed, size-capped report for an error the frontend caught.
    pub fn from_frontend(
        input: FrontendErrorInput,
        environment: &ReportEnvironment,
        created_at: DateTime<Utc>,
    ) -> Self {
        let scrubber = &environment.scrubber;
        let mut report = Self::blank(CrashReportKind::Frontend, environment, created_at);
        report.message = truncate_chars(&scrubber.scrub(&input.message), MAX_MESSAGE_CHARS);
        let full_stack = match (input.stack, input.component_stack) {
            (Some(stack), Some(components)) => Some(format!("{stack}\n\nComponent stack:{components}")),
            (stack, components) => stack.or(components),
        };
        report.stack = full_stack.map(|stack| scrubber.scrub(&stack));
        report.route = input
            .route
            .map(|route| truncate_chars(&scrubber.scrub(route_without_query(&route)), MAX_ROUTE_CHARS))
            .filter(|route| !route.is_empty());
        report.frontend_source = Some(input.source);
        report.fit_within(MAX_REPORT_BYTES);
        report
    }

    fn blank(kind: CrashReportKind, environment: &ReportEnvironment, created_at: DateTime<Utc>) -> Self {
        let random_suffix = uuid::Uuid::new_v4().simple().to_string();
        Self {
            schema_version: REPORT_SCHEMA_VERSION,
            id: format!("{}-{}", created_at.format("%Y%m%dT%H%M%S%3fZ"), &random_suffix[..8]),
            kind,
            created_at,
            app_version: environment.app_version.clone(),
            os: std::env::consts::OS.to_owned(),
            arch: std::env::consts::ARCH.to_owned(),
            message: String::new(),
            location: None,
            thread_name: None,
            backtrace: None,
            stack: None,
            route: None,
            frontend_source: None,
        }
    }

    /// Pretty-printed JSON, as written to disk and shown under "View".
    pub fn to_pretty_json(&self) -> String {
        // Serializing plain strings, numbers and enums cannot fail.
        serde_json::to_string_pretty(self).unwrap_or_default()
    }

    /// Halves the longest of backtrace, stack and message until the JSON fits in `max_bytes`.
    fn fit_within(&mut self, max_bytes: usize) {
        while self.to_pretty_json().len() > max_bytes {
            let Some(longest_field) = self.longest_text_field() else { return };
            let kept_chars = longest_field.chars().count() / 2;
            if kept_chars < TRUNCATION_MARKER.len() {
                return;
            }
            *longest_field = truncate_chars(longest_field, kept_chars);
        }
    }

    fn longest_text_field(&mut self) -> Option<&mut String> {
        [self.backtrace.as_mut(), self.stack.as_mut(), Some(&mut self.message)]
            .into_iter()
            .flatten()
            .max_by_key(|field| field.len())
    }
}

/// The first `max_chars` characters of `text`, marked when something was cut.
fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((cut_index, _)) => format!("{}{TRUNCATION_MARKER}", &text[..cut_index]),
        None => text.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment() -> ReportEnvironment {
        ReportEnvironment { app_version: "1.2.3".into(), scrubber: Scrubber::new(Some("/Users/janedoe")) }
    }

    fn panic_details(message: &str, backtrace: &str) -> PanicDetails {
        PanicDetails {
            message: message.into(),
            location: Some("/Users/janedoe/code/graphrt/src/engine.rs:12:5".into()),
            thread_name: Some("tokio-runtime-worker".into()),
            backtrace: backtrace.into(),
        }
    }

    #[test]
    fn a_panic_report_has_the_version_system_location_and_backtrace() {
        let created_at = Utc::now();
        let report = CrashReport::from_panic(panic_details("boom", "0: graphrt_lib::run"), &environment(), created_at);
        assert_eq!(report.kind, CrashReportKind::Panic);
        assert_eq!(report.app_version, "1.2.3");
        assert_eq!(report.os, std::env::consts::OS);
        assert_eq!(report.arch, std::env::consts::ARCH);
        assert_eq!(report.message, "boom");
        assert_eq!(report.location.as_deref(), Some("~/code/graphrt/src/engine.rs:12:5"));
        assert_eq!(report.thread_name.as_deref(), Some("tokio-runtime-worker"));
        assert_eq!(report.backtrace.as_deref(), Some("0: graphrt_lib::run"));
        assert!(report.id.starts_with(&created_at.format("%Y%m%dT%H%M%S").to_string()));
        assert_eq!(report.id.len(), "20260101T000000000Z-".len() + 8);
    }

    #[test]
    fn panic_messages_are_scrubbed() {
        let details = panic_details("request with Bearer abcdef123456 for jane@example.com failed", "");
        let report = CrashReport::from_panic(details, &environment(), Utc::now());
        assert_eq!(report.message, "request with Bearer [redacted] for [email] failed");
    }

    #[test]
    fn a_frontend_report_keeps_the_route_without_its_query() {
        let input = FrontendErrorInput {
            message: "TypeError: x is undefined".into(),
            stack: Some("at render (App.tsx:3)".into()),
            component_stack: Some("\n    at HomePage".into()),
            route: Some("/agents/a1/run?input=my%20secret".into()),
            source: FrontendErrorSource::ErrorBoundary,
        };
        let report = CrashReport::from_frontend(input, &environment(), Utc::now());
        assert_eq!(report.kind, CrashReportKind::Frontend);
        assert_eq!(report.route.as_deref(), Some("/agents/a1/run"));
        assert_eq!(report.stack.as_deref(), Some("at render (App.tsx:3)\n\nComponent stack:\n    at HomePage"));
        assert_eq!(report.frontend_source, Some(FrontendErrorSource::ErrorBoundary));
        assert!(report.backtrace.is_none());
    }

    #[test]
    fn a_huge_report_is_cut_to_the_size_cap() {
        let huge_backtrace = "frame graphrt::step\n".repeat(20_000);
        let huge_message = "x ".repeat(50_000);
        let report = CrashReport::from_panic(panic_details(&huge_message, &huge_backtrace), &environment(), Utc::now());
        assert!(report.to_pretty_json().len() <= MAX_REPORT_BYTES);
        assert!(report.backtrace.unwrap().ends_with("[truncated]"));
        assert!(report.message.ends_with("[truncated]"));
    }

    #[test]
    fn the_json_round_trips_and_omits_empty_fields() {
        let report = CrashReport::from_panic(panic_details("boom", "bt"), &environment(), Utc::now());
        let json = report.to_pretty_json();
        assert!(!json.contains("\"stack\""));
        assert!(json.contains("\"schemaVersion\": 1"));
        assert_eq!(serde_json::from_str::<CrashReport>(&json).unwrap(), report);
    }

    #[test]
    fn truncation_respects_character_boundaries() {
        assert_eq!(truncate_chars("héllo", 2), format!("hé{TRUNCATION_MARKER}"));
        assert_eq!(truncate_chars("hi", 5), "hi");
    }
}
