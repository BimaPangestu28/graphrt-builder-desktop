//! Hiding secrets in text before it is recorded as a learning signal.
//!
//! A comment or a run excerpt may hold a key somebody pasted, or a value the run read
//! from the keychain. Signals are kept on disk and shown to the owner later, and a lesson
//! made from one is placed in prompts, so secrets are removed first, twice over:
//!
//! 1. every value the app itself knows to be secret (the secrets and model keys in the
//!    keychain) is replaced wherever it appears, whatever it looks like;
//! 2. the crash report scrubber then removes what looks like a secret (provider keys,
//!    `Bearer` tokens, `password=` values, long random strings) and email addresses.

use crate::crash_reports::scrub::Scrubber;

/// Shown instead of a known secret value. The same mark the scrubber leaves, which the
/// runtime recognises: a note that holds it is flagged as being about a secret
/// (risk reason `masked_secret`) and waits for a careful look.
const HIDDEN: &str = "[redacted]";
/// Values shorter than this are not replaced on their own: too likely a common word.
const SHORTEST_KNOWN_SECRET_CHARS: usize = 6;

/// `text` with every one of `known_secrets` and everything secret-looking removed.
pub(crate) fn hide_secrets(text: &str, known_secrets: &[String]) -> String {
    let mut hidden = text.to_owned();
    // Longest first, so a secret that contains another is replaced whole.
    let mut values: Vec<&str> = known_secrets
        .iter()
        .map(|value| value.trim())
        .filter(|value| value.chars().count() >= SHORTEST_KNOWN_SECRET_CHARS)
        .collect();
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    for value in values {
        hidden = hidden.replace(value, HIDDEN);
    }
    Scrubber::new(None).scrub(&hidden)
}
