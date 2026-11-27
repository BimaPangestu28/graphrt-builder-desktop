//! What every request passes before a handler sees it.
//!
//! - **Host allowlist.** The server answers only requests addressed to the names it is
//!   served under (`192.168.1.21:47613`, `laptop.tailnet.ts.net:47613`, a tunnel's name).
//!   A web page elsewhere that points its own name at this computer (DNS rebinding) sends
//!   its own name as `Host` and is refused.
//! - **Origin allowlist.** A request a browser marks as coming from a page must come from
//!   the monitoring page's own origin; `Sec-Fetch-Site: cross-site` is refused too. No CORS
//!   headers are ever sent, so other sites cannot read answers either.
//! - **Rate limits** ([`RateLimiter`]) on pairing and on refused tokens.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::header::{HOST, ORIGIN};
use axum::http::HeaderMap;

/// Most distinct keys a limiter remembers; beyond it the oldest windows are forgotten.
const MAX_TRACKED_KEYS: usize = 4096;

/// The names and origins a server answers for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowedHosts {
    /// `host[:port]`, lowercase, exactly as a browser sends `Host`.
    hosts: Vec<String>,
    /// `scheme://host[:port]`, lowercase, exactly as a browser sends `Origin`.
    origins: Vec<String>,
}

/// Why a request was refused before its handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    UnknownHost,
    ForeignOrigin,
}

impl AllowedHosts {
    /// The names of `base_urls` (`http://192.168.1.21:47613`, `https://laptop.ts.net:47613`).
    /// A URL that does not parse is skipped.
    pub fn for_urls(base_urls: &[String]) -> Self {
        let mut hosts = Vec::new();
        let mut origins = Vec::new();
        for base_url in base_urls {
            let Ok(url) = url::Url::parse(base_url) else { continue };
            let Some(host) = url.host_str() else { continue };
            let host = host.to_ascii_lowercase();
            let with_port = match url.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.clone(),
            };
            origins.push(format!("{}://{with_port}", url.scheme()));
            hosts.push(with_port);
        }
        hosts.dedup();
        origins.dedup();
        Self { hosts, origins }
    }

    /// The origins requests may come from (also what a pairing link starts with).
    pub fn origins(&self) -> &[String] {
        &self.origins
    }

    /// Checks `Host`, `Origin` and `Sec-Fetch-Site` of a request.
    ///
    /// # Errors
    /// Which check failed.
    pub fn check(&self, headers: &HeaderMap) -> Result<(), Refusal> {
        let host = headers.get(HOST).and_then(|value| value.to_str().ok()).map(str::to_ascii_lowercase);
        if !host.is_some_and(|host| self.hosts.contains(&host)) {
            return Err(Refusal::UnknownHost);
        }
        if let Some(origin) = headers.get(ORIGIN) {
            let origin = origin.to_str().map(str::to_ascii_lowercase).map_err(|_| Refusal::ForeignOrigin)?;
            if !self.origins.contains(&origin) {
                return Err(Refusal::ForeignOrigin);
            }
        }
        let fetch_site = headers.get("sec-fetch-site").and_then(|value| value.to_str().ok());
        if fetch_site == Some("cross-site") {
            return Err(Refusal::ForeignOrigin);
        }
        Ok(())
    }
}

/// At most `limit` events per `window` for each key (a client address, or `*` for everyone).
#[derive(Debug)]
pub struct RateLimiter {
    limit: u32,
    window: Duration,
    windows: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    pub fn new(limit: u32, window: Duration) -> Self {
        Self { limit, window, windows: Mutex::new(HashMap::new()) }
    }

    /// Counts one event of `key`; `false` when its window is full.
    pub fn allow(&self, key: &str) -> bool {
        self.allow_at(key, Instant::now())
    }

    fn allow_at(&self, key: &str, now: Instant) -> bool {
        let Ok(mut windows) = self.windows.lock() else { return false };
        if windows.len() >= MAX_TRACKED_KEYS && !windows.contains_key(key) {
            let window = self.window;
            windows.retain(|_, (started, _)| now.duration_since(*started) < window);
            if windows.len() >= MAX_TRACKED_KEYS {
                return false;
            }
        }
        let entry = windows.entry(key.to_owned()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        if entry.1 >= self.limit {
            return false;
        }
        entry.1 += 1;
        true
    }
}

/// Rate limits of one server.
#[derive(Debug)]
pub struct Limits {
    /// Pairing attempts per client address.
    pub pairing_per_client: RateLimiter,
    /// Pairing attempts of everyone together (behind Tailscale or a tunnel every client
    /// has the same loopback address).
    pub pairing_overall: RateLimiter,
    /// Requests with a token that is not valid, per client address.
    pub bad_tokens_per_client: RateLimiter,
    pub bad_tokens_overall: RateLimiter,
}

impl Default for Limits {
    fn default() -> Self {
        let minute = Duration::from_secs(60);
        Self {
            pairing_per_client: RateLimiter::new(5, minute),
            pairing_overall: RateLimiter::new(20, minute),
            bad_tokens_per_client: RateLimiter::new(20, minute),
            bad_tokens_overall: RateLimiter::new(60, minute),
        }
    }
}

impl Limits {
    /// One pairing attempt from `client`; `false` when it must wait.
    pub fn allow_pairing(&self, client: IpAddr) -> bool {
        self.pairing_per_client.allow(&client.to_string()) && self.pairing_overall.allow("*")
    }

    /// One refused token from `client`; `false` once it refused too many.
    pub fn allow_bad_token(&self, client: IpAddr) -> bool {
        self.bad_tokens_per_client.allow(&client.to_string()) && self.bad_tokens_overall.allow("*")
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.insert(*name, HeaderValue::from_static(value));
        }
        headers
    }

    fn allowed() -> AllowedHosts {
        AllowedHosts::for_urls(&[
            "http://192.168.1.21:47613".to_owned(),
            "https://Laptop.tail0f0add.ts.net:47613/".to_owned(),
        ])
    }

    #[test]
    fn requests_to_the_served_names_pass() {
        let allowed = allowed();
        assert_eq!(allowed.check(&headers(&[("host", "192.168.1.21:47613")])), Ok(()));
        assert_eq!(
            allowed.check(&headers(&[
                ("host", "laptop.tail0f0add.ts.net:47613"),
                ("origin", "https://laptop.tail0f0add.ts.net:47613"),
                ("sec-fetch-site", "same-origin"),
            ])),
            Ok(())
        );
    }

    #[test]
    fn a_rebound_name_or_a_missing_host_is_refused() {
        let allowed = allowed();
        assert_eq!(allowed.check(&headers(&[("host", "evil.example:47613")])), Err(Refusal::UnknownHost));
        assert_eq!(allowed.check(&headers(&[("host", "192.168.1.21")])), Err(Refusal::UnknownHost));
        assert_eq!(allowed.check(&HeaderMap::new()), Err(Refusal::UnknownHost));
    }

    #[test]
    fn requests_of_other_sites_are_refused() {
        let allowed = allowed();
        assert_eq!(
            allowed.check(&headers(&[("host", "192.168.1.21:47613"), ("origin", "https://evil.example")])),
            Err(Refusal::ForeignOrigin)
        );
        // The page's origin is the scheme it was served with: http on the LAN, never https there.
        assert_eq!(
            allowed.check(&headers(&[("host", "192.168.1.21:47613"), ("origin", "https://192.168.1.21:47613")])),
            Err(Refusal::ForeignOrigin)
        );
        assert_eq!(
            allowed.check(&headers(&[("host", "192.168.1.21:47613"), ("sec-fetch-site", "cross-site")])),
            Err(Refusal::ForeignOrigin)
        );
    }

    #[test]
    fn a_limiter_counts_per_window() {
        let limiter = RateLimiter::new(2, Duration::from_secs(60));
        let start = Instant::now();
        assert!(limiter.allow_at("a", start));
        assert!(limiter.allow_at("a", start));
        assert!(!limiter.allow_at("a", start + Duration::from_secs(1)));
        assert!(limiter.allow_at("b", start + Duration::from_secs(1)));
        assert!(limiter.allow_at("a", start + Duration::from_secs(61)));
    }
}
