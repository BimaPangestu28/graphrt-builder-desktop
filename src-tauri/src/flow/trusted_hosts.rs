//! Hosts an agent trusts for read-only lookups.
//!
//! A `GET` / `HEAD` request that carries values from the run (a search term, an
//! API key) normally counts as sending, so it needs an approval first (see
//! [`super::sending`]). When the request goes to a fixed host the user trusts
//! for this agent, it reads instead and runs without asking.
//!
//! The list is stored per agent in the app database (`storage::trusted_hosts`),
//! never in the workflow document: a draft written by the builder model, or a
//! prompt injection inside one, cannot add a host. Only the user can, through
//! the `add_trusted_lookup_host` command.
//!
//! Entry format (see [`normalize_trusted_host`]): a host name (`api.example.com`),
//! a subdomain wildcard (`*.example.com`, which matches `a.example.com` and
//! `a.b.example.com` but not `example.com` itself), each with an optional
//! explicit port (`api.example.com:8443`). An entry without a port matches only
//! the scheme's default port.

use serde::{Deserialize, Serialize};

const WILDCARD_PREFIX: &str = "*.";
const MAX_HOST_LENGTH: usize = 253;
const MAX_LABEL_LENGTH: usize = 63;

/// The normalized trusted-host entries of one agent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TrustedHosts {
    entries: Vec<String>,
}

impl TrustedHosts {
    /// No trusted hosts (new agents, drafts, and every check that has no agent).
    pub const fn none() -> Self {
        Self { entries: Vec::new() }
    }

    /// Keeps the valid entries of `entries`, normalized and without duplicates; an
    /// invalid stored entry is dropped (logged) rather than trusted.
    pub fn from_entries<I, S>(entries: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut normalized_entries: Vec<String> = Vec::new();
        for entry in entries {
            match normalize_trusted_host(entry.as_ref()) {
                Ok(normalized) if !normalized_entries.contains(&normalized) => normalized_entries.push(normalized),
                Ok(_) => {}
                Err(reason) => log::warn!("ignoring trusted host {:?}: {reason}", entry.as_ref()),
            }
        }
        Self { entries: normalized_entries }
    }

    /// The entries in the order they were added.
    pub fn entries(&self) -> &[String] {
        &self.entries
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Whether a request to `host` (on `port`, `None` for the scheme's default) is trusted.
    pub fn allows(&self, host: &str, port: Option<u16>) -> bool {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        self.entries.iter().any(|entry| entry_matches(entry, &host, port))
    }
}

/// The literal host of a request URL, as an entry would name it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiteralOrigin {
    /// Lower-cased host name.
    pub host: String,
    /// The explicit port, `None` for the scheme's default.
    pub port: Option<u16>,
}

impl LiteralOrigin {
    /// `api.example.com`, or `api.example.com:8443` with an explicit port: what
    /// the user would add to trust it.
    pub fn display(&self) -> String {
        match self.port {
            Some(port) => format!("{}:{port}", self.host),
            None => self.host.clone(),
        }
    }
}

/// The host of `url` when its scheme and host are written out literally:
/// `http(s)://host[:port]` followed by `/`, `?`, `#` or nothing. `None` when any
/// part of the scheme or host comes from a `{{#…#}}` reference (the run could
/// then pick any host), names user info (`user@host`), or is not http(s).
///
/// Only letters, digits, `.`, `-` and `:` are accepted in the host part, so URL
/// parser tricks (`\`, `%`-escapes, `@`) cannot make the request go elsewhere.
///
/// @example `literal_origin("https://api.example.com/q?city={{#start.city#}}")` → `api.example.com`
pub fn literal_origin(url: &str) -> Option<LiteralOrigin> {
    let (scheme, rest) = url.trim().split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let is_plain = !authority.is_empty()
        && authority.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | ':'));
    if !is_plain {
        return None;
    }
    let parsed = reqwest::Url::parse(&format!("{}://{authority}/", scheme.to_ascii_lowercase())).ok()?;
    let host = parsed.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    Some(LiteralOrigin { host, port: parsed.port() })
}

/// Checks and normalizes one trusted-host entry typed by the user.
///
/// # Errors
/// A plain-language reason when `input` is not a host name, a `*.domain`
/// wildcard, or one of those with `:port`: schemes, paths, user info, spaces,
/// a bare `*` and wildcards over a top-level domain (`*.com`) are refused.
///
/// @example `normalize_trusted_host(" API.Example.com ") == Ok("api.example.com")`
pub fn normalize_trusted_host(input: &str) -> Result<String, String> {
    let entry = input.trim().to_ascii_lowercase();
    if entry.is_empty() {
        return Err("Enter a site name, such as api.example.com".into());
    }
    if entry.contains("://") {
        return Err("Enter only the site name, without http:// or https://".into());
    }
    if entry.contains(['/', '?', '#', '@', '\\']) || entry.chars().any(char::is_whitespace) {
        return Err("Enter only the site name, without a path or spaces".into());
    }
    let (host_part, port) = split_port(&entry)?;
    let (is_wildcard, host_name) = match host_part.strip_prefix(WILDCARD_PREFIX) {
        Some(domain) => (true, domain),
        None => (false, host_part),
    };
    let host_name = host_name.trim_end_matches('.');
    validate_host_name(host_name, is_wildcard)?;
    let host = if is_wildcard { format!("{WILDCARD_PREFIX}{host_name}") } else { host_name.to_owned() };
    Ok(match port {
        Some(port) => format!("{host}:{port}"),
        None => host,
    })
}

fn split_port(entry: &str) -> Result<(&str, Option<u16>), String> {
    match entry.split_once(':') {
        None => Ok((entry, None)),
        Some((host, port_text)) => {
            let port = port_text
                .parse::<u16>()
                .ok()
                .filter(|port| *port > 0)
                .ok_or_else(|| format!("`{port_text}` is not a port number (1 to 65535)"))?;
            Ok((host, Some(port)))
        }
    }
}

fn validate_host_name(host_name: &str, is_wildcard: bool) -> Result<(), String> {
    if host_name.contains('*') {
        return Err("A wildcard is only allowed at the start, as in *.example.com".into());
    }
    if host_name.is_empty() || host_name.len() > MAX_HOST_LENGTH {
        return Err("Enter a site name, such as api.example.com".into());
    }
    let labels: Vec<&str> = host_name.split('.').collect();
    if labels.iter().any(|label| !is_valid_label(label)) {
        return Err(format!("`{host_name}` is not a valid site name"));
    }
    if labels.len() < 2 {
        let shown = if is_wildcard { format!("{WILDCARD_PREFIX}{host_name}") } else { host_name.to_owned() };
        return Err(format!("`{shown}` is too broad: name a full site such as api.example.com"));
    }
    Ok(())
}

fn is_valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_LABEL_LENGTH
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
}

/// Whether one normalized entry covers `host` (lower-cased) on `port`.
fn entry_matches(entry: &str, host: &str, port: Option<u16>) -> bool {
    let (pattern, entry_port) = match entry.rsplit_once(':') {
        Some((pattern, port_text)) => (pattern, port_text.parse::<u16>().ok()),
        None => (entry, None),
    };
    if entry_port != port {
        return false;
    }
    match pattern.strip_prefix(WILDCARD_PREFIX) {
        Some(domain) => host.len() > domain.len() + 1 && host.ends_with(&format!(".{domain}")),
        None => host == pattern,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_are_normalized() {
        assert_eq!(normalize_trusted_host(" API.Weather.com ").unwrap(), "api.weather.com");
        assert_eq!(normalize_trusted_host("*.Weather.com").unwrap(), "*.weather.com");
        assert_eq!(normalize_trusted_host("api.weather.com.").unwrap(), "api.weather.com");
        assert_eq!(normalize_trusted_host("api.weather.com:8443").unwrap(), "api.weather.com:8443");
    }

    #[test]
    fn entries_with_a_scheme_path_or_bad_port_are_refused() {
        for input in [
            "",
            "https://api.weather.com",
            "api.weather.com/v1",
            "api.weather.com?q=1",
            "user@api.weather.com",
            "api weather.com",
            "*",
            "*.com",
            "localhost",
            "api.*.com",
            "api.weather.com:0",
            "api.weather.com:99999",
            "api.weather.com:",
            "-api.weather.com",
            "api..weather.com",
            "[::1]",
        ] {
            assert!(normalize_trusted_host(input).is_err(), "{input:?}");
        }
    }

    #[test]
    fn exact_hosts_match_case_insensitively_on_the_default_port() {
        let trusted = TrustedHosts::from_entries(["api.weather.com"]);
        assert!(trusted.allows("API.weather.com", None));
        assert!(!trusted.allows("api.weather.com", Some(8443)));
        assert!(!trusted.allows("weather.com", None));
        assert!(!trusted.allows("evil-api.weather.com", None));
        assert!(!trusted.allows("api.weather.com.evil.org", None));
    }

    #[test]
    fn wildcards_match_subdomains_only() {
        let trusted = TrustedHosts::from_entries(["*.weather.com"]);
        assert!(trusted.allows("api.weather.com", None));
        assert!(trusted.allows("eu.api.weather.com", None));
        assert!(!trusted.allows("weather.com", None));
        assert!(!trusted.allows("notweather.com", None));
    }

    #[test]
    fn an_explicit_port_matches_only_that_port() {
        let trusted = TrustedHosts::from_entries(["api.weather.com:8443"]);
        assert!(trusted.allows("api.weather.com", Some(8443)));
        assert!(!trusted.allows("api.weather.com", None));
    }

    #[test]
    fn invalid_or_duplicate_stored_entries_are_dropped() {
        let trusted = TrustedHosts::from_entries(["api.weather.com", "API.weather.com", "https://evil.org", "*"]);
        assert_eq!(trusted.entries(), ["api.weather.com"]);
    }

    #[test]
    fn literal_origins_are_read_only_from_a_fixed_scheme_and_host() {
        let origin = literal_origin("https://API.weather.com/v1?q={{#start.city#}}").unwrap();
        assert_eq!(origin, LiteralOrigin { host: "api.weather.com".into(), port: None });
        assert_eq!(literal_origin("https://api.weather.com:8443").unwrap().display(), "api.weather.com:8443");
        assert_eq!(literal_origin("https://api.weather.com:443/x").unwrap().port, None, "default port");
        assert_eq!(literal_origin("http://api.weather.com?x=1").unwrap().host, "api.weather.com");
        for url in [
            "{{#env.BASE_URL#}}/search",
            "https://{{#start.host#}}/search",
            "https://api.weather.com{{#start.suffix#}}/x",
            "https://api.weather.com.{{#start.suffix#}}/x",
            "https://api.weather.com:{{#start.port#}}/x",
            "https://user@api.weather.com/x",
            "https://evil.org\\@api.weather.com/x",
            "https://evil.org%2Fapi.weather.com/x",
            "ftp://api.weather.com/x",
            "api.weather.com/x",
            "https:///x",
        ] {
            assert_eq!(literal_origin(url), None, "{url}");
        }
    }
}
