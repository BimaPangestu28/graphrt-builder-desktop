//! HTTPS downloads of the catalog and plugin tarballs, with size caps and timeouts.
//!
//! The [`Downloader`] trait lets tests serve fixture files without a network.

use std::fmt;
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
    fn fetch(
        &self,
        url: &str,
        max_bytes: u64,
        timeout: Duration,
        progress: Option<ProgressCallback>,
    ) -> BoxFuture<'_, AppResult<Vec<u8>>>;
}

/// `InvalidInput` unless `url` is an `https://` URL.
pub fn require_https(url: &str) -> AppResult<()> {
    let parsed = reqwest::Url::parse(url).map_err(|error| AppError::InvalidInput(format!("bad URL {url}: {error}")))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(format!("plugin downloads must use https: {url}")));
    }
    Ok(())
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
            attempt.follow()
        });
        let client = reqwest::Client::builder()
            .redirect(redirect_policy)
            .https_only(true)
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
    AppError::InvalidInput(format!("the download is larger than the {} MB limit", max_bytes / (1024 * 1024)))
}

/// Uses the `ring` rustls backend, like graphrt-http. Installing fails
/// harmlessly when the process already chose one.
fn install_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _already_installed = rustls::crypto::ring::default_provider().install_default();
    });
}
