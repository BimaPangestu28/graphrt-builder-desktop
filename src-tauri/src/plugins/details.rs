//! Catalog v2 plugin details: the immutable `plugin-<name>-<version>.json` files that
//! carry each version's full nodes (`config_schema`, `outputs`, descriptions) and tools.
//!
//! - A detail is fetched lazily (plugin page, install, builder) or by the background
//!   sync that runs after every successful `index-v2.json` fetch ([`DetailStore::sync_missing`]).
//! - Every download is checked against the index entry: HTTPS only, at most
//!   `detail_size_bytes` (itself capped at [`MAX_DETAIL_BYTES`]), the `detail_sha256`
//!   checksum, schema 2 and the same name and version.
//! - Verified details are kept on disk as `plugin-details/<name>-<version>.json`. A
//!   released version never changes, so they are kept forever, except that versions
//!   the index no longer lists are pruned ([`DetailStore::prune`]). Offline, only
//!   these saved details are used.
//! - Saved files are checked against the index's checksum again when first read in a
//!   session, then kept in memory.
//!
//! [`resolve_catalog`] turns a v2 index into the shape every consumer reads: each
//! entry's `nodes` come from its detail when cached, else from its `node_kinds`
//! (kind and title only). A v1 index is returned unchanged.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::stream::{self, StreamExt};

use super::archive::{sha256_hex, verify_sha256};
use super::catalog::{CATALOG_SCHEMA_V2, MAX_DETAIL_BYTES};
use super::download::{require_https, Downloader};
use super::models::{CatalogIndex, CatalogPlugin, PluginDetail};
use crate::error::{AppError, AppResult};

/// Folder under the app data folder holding the saved details.
pub(super) const DETAILS_DIR_NAME: &str = "plugin-details";
/// How long one detail download may take.
const DETAIL_TIMEOUT: Duration = Duration::from_secs(20);
/// Details downloaded at once by [`DetailStore::sync_missing`].
pub(super) const SYNC_CONCURRENCY: usize = 4;

/// What the index says about one plugin version's detail file (already validated
/// by `catalog::parse_catalog_v2`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DetailRef {
    pub name: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

impl DetailRef {
    /// The detail reference of a v2 entry, or `None` when it has no (valid) detail.
    pub fn of(plugin: &CatalogPlugin) -> Option<Self> {
        Some(Self {
            name: plugin.name.clone(),
            version: plugin.version.clone(),
            url: plugin.detail_url.clone()?,
            sha256: plugin.detail_sha256.clone()?,
            size_bytes: plugin.detail_size_bytes?,
        })
    }

    /// `<name>-<version>.json`: the saved file's name and the in-memory key.
    pub fn file_name(&self) -> String {
        format!("{}-{}.json", self.name, self.version)
    }
}

/// The detail references of every entry of a v2 `index` (none for v1).
pub(super) fn detail_refs(index: &CatalogIndex) -> Vec<DetailRef> {
    if index.schema != CATALOG_SCHEMA_V2 {
        return Vec::new();
    }
    index.plugins.iter().filter_map(DetailRef::of).collect()
}

/// What one [`DetailStore::sync_missing`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct DetailSyncReport {
    /// Details downloaded and saved.
    pub fetched: usize,
    /// Details that could not be downloaded or failed a check (logged).
    pub failed: usize,
}

/// Saved and in-memory plugin details (see the module docs).
#[derive(Debug)]
pub(super) struct DetailStore {
    dir: PathBuf,
    downloader: Arc<dyn Downloader>,
    /// Details read or downloaded this session, by [`DetailRef::file_name`].
    loaded: Mutex<HashMap<String, Arc<PluginDetail>>>,
    /// Details whose last download failed this session, by [`DetailRef::file_name`]: the
    /// builder skips them so it never waits on a broken link twice.
    failed: Mutex<HashSet<String>>,
}

/// Whether [`DetailStore::sync_missing`] tries details that failed earlier this session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RetryFailed {
    Yes,
    No,
}

impl DetailStore {
    pub fn new(dir: PathBuf, downloader: Arc<dyn Downloader>) -> Self {
        Self { dir, downloader, loaded: Mutex::new(HashMap::new()), failed: Mutex::new(HashSet::new()) }
    }

    /// The detail if it is in memory or saved (and still matches the index), never fetched.
    pub fn cached(&self, reference: &DetailRef) -> Option<Arc<PluginDetail>> {
        let key = reference.file_name();
        if let Some(detail) = self.loaded.lock().ok().and_then(|loaded| loaded.get(&key).cloned()) {
            return Some(detail);
        }
        let bytes = std::fs::read(self.dir.join(&key)).ok()?;
        match verify_detail(reference, &bytes) {
            Ok(detail) => Some(self.remember(key, detail)),
            Err(error) => {
                log::warn!("ignoring the saved detail of plugin {} {}: {error}", reference.name, reference.version);
                None
            }
        }
    }

    /// The detail, from memory or disk, else downloaded, verified and saved.
    ///
    /// # Errors
    /// `InvalidInput` when the download is too large, has another checksum or is not a
    /// matching detail; `NotFound` / `Internal` when it cannot be downloaded.
    pub async fn fetch(&self, reference: &DetailRef) -> AppResult<Arc<PluginDetail>> {
        if let Some(detail) = self.cached(reference) {
            return Ok(detail);
        }
        let key = reference.file_name();
        match self.download(reference).await {
            Ok((detail, bytes)) => {
                self.save(&key, &bytes);
                if let Ok(mut failed) = self.failed.lock() {
                    failed.remove(&key);
                }
                Ok(self.remember(key, detail))
            }
            Err(error) => {
                if let Ok(mut failed) = self.failed.lock() {
                    failed.insert(key);
                }
                Err(error)
            }
        }
    }

    async fn download(&self, reference: &DetailRef) -> AppResult<(PluginDetail, Vec<u8>)> {
        require_https(&reference.url)?;
        let max_bytes = reference.size_bytes.min(MAX_DETAIL_BYTES);
        let bytes = self.downloader.fetch(&reference.url, max_bytes, DETAIL_TIMEOUT, None).await?;
        let detail = verify_detail(reference, &bytes)?;
        Ok((detail, bytes))
    }

    fn failed_before(&self, reference: &DetailRef) -> bool {
        self.failed.lock().is_ok_and(|failed| failed.contains(&reference.file_name()))
    }

    /// Fetches the details in `references` that are not cached yet, at most
    /// [`SYNC_CONCURRENCY`] at a time. Failures are logged and counted, never fatal.
    pub async fn sync_missing(&self, references: &[DetailRef], retry_failed: RetryFailed) -> DetailSyncReport {
        let missing: Vec<DetailRef> = references
            .iter()
            .filter(|reference| retry_failed == RetryFailed::Yes || !self.failed_before(reference))
            .filter(|reference| self.cached(reference).is_none())
            .cloned()
            .collect();
        let results: Vec<bool> = stream::iter(missing)
            .map(|reference| async move {
                match self.fetch(&reference).await {
                    Ok(_) => true,
                    Err(error) => {
                        log::warn!(
                            "could not fetch the detail of plugin {} {}: {error}",
                            reference.name,
                            reference.version
                        );
                        false
                    }
                }
            })
            .buffer_unordered(SYNC_CONCURRENCY)
            .collect()
            .await;
        let fetched = results.iter().filter(|fetched| **fetched).count();
        DetailSyncReport { fetched, failed: results.len() - fetched }
    }

    /// Removes saved and in-memory details of versions not in `keep`. Returns how many
    /// files were removed.
    pub fn prune(&self, keep: &[DetailRef]) -> usize {
        let keep: HashSet<String> = keep.iter().map(DetailRef::file_name).collect();
        if let Ok(mut loaded) = self.loaded.lock() {
            loaded.retain(|key, _| keep.contains(key));
        }
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return 0 };
        let mut removed_count = 0;
        for entry in entries.filter_map(Result::ok) {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            // Hidden files are downloads being written right now (see `write_atomically`).
            if keep.contains(&file_name) || file_name.starts_with('.') || !entry.path().is_file() {
                continue;
            }
            match std::fs::remove_file(entry.path()) {
                Ok(()) => removed_count += 1,
                Err(error) => log::warn!("could not remove the old plugin detail {file_name}: {error}"),
            }
        }
        removed_count
    }

    fn remember(&self, key: String, detail: PluginDetail) -> Arc<PluginDetail> {
        let detail = Arc::new(detail);
        if let Ok(mut loaded) = self.loaded.lock() {
            loaded.insert(key, detail.clone());
        }
        detail
    }

    /// Saves a verified detail (written then renamed). Failures are logged: the detail
    /// still serves this session from memory.
    fn save(&self, file_name: &str, bytes: &[u8]) {
        if let Err(error) = write_atomically(&self.dir, file_name, bytes) {
            log::warn!("could not save the plugin detail {file_name}: {error}");
        }
    }
}

fn write_atomically(dir: &Path, file_name: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let temporary = dir.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = std::fs::write(&temporary, bytes).and_then(|()| std::fs::rename(&temporary, dir.join(file_name)));
    if result.is_err() {
        let _cleanup = std::fs::remove_file(&temporary);
    }
    result
}

/// Checks `bytes` against `reference` (size, checksum) and parses it as that version's detail.
///
/// # Errors
/// `InvalidInput` naming the first check that failed.
fn verify_detail(reference: &DetailRef, bytes: &[u8]) -> AppResult<PluginDetail> {
    let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    if size > MAX_DETAIL_BYTES || size > reference.size_bytes {
        return Err(AppError::InvalidInput(format!(
            "the detail is {size} bytes; the catalog allows {}",
            reference.size_bytes.min(MAX_DETAIL_BYTES)
        )));
    }
    verify_sha256(bytes, &reference.sha256).map_err(|_| {
        AppError::InvalidInput(format!(
            "the detail checksum {} does not match the catalog's {}",
            sha256_hex(bytes),
            reference.sha256
        ))
    })?;
    let detail: PluginDetail = serde_json::from_slice(bytes)
        .map_err(|error| AppError::InvalidInput(format!("the detail is not valid: {error}")))?;
    if detail.schema != CATALOG_SCHEMA_V2 {
        return Err(AppError::InvalidInput(format!("the detail uses schema {}", detail.schema)));
    }
    if detail.name != reference.name || detail.version != reference.version {
        return Err(AppError::InvalidInput(format!(
            "the detail describes {} {}, not {} {}",
            detail.name, detail.version, reference.name, reference.version
        )));
    }
    Ok(detail)
}

/// `index` as consumers read it: a v2 entry's `nodes` come from its cached detail
/// (full config schemas, outputs and descriptions), else from its `node_kinds`. A v1
/// index already has full nodes and is returned as is.
pub(super) fn resolve_catalog(index: &CatalogIndex, store: &DetailStore) -> CatalogIndex {
    let mut resolved = index.clone();
    if resolved.schema != CATALOG_SCHEMA_V2 {
        return resolved;
    }
    for plugin in &mut resolved.plugins {
        let detail = DetailRef::of(plugin).and_then(|reference| store.cached(&reference));
        plugin.nodes = match detail {
            Some(detail) => detail.nodes.clone(),
            None => plugin.node_kinds.iter().map(super::models::CatalogNodeKind::to_node).collect(),
        };
    }
    resolved
}
