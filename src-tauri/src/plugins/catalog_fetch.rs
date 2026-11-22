//! Fetching the catalog (v2 first, v1 as the fallback), the session's fetched copy and
//! its timestamp, the saved copies for offline use, and the background detail sync.
//!
//! - `index-v2.json` is tried first (at most [`catalog::MAX_CATALOG_V2_BYTES`]). When it is
//!   missing (404), not valid JSON, too large or uses an unknown schema, v1 `index.json`
//!   is fetched as before (at most [`catalog::MAX_CATALOG_BYTES`]). A network error or
//!   timeout does not fall back: v1 sits on the same host, so the saved copy is used.
//! - Every index must carry a valid minisign signature (`<index url>.minisig`, see
//!   `catalog_signature`), checked before it is parsed. A missing or invalid v2 signature
//!   never falls back to v1 (v1 must be signed too): the saved copy is used, and the error
//!   is logged and returned with the catalog (`fetch_error`).
//! - Once a v2 index was fetched on this computer (remembered on disk), v1 is never used
//!   again, neither fetched nor read from its saved copy: a broken or removed v2 means the
//!   saved v2 copy is used (logged), so nobody can downgrade the app to the older format.
//! - Each catalog is saved under its own name (`plugin-catalog-v2.json`,
//!   `plugin-catalog.json`); offline, the more recently saved one is used (only v2 once v2 was fetched).
//! - After a v2 fetch, details of versions the index no longer lists are pruned and the
//!   missing ones are fetched in the background ([`PluginService::spawn_detail_sync`]),
//!   never blocking the caller. When new details arrive the process-wide catalog is
//!   published again, so the builder sees their config schemas.
//! - The known catalog (resolved with its details) is computed once and kept in memory
//!   ([`KnownCatalogMemo`]) until a fetch replaces the session's catalog or a detail is
//!   downloaded or pruned, so the builder, prompt guide and plugin lists do not re-read
//!   and re-verify the saved files on every call.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};

use super::catalog::{self, CatalogOrigin, CATALOG_SCHEMA_V2};
use super::catalog_signature::{self, MAX_SIGNATURE_BYTES, REQUIRE_CATALOG_SIGNATURE};
use super::details::{self, DetailRef, DetailStore, RetryFailed};
use super::download::require_https;
use super::models::{CatalogIndex, CatalogPlugin, PluginCatalog, PluginNodeInfo};
use super::{active, PluginService, BUILDER_CATALOG_TIMEOUT, CATALOG_TIMEOUT};
use crate::error::{AppError, AppResult};

/// The catalog fetched this session, as published (v2 entries not yet resolved).
#[derive(Debug, Clone)]
pub(super) struct FetchedCatalog {
    pub index: CatalogIndex,
    pub fetched_at: DateTime<Utc>,
}

/// The session's fetched catalog, shared with the background detail sync.
pub(super) type CatalogSlot = Arc<Mutex<Option<FetchedCatalog>>>;

/// A catalog (or none) computed for the state `K` it was computed from.
type Memo<K> = Mutex<Option<(K, Option<Arc<CatalogIndex>>)>>;

/// What [`PluginService::known_catalog`] last computed, and from which state.
#[derive(Debug, Default)]
pub(super) struct KnownCatalogMemo {
    /// Bumped whenever the session's catalog is replaced (a fetch).
    catalog_generation: AtomicU64,
    /// The saved copy as read from disk (`None` inside: there is none), per catalog generation.
    saved: Memo<u64>,
    /// The resolved known catalog, per (catalog generation, detail generation).
    resolved: Memo<(u64, u64)>,
}

impl KnownCatalogMemo {
    /// Forgets everything computed from the previous session catalog.
    fn catalog_replaced(&self) {
        self.catalog_generation.fetch_add(1, Ordering::SeqCst);
    }

    fn generation(&self) -> u64 {
        self.catalog_generation.load(Ordering::SeqCst)
    }
}

/// The value memoized under `key` in `slot`, else `compute()` stored under `key`. The key is
/// read before computing, so a change racing the computation only causes a recompute later.
fn memoized<K: PartialEq + Copy, V: Clone>(slot: &Mutex<Option<(K, V)>>, key: K, compute: impl FnOnce() -> V) -> V {
    if let Some(value) =
        slot.lock().ok().and_then(|memo| memo.as_ref().filter(|(at, _)| *at == key).map(|(_, value)| value.clone()))
    {
        return value;
    }
    let value = compute();
    if let Ok(mut memo) = slot.lock() {
        *memo = Some((key, value.clone()));
    }
    value
}

/// Why a downloaded index could not be used.
#[derive(Debug)]
enum IndexError {
    /// Fetching or parsing failed (missing, not JSON, unknown schema, network).
    Unusable(AppError),
    /// The signature is missing or does not verify: never a reason to try another index.
    Signature(AppError),
}

impl IndexError {
    fn into_app_error(self) -> AppError {
        match self {
            Self::Unusable(error) | Self::Signature(error) => error,
        }
    }
}

/// Whether a failed `index-v2.json` fetch means "use v1": the server answered but the
/// document is missing or unusable. Network errors, timeouts and signature failures do not count.
fn falls_back_to_v1(error: &IndexError) -> bool {
    matches!(error, IndexError::Unusable(AppError::NotFound(_) | AppError::InvalidInput(_)))
}

impl PluginService {
    /// The catalog with install state. Uses the copy fetched earlier in this
    /// session unless `refresh`; when fetching fails, the last saved copy.
    ///
    /// # Errors
    /// The fetch error when there is no saved copy either.
    pub async fn catalog(&self, refresh: bool) -> AppResult<PluginCatalog> {
        let in_memory = if refresh { None } else { self.session_catalog() };
        let (index, origin) = match in_memory {
            Some(fetched) => (
                self.resolve(&fetched.index),
                CatalogOrigin { from_cache: false, fetched_at: Some(rfc3339(fetched.fetched_at)), fetch_error: None },
            ),
            None => match self.download_catalog().await {
                Ok(fetched) => (
                    self.resolve(&fetched.index),
                    CatalogOrigin {
                        from_cache: false,
                        fetched_at: Some(rfc3339(fetched.fetched_at)),
                        fetch_error: None,
                    },
                ),
                Err(error) => {
                    let fetch_error = Some(error.to_string());
                    (self.saved_catalog_or(error)?, CatalogOrigin { from_cache: true, fetched_at: None, fetch_error })
                }
            },
        };
        Ok(catalog::catalog_view(&index, &self.catalog_matched_plugins(), origin))
    }

    pub(super) fn session_catalog(&self) -> Option<FetchedCatalog> {
        self.catalog.lock().ok().and_then(|catalog| catalog.clone())
    }

    /// The catalog fetched this session (resolved), if any.
    pub(super) fn cached_catalog(&self) -> Option<Arc<CatalogIndex>> {
        self.session_catalog()?;
        self.known_catalog()
    }

    /// The catalog fetched this session, else the newest saved copy, as published.
    fn known_raw_catalog(&self) -> Option<CatalogIndex> {
        self.session_catalog().map(|fetched| fetched.index).or_else(|| self.saved_catalog().as_deref().cloned())
    }

    /// The newest saved copy, read and verified once per session catalog (see [`KnownCatalogMemo`]).
    pub(super) fn saved_catalog(&self) -> Option<Arc<CatalogIndex>> {
        memoized(&self.known_catalog_memo.saved, self.known_catalog_memo.generation(), || {
            self.catalog_files.read_newest().map(Arc::new)
        })
    }

    /// The catalog fetched this session, else the saved copy (resolved), else `None`.
    /// Computed once and reused until the catalog or its details change.
    pub(super) fn known_catalog(&self) -> Option<Arc<CatalogIndex>> {
        let key = (self.known_catalog_memo.generation(), self.details.generation());
        memoized(&self.known_catalog_memo.resolved, key, || {
            self.known_raw_catalog().map(|index| Arc::new(self.resolve(&index)))
        })
    }

    /// `index` with v2 nodes filled from the cached details (v1 unchanged).
    fn resolve(&self, index: &CatalogIndex) -> CatalogIndex {
        details::resolve_catalog(index, &self.details)
    }

    /// Makes sure the builder sees the catalog and its details: fetches the catalog when
    /// this session has not yet, then the details not cached yet, waiting at most
    /// [`BUILDER_CATALOG_TIMEOUT`] in all. Offline, the saved copy and saved details stay
    /// in use, and without either only installed plugins are listed.
    pub async fn refresh_catalog_for_builder(&self) {
        let started = Instant::now();
        if self.session_catalog().is_none() {
            let download = self.download_catalog_within(BUILDER_CATALOG_TIMEOUT);
            match tokio::time::timeout(BUILDER_CATALOG_TIMEOUT, download).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => log::warn!("the builder uses the saved plugin catalog: {error}"),
                Err(_) => log::warn!("the plugin catalog took too long; the builder uses the saved copy"),
            }
        }
        let remaining = BUILDER_CATALOG_TIMEOUT.saturating_sub(started.elapsed());
        self.sync_details_within(remaining).await;
    }

    /// Fetches the missing details of the known catalog (skipping ones that already failed
    /// this session) for at most `timeout`, then republishes the catalog if any arrived.
    async fn sync_details_within(&self, timeout: Duration) {
        let Some(index) = self.known_raw_catalog() else { return };
        let references = details::detail_refs(&index);
        if references.is_empty() || timeout.is_zero() {
            return;
        }
        let sync = self.details.sync_missing(&references, RetryFailed::No);
        match tokio::time::timeout(timeout, sync).await {
            Ok(report) if report.fetched > 0 => self.publish_known_catalog(),
            Ok(_) => {}
            Err(_) => {
                log::warn!("plugin details took too long; the builder lists the missing ones without config fields");
                self.publish_known_catalog();
            }
        }
    }

    /// Fetches the catalog; when that fails, the newest saved copy (`true` = saved copy).
    pub(super) async fn fetch_catalog(&self) -> AppResult<(CatalogIndex, bool)> {
        match self.download_catalog().await {
            Ok(fetched) => Ok((self.resolve(&fetched.index), false)),
            Err(error) => Ok((self.saved_catalog_or(error)?, true)),
        }
    }

    /// The newest saved catalog (resolved), else `error`.
    fn saved_catalog_or(&self, error: AppError) -> AppResult<CatalogIndex> {
        match self.saved_catalog() {
            Some(index) => {
                log::warn!("could not fetch the plugin catalog, using the saved copy: {error}");
                Ok(self.resolve(&index))
            }
            None => Err(error),
        }
    }

    async fn download_catalog(&self) -> AppResult<FetchedCatalog> {
        self.download_catalog_within(CATALOG_TIMEOUT).await
    }

    /// Fetches the catalog (v2, else v1), saves it, makes it this session's catalog,
    /// prunes and syncs details in the background, and publishes it.
    async fn download_catalog_within(&self, timeout: Duration) -> AppResult<FetchedCatalog> {
        let index = self.download_index(timeout).await?;
        let fetched = FetchedCatalog { index, fetched_at: Utc::now() };
        if let Ok(mut slot) = self.catalog.lock() {
            *slot = Some(fetched.clone());
        }
        self.known_catalog_memo.catalog_replaced();
        if fetched.index.schema == CATALOG_SCHEMA_V2 {
            let references = details::detail_refs(&fetched.index);
            let pruned = self.details.prune(&references);
            if pruned > 0 {
                log::info!("removed {pruned} plugin details of versions the catalog no longer lists");
            }
            self.spawn_detail_sync(references);
        }
        self.publish_known_catalog();
        Ok(fetched)
    }

    /// `index-v2.json` when it is usable, else v1 `index.json`; the one used is saved and logged.
    async fn download_index(&self, timeout: Duration) -> AppResult<CatalogIndex> {
        if let Some(v2_url) = &self.catalog_v2_url {
            match self
                .download_and_parse(v2_url, catalog::MAX_CATALOG_V2_BYTES, timeout, catalog::parse_catalog_v2)
                .await
            {
                Ok(index) => {
                    log::info!("plugin catalog: using index-v2.json ({} plugins)", index.plugins.len());
                    self.catalog_files.remember_v2();
                    return Ok(index);
                }
                Err(error) if falls_back_to_v1(&error) && self.catalog_files.has_seen_v2() => {
                    let error = error.into_app_error();
                    log::warn!("plugin catalog: index-v2.json is not usable ({error}); not falling back to v1 after v2 was used, the saved v2 copy is used");
                    return Err(error);
                }
                Err(error) if falls_back_to_v1(&error) => {
                    let error = error.into_app_error();
                    log::info!("plugin catalog: index-v2.json is not usable ({error}); falling back to v1 index.json");
                }
                Err(error) => {
                    let error = error.into_app_error();
                    log::warn!("plugin catalog: index-v2.json is refused ({error}); the saved copy is used");
                    return Err(error);
                }
            }
        }
        let index = self
            .download_and_parse(&self.catalog_url, catalog::MAX_CATALOG_BYTES, timeout, catalog::parse_catalog)
            .await
            .map_err(|error| {
                let error = error.into_app_error();
                log::warn!("plugin catalog: index.json is not usable ({error})");
                error
            })?;
        log::info!("plugin catalog: using v1 index.json ({} plugins)", index.plugins.len());
        Ok(index)
    }

    /// Downloads an index and its signature, verifies the bytes, then parses and saves both.
    async fn download_and_parse(
        &self,
        url: &str,
        max_bytes: u64,
        timeout: Duration,
        parse: fn(&[u8]) -> AppResult<CatalogIndex>,
    ) -> Result<CatalogIndex, IndexError> {
        require_https(url).map_err(IndexError::Unusable)?;
        let bytes = self.downloader.fetch(url, max_bytes, timeout, None).await.map_err(IndexError::Unusable)?;
        let signature = self.download_signature(url, &bytes, timeout).await.map_err(IndexError::Signature)?;
        let mut index = parse(&bytes).map_err(IndexError::Unusable)?;
        self.catalog_files.save(index.schema, &bytes, signature.as_deref());
        catalog::restrict_asset_urls(&mut index, self.catalog_files.asset_prefix.as_deref());
        Ok(index)
    }

    /// Downloads `<url>.minisig` and checks it signs `bytes` with a trusted key. Returns the
    /// signature text, or `None` for an unsigned index when signatures are not required.
    ///
    /// # Errors
    /// `InvalidInput` when the signature is missing, too large, unreadable or does not verify.
    async fn download_signature(&self, url: &str, bytes: &[u8], timeout: Duration) -> AppResult<Option<String>> {
        let signature_url = catalog_signature::signature_location(url);
        let signature_bytes = match self.downloader.fetch(&signature_url, MAX_SIGNATURE_BYTES, timeout, None).await {
            Ok(signature_bytes) => signature_bytes,
            Err(error) if !REQUIRE_CATALOG_SIGNATURE => {
                log::warn!(
                    "plugin catalog {url} is not signed ({error}); accepted because signatures are not required"
                );
                return Ok(None);
            }
            Err(error) => {
                return Err(AppError::InvalidInput(format!(
                    "the plugin catalog signature is not valid: {signature_url} could not be downloaded ({error})"
                )))
            }
        };
        let signature = String::from_utf8(signature_bytes)
            .map_err(|_| AppError::InvalidInput("the plugin catalog signature is not valid: it is not text".into()))?;
        self.catalog_files.keys.verify(bytes, &signature)?;
        Ok(Some(signature))
    }

    /// Publishes the known catalog process-wide (the app's service only, once
    /// [`PluginService::activate_installed`] ran).
    pub fn publish_known_catalog(&self) {
        if self.publishes_globally.load(Ordering::SeqCst) {
            active::publish_catalog(self.known_catalog());
        }
    }

    /// Starts fetching the details of `references` that are not cached yet, in the
    /// background (replacing a sync still running from an earlier fetch).
    fn spawn_detail_sync(&self, references: Vec<DetailRef>) {
        if references.is_empty() {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            log::warn!("no async runtime; plugin details are fetched when needed");
            return;
        };
        let republish = Republisher {
            store: self.details.clone(),
            slot: self.catalog.clone(),
            publishes_globally: self.publishes_globally.clone(),
        };
        let handle = runtime.spawn(async move {
            let report = republish.store.sync_missing(&references, RetryFailed::Yes).await;
            if report.fetched > 0 || report.failed > 0 {
                log::info!("plugin details synced: {} fetched, {} failed", report.fetched, report.failed);
            }
            if report.fetched > 0 {
                republish.publish();
            }
        });
        if let Ok(mut running) = self.detail_sync.lock() {
            if let Some(previous) = running.replace(handle) {
                previous.abort();
            }
        }
    }

    /// Waits for the background detail sync started by the last catalog fetch, if any.
    #[cfg(test)]
    pub(crate) async fn wait_for_detail_sync(&self) {
        let handle = self.detail_sync.lock().ok().and_then(|mut running| running.take());
        if let Some(handle) = handle {
            if let Err(error) = handle.await {
                if !error.is_cancelled() {
                    log::warn!("the plugin detail sync stopped: {error}");
                }
            }
        }
    }

    /// The catalog entry of `name`: from this session's catalog, else fetched (or saved).
    pub(super) async fn catalog_entry(&self, name: &str) -> AppResult<CatalogPlugin> {
        let index = match self.session_catalog() {
            Some(fetched) => fetched.index,
            None => self.fetch_catalog().await?.0,
        };
        index
            .plugins
            .into_iter()
            .find(|plugin| plugin.name == name)
            .ok_or_else(|| AppError::NotFound(format!("plugin {name} in the catalog")))
    }

    /// The steps a catalog plugin adds, with descriptions, for its plugin page. A v2
    /// entry's detail is fetched now when it is not cached; offline (or when it cannot
    /// be fetched) the index's kinds and titles are returned instead.
    ///
    /// # Errors
    /// `NotFound` when the catalog does not list `name`; the fetch error when there is
    /// neither a fetched nor a saved catalog.
    pub async fn catalog_plugin_nodes(&self, name: &str) -> AppResult<Vec<PluginNodeInfo>> {
        let entry = match self.known_raw_catalog() {
            Some(index) => index.plugins.into_iter().find(|plugin| plugin.name == name),
            None => Some(self.catalog_entry(name).await?),
        }
        .ok_or_else(|| AppError::NotFound(format!("plugin {name} in the catalog")))?;
        let Some(reference) = DetailRef::of(&entry) else {
            let nodes = if entry.nodes.is_empty() {
                entry.node_kinds.iter().map(super::models::CatalogNodeKind::to_node).collect()
            } else {
                entry.nodes
            };
            return Ok(nodes.iter().map(super::models::CatalogNode::info).collect());
        };
        let was_cached = self.details.cached(&reference).is_some();
        match self.details.fetch(&reference).await {
            Ok(detail) => {
                if !was_cached {
                    self.publish_known_catalog();
                }
                Ok(detail.nodes.iter().map(super::models::CatalogNode::info).collect())
            }
            Err(error) => {
                log::warn!("could not fetch the detail of plugin {name}: {error}");
                Ok(entry.node_kinds.iter().map(|node_kind| node_kind.to_node().info()).collect())
            }
        }
    }

    /// Caches the detail of the version being installed (best effort: the installed
    /// plugin reads its own manifest, the detail only serves the builder and plugin page).
    pub(super) async fn cache_detail_for_install(&self, entry: &CatalogPlugin) {
        let Some(reference) = DetailRef::of(entry) else { return };
        if self.details.cached(&reference).is_some() {
            return;
        }
        match self.details.fetch(&reference).await {
            Ok(_) => self.publish_known_catalog(),
            Err(error) => log::warn!("could not fetch the detail of plugin {}: {error}", entry.name),
        }
    }
}

/// What the background sync needs to publish the catalog again once details arrive.
struct Republisher {
    store: Arc<DetailStore>,
    slot: CatalogSlot,
    publishes_globally: Arc<AtomicBool>,
}

impl Republisher {
    fn publish(&self) {
        if !self.publishes_globally.load(Ordering::SeqCst) {
            return;
        }
        let index = self.slot.lock().ok().and_then(|slot| slot.as_ref().map(|fetched| fetched.index.clone()));
        if let Some(index) = index {
            active::publish_catalog(Some(Arc::new(details::resolve_catalog(&index, &self.store))));
        }
    }
}

fn rfc3339(moment: DateTime<Utc>) -> String {
    moment.to_rfc3339_opts(SecondsFormat::Secs, true)
}
