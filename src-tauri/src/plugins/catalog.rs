//! The plugin catalog (`index-v2.json`, else v1 `index.json`, of the graphrt-plugins
//! `catalog` release): parsing, validation, the on-disk saved copies and the
//! "available vs installed" view.

use std::path::Path;
use std::time::SystemTime;

use super::display_name::{resolve_display_name, validate_display_name, MAX_DISPLAY_NAME_CHARS};
use super::download::require_https;
use super::host::PluginState;
use super::models::{CatalogIndex, CatalogPlugin, PluginCatalog, PluginCatalogEntry, PluginPermissions};
use crate::error::{AppError, AppResult};

/// Where the published v1 catalog lives; v2 sits next to it (see [`v2_catalog_url`]).
pub const DEFAULT_CATALOG_URL: &str =
    "https://github.com/BimaPangestu28/graphrt-plugins/releases/download/catalog/index.json";
/// File name of the v1 catalog in its release; the v2 index replaces it with [`V2_INDEX_FILE_NAME`].
const V1_INDEX_FILE_NAME: &str = "index.json";
const V2_INDEX_FILE_NAME: &str = "index-v2.json";
/// Schema of v1 `index.json` (every node's config schema inline).
pub(super) const CATALOG_SCHEMA_V1: u32 = 1;
/// Schema of `index-v2.json` (slim index; nodes in per-version detail files).
pub(super) const CATALOG_SCHEMA_V2: u32 = 2;
/// Largest v1 catalog accepted. It carries every node's config schema, so it
/// grows with the plugin count (146 plugins: 2.0 MB compact, 3.5 MB indented).
pub(super) const MAX_CATALOG_BYTES: u64 = 16 * 1024 * 1024;
/// Largest `index-v2.json` accepted (published well under 500 KB).
pub(super) const MAX_CATALOG_V2_BYTES: u64 = 4 * 1024 * 1024;
/// Largest detail file accepted (and the most `detail_size_bytes` may say).
pub(super) const MAX_DETAIL_BYTES: u64 = 1024 * 1024;
/// Longest plugin version used in a detail file name.
const MAX_VERSION_CHARS: usize = 64;

/// The `index-v2.json` URL next to a v1 `.../index.json` URL, or `None` when the
/// catalog URL does not end that way (then only v1 is read).
pub(super) fn v2_catalog_url(v1_catalog_url: &str) -> Option<String> {
    let base = v1_catalog_url.strip_suffix(V1_INDEX_FILE_NAME)?;
    base.ends_with('/').then(|| format!("{base}{V2_INDEX_FILE_NAME}"))
}

/// Parses a v1 catalog (`index.json`). See [`parse_catalog_as`].
///
/// # Errors
/// `InvalidInput` when the document is not JSON or uses another schema.
pub(super) fn parse_catalog(bytes: &[u8]) -> AppResult<CatalogIndex> {
    parse_catalog_as(bytes, CATALOG_SCHEMA_V1)
}

/// Parses a v2 catalog (`index-v2.json`). See [`parse_catalog_as`].
///
/// # Errors
/// `InvalidInput` when the document is not JSON or uses another schema.
pub(super) fn parse_catalog_v2(bytes: &[u8]) -> AppResult<CatalogIndex> {
    parse_catalog_as(bytes, CATALOG_SCHEMA_V2)
}

/// Parses a catalog that must use `expected_schema`. Entries with an invalid name, a
/// non-https tarball URL or a malformed checksum are dropped (logged), so one bad
/// entry does not hide the others. Invalid optional fields only lose that field: a
/// non-https `icon_url`, an invalid `display_name` (see [`clean_display_name`]), an
/// unknown `source`, invalid `publisher` or non-https `repository_url` (see
/// `source::clean_source_fields`) and,
/// in v2, invalid detail fields (see [`clean_detail_fields`]).
///
/// # Errors
/// `InvalidInput` when the document is not JSON or uses another schema.
pub(super) fn parse_catalog_as(bytes: &[u8], expected_schema: u32) -> AppResult<CatalogIndex> {
    let mut index: CatalogIndex = serde_json::from_slice(bytes)
        .map_err(|error| AppError::InvalidInput(format!("the plugin catalog is not valid: {error}")))?;
    if index.schema != expected_schema {
        return Err(AppError::InvalidInput(format!(
            "the plugin catalog uses schema {}; expected schema {expected_schema}. Update the app",
            index.schema
        )));
    }
    for plugin in &mut index.plugins {
        drop_invalid_icon_url(plugin);
        clean_display_name(plugin);
        super::source::clean_source_fields(plugin);
        if expected_schema == CATALOG_SCHEMA_V2 {
            clean_detail_fields(plugin);
        } else {
            clear_v2_fields(plugin);
        }
    }
    index.plugins.retain(|plugin| match validate_entry(plugin) {
        Ok(()) => true,
        Err(error) => {
            log::warn!("skipping catalog entry `{}`: {error}", plugin.name);
            false
        }
    });
    Ok(index)
}

fn validate_entry(plugin: &CatalogPlugin) -> AppResult<()> {
    if !graphrt_plugin::is_valid_name(&plugin.name) {
        return Err(AppError::InvalidInput("invalid plugin name".into()));
    }
    require_https(&plugin.tarball_url)?;
    if !is_sha256_hex(&plugin.sha256) {
        return Err(AppError::InvalidInput("sha256 is not 64 hex characters".into()));
    }
    if let Some(readme_url) = &plugin.readme_url {
        require_https(readme_url)?;
    }
    Ok(())
}

fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64 && text.chars().all(|character| character.is_ascii_hexdigit())
}

/// Whether `version` is safe in a file name (`<name>-<version>.json`): 1 to
/// [`MAX_VERSION_CHARS`] of `A-Z a-z 0-9 . + - _`, starting with a letter or digit.
pub(super) fn is_safe_version(version: &str) -> bool {
    let starts_well = version.chars().next().is_some_and(|character| character.is_ascii_alphanumeric());
    starts_well
        && version.len() <= MAX_VERSION_CHARS
        && version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '+' | '-' | '_'))
}

/// Why the v2 detail fields of `plugin` cannot be used, or `None` when they can.
fn detail_fields_problem(plugin: &CatalogPlugin) -> Option<String> {
    let url = plugin.detail_url.as_deref()?;
    if let Err(error) = require_https(url) {
        return Some(error.to_string());
    }
    if !plugin.detail_sha256.as_deref().is_some_and(is_sha256_hex) {
        return Some("detail_sha256 is not 64 hex characters".into());
    }
    match plugin.detail_size_bytes {
        Some(size) if size > 0 && size <= MAX_DETAIL_BYTES => {}
        _ => return Some(format!("detail_size_bytes must be 1 to {MAX_DETAIL_BYTES}")),
    }
    if !is_safe_version(&plugin.version) {
        return Some("the version cannot name a detail file".into());
    }
    None
}

/// Clears the detail fields of a v2 entry (logged) when any is invalid: the entry stays
/// listed with its `node_kinds`, only without config schemas.
fn clean_detail_fields(plugin: &mut CatalogPlugin) {
    let Some(problem) = detail_fields_problem(plugin) else {
        if plugin.detail_url.is_none() {
            plugin.detail_sha256 = None;
            plugin.detail_size_bytes = None;
        }
        return;
    };
    log::warn!("ignoring the detail file of catalog entry `{}`: {problem}", plugin.name);
    plugin.detail_url = None;
    plugin.detail_sha256 = None;
    plugin.detail_size_bytes = None;
}

/// v1 entries carry their nodes inline; v2-only fields there are ignored.
fn clear_v2_fields(plugin: &mut CatalogPlugin) {
    plugin.node_kinds.clear();
    plugin.detail_url = None;
    plugin.detail_sha256 = None;
    plugin.detail_size_bytes = None;
}

/// Clears an `icon_url` that is not `https://` (logged); the entry stays listed.
fn drop_invalid_icon_url(plugin: &mut CatalogPlugin) {
    let Some(icon_url) = &plugin.icon_url else { return };
    if let Err(error) = require_https(icon_url) {
        log::warn!("ignoring the icon of catalog entry `{}`: {error}", plugin.name);
        plugin.icon_url = None;
    }
}

/// Trims `display_name`, or clears it (logged) when it is blank, too long or has control
/// characters; the entry stays listed and shows its humanized name instead.
fn clean_display_name(plugin: &mut CatalogPlugin) {
    let Some(raw) = plugin.display_name.take() else { return };
    plugin.display_name = validate_display_name(&raw);
    if plugin.display_name.is_none() {
        log::warn!(
            "ignoring the display name of catalog entry `{}`: it must be 1 to {MAX_DISPLAY_NAME_CHARS} characters without control characters",
            plugin.name
        );
    }
}

/// The saved copies of the catalog: v2 and v1 live under distinct names.
#[derive(Debug, Clone)]
pub(super) struct SavedCatalogFiles {
    pub v1: std::path::PathBuf,
    pub v2: std::path::PathBuf,
}

impl SavedCatalogFiles {
    /// The saved copy for a catalog of `schema`.
    pub fn for_schema(&self, schema: u32) -> &Path {
        if schema == CATALOG_SCHEMA_V2 {
            &self.v2
        } else {
            &self.v1
        }
    }

    /// The most recently saved valid copy (v2 or v1), if any.
    pub fn read_newest(&self) -> Option<CatalogIndex> {
        let v2 = read_saved_as(&self.v2, CATALOG_SCHEMA_V2);
        let v1 = read_saved_as(&self.v1, CATALOG_SCHEMA_V1);
        match (v2, v1) {
            (Some((v2_index, v2_saved_at)), Some((v1_index, v1_saved_at))) => {
                Some(if v1_saved_at > v2_saved_at { v1_index } else { v2_index })
            }
            (Some((index, _)), None) | (None, Some((index, _))) => Some(index),
            (None, None) => None,
        }
    }
}

/// Reads a saved catalog of `schema` and when it was saved, if it exists and is still valid.
fn read_saved_as(cache_file: &Path, schema: u32) -> Option<(CatalogIndex, SystemTime)> {
    let bytes = std::fs::read(cache_file).ok()?;
    let saved_at =
        std::fs::metadata(cache_file).and_then(|metadata| metadata.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    match parse_catalog_as(&bytes, schema) {
        Ok(index) => Some((index, saved_at)),
        Err(error) => {
            log::warn!("ignoring the saved plugin catalog {}: {error}", cache_file.display());
            None
        }
    }
}

/// Whether `candidate` is a newer version than `installed` (`1.10.0` > `1.9.2`).
/// Numeric dot parts are compared in order; a pre-release (`1.2.0-beta`) counts as
/// older than its release. Versions that don't parse are never "newer", so an odd
/// or older catalog entry can't downgrade an installed plugin.
pub(crate) fn is_newer_version(candidate: &str, installed: &str) -> bool {
    match (parse_version(candidate), parse_version(installed)) {
        (Some(candidate), Some(installed)) => candidate > installed,
        _ => false,
    }
}

/// `1.2.3` → ([1, 2, 3], is_release); `1.2.3-beta.1` → ([1, 2, 3], false).
fn parse_version(version: &str) -> Option<(Vec<u64>, bool)> {
    let version = version.trim().trim_start_matches('v');
    let (core, pre_release) = match version.split_once('-') {
        Some((core, _)) => (core, true),
        None => (version.split('+').next().unwrap_or(version), false),
    };
    let parts = core.split('.').map(|part| part.parse::<u64>().ok()).collect::<Option<Vec<_>>>()?;
    if parts.is_empty() {
        return None;
    }
    let mut padded = parts;
    padded.resize(3.max(padded.len()), 0);
    Some((padded, !pre_release))
}

/// Saves the raw catalog next to the plugins (written then renamed).
pub(super) fn write_cache(cache_file: &Path, bytes: &[u8]) {
    let temporary = cache_file.with_extension("json.tmp");
    let result = std::fs::write(&temporary, bytes).and_then(|()| std::fs::rename(&temporary, cache_file));
    if let Err(error) = result {
        log::warn!("could not save the plugin catalog: {error}");
    }
}

/// Whether the catalog version of `plugin` asks for more than the installed copy
/// (`installed`'s manifest permissions): such an update waits for the user.
pub(super) fn update_asks_for_more(plugin: &CatalogPlugin, installed: &PluginState) -> bool {
    PluginPermissions::from(&plugin.permissions).asks_for_more_than(&installed.permissions)
}

/// How the catalog shown was obtained.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct CatalogOrigin {
    /// The fetch failed; this is the last saved copy.
    pub from_cache: bool,
    /// When this session fetched it (RFC 3339); `None` for a saved copy.
    pub fetched_at: Option<String>,
}

/// The catalog with each plugin's install state. `index` must already be resolved
/// (v2 nodes filled from details, see `details::resolve_catalog`).
pub(super) fn catalog_view(index: &CatalogIndex, installed: &[PluginState], origin: CatalogOrigin) -> PluginCatalog {
    let plugins = index
        .plugins
        .iter()
        .map(|plugin| {
            let installed_state = installed.iter().find(|state| state.name == plugin.name);
            let installed_version = installed_state.map(|state| state.version.clone());
            let update_available =
                installed_version.as_ref().is_some_and(|version| is_newer_version(&plugin.version, version));
            PluginCatalogEntry {
                update_available,
                update_needs_approval: update_available
                    && installed_state.is_some_and(|state| update_asks_for_more(plugin, state)),
                installed_version,
                name: plugin.name.clone(),
                display_name: resolve_display_name(&plugin.name, [plugin.display_name.as_deref()]),
                version: plugin.version.clone(),
                description: plugin.description.clone(),
                permissions: PluginPermissions::from(&plugin.permissions),
                needs_browser: plugin.needs_browser,
                nodes: plugin.nodes.iter().map(super::models::CatalogNode::info).collect(),
                tools: plugin.tools.clone(),
                readme_url: plugin.readme_url.clone(),
                icon_url: plugin.icon_url.clone(),
                warning: plugin.warning.clone().filter(|warning| !warning.trim().is_empty()),
                status: plugin.status.clone(),
                tos_risk: plugin.tos_risk.clone(),
                size_bytes: plugin.size_bytes,
                source: super::source::catalog_entry_source(plugin),
                publisher: plugin.publisher.clone(),
                repository_url: plugin.repository_url.clone(),
            }
        })
        .collect();
    PluginCatalog {
        plugins,
        generated_at: index.generated_at.clone(),
        from_cache: origin.from_cache,
        fetched_at: origin.fetched_at,
    }
}

#[cfg(test)]
mod version_order_tests {
    use super::is_newer_version;

    #[test]
    fn only_newer_versions_count_as_updates() {
        assert!(is_newer_version("0.2.1", "0.2.0"));
        assert!(is_newer_version("1.10.0", "1.9.2"));
        assert!(is_newer_version("1.2.0", "1.2.0-beta.1"));
        assert!(is_newer_version("v2.0", "1.9.9"));
        assert!(!is_newer_version("0.2.0", "0.2.1"), "never a downgrade");
        assert!(!is_newer_version("0.2.0", "0.2.0"));
        assert!(!is_newer_version("1.2.0-beta.1", "1.2.0"));
        assert!(!is_newer_version("latest", "0.1.0"), "unparseable never counts");
    }
}
