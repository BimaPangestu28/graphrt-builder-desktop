//! Removes personal and secret data from crash report text before it is written.
//!
//! Applied to every free-text field of a report (panic message, location,
//! backtrace, frontend stack, route). It is deliberately aggressive: a report
//! that lost a harmless word is better than one that kept a key.
//!
//! - the user's home folder (and any `/Users/<name>`, `/home/<name>`,
//!   `C:\Users\<name>` path) becomes `~`, and the account name `[user]`
//! - `Bearer` / `Basic` credentials, `api_key=`, `token:`, `password=` …
//!   values, provider keys (`sk-…`, `ghp_…`, `xoxb-…`, `AIza…`, `AKIA…`), JWTs
//!   and long random-looking strings become `[redacted]`
//! - email addresses become `[email]`

use std::sync::LazyLock;

use regex::{Captures, Regex};

const REDACTED: &str = "[redacted]";

/// Any user's home folder on macOS, Linux and Windows, up to the account name.
static USER_FOLDER_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(?:/Users/|/home/|[A-Z]:[\\/]+Users[\\/]+)[^/\\\s"':]+"#).expect("valid user folder pattern")
});

static AUTHORIZATION_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{6,}").expect("valid authorization pattern")
});

/// `name=value`, `name: value`, `"name": "value"` for names that usually hold a secret.
static SECRET_ASSIGNMENT_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b((?:x-)?api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|authorization|auth|credentials?|key)(["']?\s*[:=]\s*["']?)([^\s"'&,;)}\]]+)"#,
    )
    .expect("valid secret assignment pattern")
});

/// Well-known key formats of model providers and developer services, and JWTs.
static PROVIDER_KEY_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b(?:(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+)",
    )
    .expect("valid provider key pattern")
});

static EMAIL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}").expect("valid email")
});

/// Runs of 32+ token characters; redacted only when they mix letters and digits.
static LONG_TOKEN_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9_+=-]{32,}").expect("valid long token pattern"));

/// Account names shorter than this are not redacted on their own (too likely to be a common word).
const MINIMUM_REDACTED_USER_NAME_LENGTH: usize = 3;

/// Scrubs crash report text. Built once per app launch from the user's home folder.
#[derive(Debug, Clone)]
pub struct Scrubber {
    /// The exact home folder, matched with `/` or `\` separators (for non-standard locations).
    home_folder_pattern: Option<Regex>,
    /// The account name on its own (`bima` in "permission denied for bima").
    user_name_pattern: Option<Regex>,
}

impl Scrubber {
    /// @param home_folder - The user's home folder, when the OS reports one
    pub fn new(home_folder: Option<&str>) -> Self {
        let trimmed_home =
            home_folder.map(|folder| folder.trim_end_matches(['/', '\\'])).filter(|folder| folder.len() > 1);
        Self {
            home_folder_pattern: trimmed_home.and_then(build_home_folder_pattern),
            user_name_pattern: trimmed_home.and_then(build_user_name_pattern),
        }
    }

    /// Returns `text` with home folders, account names, secrets and emails removed.
    pub fn scrub(&self, text: &str) -> String {
        let mut scrubbed = match &self.home_folder_pattern {
            Some(pattern) => pattern.replace_all(text, "~").into_owned(),
            None => text.to_owned(),
        };
        scrubbed = USER_FOLDER_PATTERN.replace_all(&scrubbed, "~").into_owned();
        scrubbed = AUTHORIZATION_PATTERN
            .replace_all(&scrubbed, |captures: &Captures| format!("{} {REDACTED}", &captures[1]))
            .into_owned();
        scrubbed = PROVIDER_KEY_PATTERN.replace_all(&scrubbed, REDACTED).into_owned();
        scrubbed = SECRET_ASSIGNMENT_PATTERN.replace_all(&scrubbed, redact_secret_assignment).into_owned();
        scrubbed = EMAIL_PATTERN.replace_all(&scrubbed, "[email]").into_owned();
        scrubbed = LONG_TOKEN_PATTERN.replace_all(&scrubbed, redact_if_random_looking).into_owned();
        if let Some(pattern) = &self.user_name_pattern {
            scrubbed = pattern.replace_all(&scrubbed, "[user]").into_owned();
        }
        scrubbed
    }
}

/// The home folder written with either separator, so `C:\Users\x` and `C:/Users/x` both match.
fn build_home_folder_pattern(home_folder: &str) -> Option<Regex> {
    let separator_agnostic = home_folder.split(['/', '\\']).map(regex::escape).collect::<Vec<_>>().join(r"[\\/]+");
    Regex::new(&format!(r"(?i){separator_agnostic}\b")).ok()
}

fn build_user_name_pattern(home_folder: &str) -> Option<Regex> {
    let user_name = home_folder.rsplit(['/', '\\']).next()?;
    if user_name.chars().count() < MINIMUM_REDACTED_USER_NAME_LENGTH {
        return None;
    }
    Regex::new(&format!(r"(?i)\b{}\b", regex::escape(user_name))).ok()
}

/// Keeps `Authorization: Bearer` (the token itself is already redacted) and values redacted before.
fn redact_secret_assignment(captures: &Captures) -> String {
    let value = &captures[3];
    let is_scheme = ["bearer", "basic", "token"].iter().any(|scheme| value.eq_ignore_ascii_case(scheme));
    if is_scheme || value.starts_with('[') {
        return captures[0].to_owned();
    }
    format!("{}{}{REDACTED}", &captures[1], &captures[2])
}

fn redact_if_random_looking(captures: &Captures) -> String {
    let candidate = &captures[0];
    let has_digit = candidate.chars().any(|character| character.is_ascii_digit());
    let has_letter = candidate.chars().any(|character| character.is_ascii_alphabetic());
    if has_digit && has_letter {
        REDACTED.to_owned()
    } else {
        candidate.to_owned()
    }
}

/// Keeps only the path of an in-app route: no query string or fragment, and
/// ids (long random-looking segments) are removed by [`Scrubber::scrub`].
pub fn route_without_query(route: &str) -> &str {
    route.split(['?', '#']).next().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac_scrubber() -> Scrubber {
        Scrubber::new(Some("/Users/janedoe"))
    }

    #[test]
    fn replaces_the_home_folder_with_a_tilde() {
        let scrubbed = mac_scrubber().scrub("could not open /Users/janedoe/Documents/plan.txt");
        assert_eq!(scrubbed, "could not open ~/Documents/plan.txt");
    }

    #[test]
    fn replaces_windows_and_linux_home_folders_too() {
        let windows = Scrubber::new(Some(r"C:\Users\Jane Doe"));
        assert_eq!(windows.scrub(r"at C:\Users\Jane Doe\AppData\x.rs"), r"at ~\AppData\x.rs");
        assert_eq!(windows.scrub("at C:/Users/Jane Doe/AppData/x.rs"), "at ~/AppData/x.rs");
        let scrubbed = Scrubber::new(None).scrub("/home/someone/.cargo/registry and /Users/other/src");
        assert_eq!(scrubbed, "~/.cargo/registry and ~/src");
    }

    #[test]
    fn replaces_a_home_folder_outside_the_usual_places() {
        let scrubbed = Scrubber::new(Some("/var/homes/janedoe/")).scrub("/var/homes/janedoe/x");
        assert_eq!(scrubbed, "~/x");
    }

    #[test]
    fn removes_the_account_name_on_its_own() {
        assert_eq!(mac_scrubber().scrub("permission denied for JaneDoe"), "permission denied for [user]");
    }

    #[test]
    fn redacts_bearer_tokens_and_provider_keys() {
        let scrubber = mac_scrubber();
        assert_eq!(scrubber.scrub("Authorization: Bearer abc.def-123456"), "Authorization: Bearer [redacted]");
        assert_eq!(scrubber.scrub("key sk-ant-api03-AbCdEf123456 was rejected"), "key [redacted] was rejected");
        assert_eq!(scrubber.scrub("using ghp_abcdefghijklmnop1234"), "using [redacted]");
        assert!(!scrubber.scrub("x AKIAABCDEFGHIJKLMNOP y").contains("AKIA"));
        // Built from parts so secret scanners do not flag a made-up token (`{"alg":"none"}.{"test":true}.signature`).
        let jwt = ["eyJhbGciOiJub25lIn0", "eyJ0ZXN0Ijp0cnVlfQ", "c2lnbmF0dXJl"].join(".");
        assert_eq!(scrubber.scrub(&jwt), "[redacted]");
    }

    #[test]
    fn redacts_secret_assignments_in_urls_and_json() {
        let scrubber = mac_scrubber();
        assert_eq!(
            scrubber.scrub("GET https://api.example.com/v1?api_key=hunter2&page=2"),
            "GET https://api.example.com/v1?api_key=[redacted]&page=2"
        );
        assert_eq!(
            scrubber.scrub(r#"{"password": "hunter2", "ok": true}"#),
            r#"{"password": "[redacted]", "ok": true}"#
        );
        assert_eq!(scrubber.scrub("token=abc123 secret: s3cr3t"), "token=[redacted] secret: [redacted]");
    }

    #[test]
    fn redacts_emails() {
        assert_eq!(mac_scrubber().scrub("sent to jane.doe+work@example.co.uk failed"), "sent to [email] failed");
    }

    #[test]
    fn redacts_long_random_strings_but_keeps_words_and_code_locations() {
        let scrubber = mac_scrubber();
        assert_eq!(scrubber.scrub("id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c"), "id [redacted]");
        let backtrace_line = "  3: graphrt_lib::engine::run_step\n             at ./src/engine/mod.rs:120:5";
        assert_eq!(scrubber.scrub(backtrace_line), backtrace_line);
        assert_eq!(
            scrubber.scrub("called `Option::unwrap()` on a `None` value"),
            "called `Option::unwrap()` on a `None` value"
        );
    }

    #[test]
    fn routes_lose_their_query_and_fragment() {
        assert_eq!(route_without_query("/agents/a1/run?input=secret#x"), "/agents/a1/run");
        assert_eq!(route_without_query("/home"), "/home");
    }
}
