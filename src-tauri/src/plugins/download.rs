//! HTTPS downloads of the catalog and plugin tarballs, with size caps and timeouts.
//!
//! Only public addresses are contacted (graphrt-http's egress rules): a host
//! that is, or resolves to, a loopback, private, link-local (cloud metadata)
//! or otherwise non-public address is refused, for the first request and for
//! every redirect. The check runs in the DNS resolver the connection uses, so a
//! name cannot pass the check and then connect somewhere else (DNS rebinding).
//!
//! The [`Downloader`] trait lets tests serve fixture files without a network.

use std::fmt;
use std::net::SocketAddr;
use std::sync::{Arc, Once};
use std::time::Duration;

use futures::future::BoxFuture;

use crate::error::{AppError, AppResult};

/// Most redirects followed (GitHub release assets redirect once or twice).
const MAX_REDIRECTS: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Called with `(received_bytes, total_bytes)` while a download runs.
pub type ProgressCallback = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;

/// Fetches a URL into memory.
pub trait Downloader: Send + Sync + fmt::Debug {
    /// Downloads `url`, failing when the body exceeds `max_bytes` or the whole
    /// transfer takes longer than `timeout`. Callers have already checked
    /// that `url` is HTTPS ([`require_https`]).
    ///
    /// # Errors
    /// `NotFound` when the server answers 404 (the catalog falls back from v2 to v1
    /// on it); `InvalidInput` when the body is too large; `Internal` otherwise.
    fn fetch(
        &self,
        url: &str,
        max_bytes: u64,
        timeout: Duration,
        progress: Option<ProgressCallback>,
    ) -> BoxFuture<'_, AppResult<Vec<u8>>>;
}

/// `InvalidInput` unless `url` is an `https://` URL whose host is not a
/// loopback, private or link-local name or address (`localhost`, `10.0.0.1`,
/// `169.254.169.254`). Names are checked again when they resolve.
pub fn require_https(url: &str) -> AppResult<()> {
    let parsed = reqwest::Url::parse(url).map_err(|error| AppError::InvalidInput(format!("bad URL {url}: {error}")))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(format!("plugin downloads must use https: {url}")));
    }
    egress_policy().check_url(&parsed).map_err(|error| {
        AppError::InvalidInput(format!("plugin downloads only go to public addresses: {url} ({error})"))
    })
}

/// graphrt-http's default rules: public addresses only.
fn egress_policy() -> graphrt_http::EgressPolicy {
    graphrt_http::EgressPolicy::default()
}

/// Resolves names like the system does, then refuses any name with a
/// non-public address among its records.
#[derive(Debug)]
struct PublicAddressResolver;

impl reqwest::dns::Resolve for PublicAddressResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            egress_policy().check_host_name(&host)?;
            let resolved: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            let public = public_addresses(&host, resolved)?;
            Ok(Box::new(public.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// `resolved` when every address is public; an error naming `host` otherwise.
fn public_addresses(host: &str, resolved: Vec<SocketAddr>) -> Result<Vec<SocketAddr>, graphrt_http::EgressError> {
    if resolved.is_empty() {
        return Err(graphrt_http::EgressError::InvalidUrl(format!("`{host}` did not resolve to any address")));
    }
    let policy = egress_policy();
    for address in &resolved {
        policy.check_ip(address.ip())?;
    }
    Ok(resolved)
}

/// The real downloader: reqwest with rustls, HTTPS only (redirects included).
#[derive(Debug)]
pub struct HttpsDownloader {
    client: reqwest::Client,
}

impl HttpsDownloader {
    /// # Errors
    /// `Internal` when the HTTP client cannot be built.
    pub fn new() -> AppResult<Self> {
        install_crypto_provider();
        let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            if attempt.url().scheme() != "https" {
                return attempt.error("redirect to a non-https URL");
            }
            if let Err(error) = egress_policy().check_url(attempt.url()) {
                return attempt.error(format!("redirect to a non-public address: {error}"));
            }
            attempt.follow()
        });
        let client = reqwest::Client::builder()
            .redirect(redirect_policy)
            .https_only(true)
            .dns_resolver(Arc::new(PublicAddressResolver))
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| AppError::Internal(format!("could not set up the download client: {error}")))?;
        Ok(Self { client })
    }

    async fn fetch_inner(&self, url: &str, max_bytes: u64, progress: Option<ProgressCallback>) -> AppResult<Vec<u8>> {
        require_https(url)?;
        let download_error = |error: reqwest::Error| AppError::Internal(format!("download failed: {error}"));
        let mut response = self.client.get(url).send().await.map_err(download_error)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::NotFound(url.to_owned()));
        }
        if !response.status().is_success() {
            return Err(AppError::Internal(format!("download failed: {url} answered {}", response.status())));
        }
        let total = response.content_length();
        if total.is_some_and(|length| length > max_bytes) {
            return Err(too_large(max_bytes));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(download_error)? {
            if u64::try_from(body.len().saturating_add(chunk.len())).unwrap_or(u64::MAX) > max_bytes {
                return Err(too_large(max_bytes));
            }
            body.extend_from_slice(&chunk);
            if let Some(callback) = &progress {
                callback(u64::try_from(body.len()).unwrap_or(u64::MAX), total);
            }
        }
        Ok(body)
    }
}

impl Downloader for HttpsDownloader {
    fn fetch(
        &self,
        url: &str,
        max_bytes: u64,
        timeout: Duration,
        progress: Option<ProgressCallback>,
    ) -> BoxFuture<'_, AppResult<Vec<u8>>> {
        let url = url.to_owned();
        Box::pin(async move {
            tokio::time::timeout(timeout, self.fetch_inner(&url, max_bytes, progress))
                .await
                .map_err(|_| AppError::Internal(format!("download of {url} timed out")))?
        })
    }
}

fn too_large(max_bytes: u64) -> AppError {
    const MIB: u64 = 1024 * 1024;
    let limit = if max_bytes >= MIB { format!("{} MB", max_bytes / MIB) } else { format!("{} KB", max_bytes / 1024) };
    AppError::InvalidInput(format!("the download is larger than the {limit} limit"))
}

/// Uses the `ring` rustls backend, like graphrt-http. Installing fails
/// harmlessly when the process already chose one.
fn install_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _already_installed = rustls::crypto::ring::default_provider().install_default();
    });
}

#[cfg(test)]
mod tests {
    use reqwest::dns::Resolve;

    use super::*;

    fn address(text: &str) -> SocketAddr {
        SocketAddr::new(text.parse().unwrap(), 0)
    }

    #[test]
    fn downloads_to_private_or_loopback_addresses_are_refused() {
        for url in [
            "https://127.0.0.1/plugin.tgz",
            "https://[::1]/plugin.tgz",
            "https://10.0.0.5/catalog.json",
            "https://192.168.1.10/catalog.json",
            "https://169.254.169.254/latest/meta-data",
            "https://[::ffff:10.0.0.1]/x",
            "https://0.0.0.0/x",
        ] {
            let error = require_https(url).unwrap_err();
            assert!(error.to_string().contains("public addresses"), "{url}: {error}");
        }
        assert!(require_https("https://github.com/BimaPangestu28/graphrt-plugins/releases/x.tgz").is_ok());
        assert!(require_https("http://github.com/x.tgz").is_err(), "https only");
    }

    #[test]
    fn a_name_with_any_non_public_record_is_refused() {
        assert!(public_addresses("cdn.test", vec![address("140.82.112.3")]).is_ok());
        assert!(public_addresses("cdn.test", vec![address("140.82.112.3"), address("10.0.0.1")]).is_err());
        assert!(public_addresses("cdn.test", vec![address("fd00::1")]).is_err());
        assert!(public_addresses("cdn.test", vec![]).is_err());
    }

    #[tokio::test]
    async fn the_resolver_refuses_a_name_that_resolves_to_loopback() {
        let name: reqwest::dns::Name = "localhost".parse().unwrap();
        let resolved = PublicAddressResolver.resolve(name).await;
        assert!(resolved.is_err(), "localhost must not be reachable for downloads");
    }
}
