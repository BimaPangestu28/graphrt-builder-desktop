//! The plugin catalog (`index-v2.json`, else v1 `index.json`, of the graphrt-plugins
//! `catalog` release): parsing, validation, the on-disk saved copies and the
//! "available vs installed" view.

use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;

use super::catalog_signature::{signature_location, CatalogKeys, REQUIRE_CATALOG_SIGNATURE};
use super::display_name::{resolve_display_name, validate_display_name, MAX_DISPLAY_NAME_CHARS};
use super::download::require_https;
use super::host::PluginState;
use super::models::{CatalogIndex, CatalogPlugin, CatalogSkill, PluginCatalog, PluginCatalogEntry, PluginPermissions};
use crate::error::{AppError, AppResult};

/// Where the published v1 catalog lives; v2 sits next to it (see [`v2_catalog_url`]).
pub const DEFAULT_CATALOG_URL: &str = "https://github.com/Graphrt/graphrt-plugins/releases/download/catalog/index.json";
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

/// Path segment after which GitHub serves a repository's release assets.
const RELEASES_DOWNLOAD_PATH: &str = "/releases/download/";

/// Where every tarball, icon and detail of the catalog at `catalog_url` must live: its
/// origin plus the path up to and including `/releases/download/` (any release of the same
/// repository), or, for a catalog not served from GitHub releases, its own folder. `None`
/// when `catalog_url` is not a URL. Downloads may still be redirected to GitHub's asset
/// hosts; only the published link is checked.
pub(super) fn release_asset_prefix(catalog_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(catalog_url).ok()?;
    let path = url.path();
    let prefix_path = match path.find(RELEASES_DOWNLOAD_PATH) {
        Some(start) => &path[..start + RELEASES_DOWNLOAD_PATH.len()],
        None => &path[..=path.rfind('/')?],
    };
    Some(format!("{}{prefix_path}", url.origin().ascii_serialization()))
}

/// Whether `url`, once parsed and normalized (dot segments resolved, no user info), is an
/// `https://` URL under `prefix`.
pub(super) fn is_under_prefix(url: &str, prefix: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    !prefix.is_empty()
        && parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.as_str().starts_with(prefix)
}

/// Drops entries whose `tarball_url` is not under `prefix` (see [`release_asset_prefix`])
/// and clears an `icon_url` or detail link that is not (logged); applied to fetched and
/// saved catalogs alike. Without a prefix (the catalog URL is not a URL) nothing is allowed.
pub(super) fn restrict_asset_urls(index: &mut CatalogIndex, prefix: Option<&str>) {
    let prefix = prefix.unwrap_or_default();
    index.plugins.retain(|plugin| {
        let allowed = is_under_prefix(&plugin.tarball_url, prefix);
        if !allowed {
            log::warn!("skipping catalog entry `{}`: its tarball is not under {prefix}", plugin.name);
        }
        allowed
    });
    index.skills.retain(|skill| {
        let allowed = is_under_prefix(&skill.tarball_url, prefix);
        if !allowed {
            log::warn!("skipping catalog skill `{}`: its archive is not under {prefix}", skill.name);
        }
        allowed
    });
    for plugin in &mut index.plugins {
        if plugin.icon_url.as_deref().is_some_and(|url| !is_under_prefix(url, prefix)) {
            log::warn!("ignoring the icon of catalog entry `{}`: it is not under {prefix}", plugin.name);
            plugin.icon_url = None;
        }
        if plugin.detail_url.as_deref().is_some_and(|url| !is_under_prefix(url, prefix)) {
            log::warn!("ignoring the detail file of catalog entry `{}`: it is not under {prefix}", plugin.name);
            plugin.detail_url = None;
            plugin.detail_sha256 = None;
            plugin.detail_size_bytes = None;
        }
    }
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
    drop_duplicate_names(&mut index.plugins);
    clean_skills(&mut index.skills);
    Ok(index)
}

/// Drops skills with an invalid name or version, a non-https archive link or a malformed
/// checksum (logged), keeps the first entry per name, and clears invalid optional fields.
fn clean_skills(skills: &mut Vec<CatalogSkill>) {
    let mut seen_names = std::collections::HashSet::new();
    skills.retain(|skill| {
        let problem = if !graphrt_skill::is_valid_name(&skill.name) {
            Some("invalid skill name")
        } else if !skill.version.is_empty() && !is_safe_version(&skill.version) {
            Some("invalid version")
        } else if require_https(&skill.tarball_url).is_err() {
            Some("its archive link is not https")
        } else if !is_sha256_hex(&skill.sha256) {
            Some("sha256 is not 64 hex characters")
        } else if !seen_names.insert(skill.name.clone()) {
            Some("duplicate name")
        } else {
            None
        };
        if let Some(problem) = problem {
            log::warn!("skipping catalog skill `{}`: {problem}", skill.name);
        }
        problem.is_none()
    });
    for skill in skills {
        skill.display_name = skill.display_name.as_deref().and_then(super::display_name::validate_display_name);
        skill.publisher = skill.publisher.as_deref().and_then(super::source::validate_publisher);
    }
}

/// Keeps one entry per plugin name: the first official one, else the first one (logged),
/// so a community entry can never shadow or be confused with an official plugin.
fn drop_duplicate_names(plugins: &mut Vec<CatalogPlugin>) {
    let mut kept_index_by_name: HashMap<&str, usize> = HashMap::new();
    for (index, plugin) in plugins.iter().enumerate() {
        let is_official = super::source::catalog_entry_source(plugin) == super::source::PluginSource::Official;
        match kept_index_by_name.get(plugin.name.as_str()) {
            None => {
                kept_index_by_name.insert(&plugin.name, index);
            }
            Some(&kept) => {
                let kept_is_official =
                    super::source::catalog_entry_source(&plugins[kept]) == super::source::PluginSource::Official;
                if is_official && !kept_is_official {
                    kept_index_by_name.insert(&plugin.name, index);
                }
            }
        }
    }
    let kept: std::collections::HashSet<usize> = kept_index_by_name.into_values().collect();
    let mut index = 0;
    plugins.retain(|plugin| {
        let keep = kept.contains(&index);
        if !keep {
            log::warn!(
                "dropping a duplicate catalog entry `{}` ({} {})",
                plugin.name,
                plugin.version,
                plugin.source.as_deref().unwrap_or("official")
            );
        }
        index += 1;
        keep
    });
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

/// Whether `version` is safe in a file name (`<name>@<version>.json`, so never `@`): 1 to
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
            "ignoring the display name of catalog entry `{}`: it must be 1 to {MAX_DISPLAY_NAME_CHARS} characters without control or invisible format characters",
            plugin.name
        );
    }
}

/// The saved copies of the catalog: v2 and v1 live under distinct names.
#[derive(Debug, Clone)]
pub(super) struct SavedCatalogFiles {
    pub v1: std::path::PathBuf,
    pub v2: std::path::PathBuf,
    /// Exists once a v2 index was fetched: from then on v1 is never used (no downgrade).
    pub v2_marker: std::path::PathBuf,
    /// See [`release_asset_prefix`]; `None` drops every entry (the catalog URL is not a URL).
    pub asset_prefix: Option<String>,
    /// Keys the saved copies are verified with again when read (see `catalog_signature`).
    pub keys: CatalogKeys,
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

    /// Whether a v2 index was fetched on this computer before (then v1 is never used).
    pub fn has_seen_v2(&self) -> bool {
        self.v2_marker.exists()
    }

    /// Remembers that a v2 index was fetched (logged when it cannot be written), then
    /// deletes the saved v1 copy, which is never read again.
    pub fn remember_v2(&self) {
        if !self.has_seen_v2() {
            if let Err(error) = std::fs::write(&self.v2_marker, b"catalog v2 fetched; v1 is not used any more\n") {
                log::warn!("could not remember that the plugin catalog moved to v2: {error}");
                return;
            }
        }
        self.remove_obsolete_v1();
    }

    /// Deletes the saved v1 copy and its signature once v2 was fetched (v1 is then never
    /// read again). Failures are logged; a leftover copy is only wasted disk space.
    pub fn remove_obsolete_v1(&self) {
        if !self.has_seen_v2() {
            return;
        }
        for obsolete in [self.v1.clone(), signature_path(&self.v1)] {
            match std::fs::remove_file(&obsolete) {
                Ok(()) => log::info!("removed the obsolete plugin catalog copy {}", obsolete.display()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    log::warn!("could not remove the obsolete plugin catalog copy {}: {error}", obsolete.display())
                }
            }
        }
    }

    /// The most recently saved valid copy (v2 or v1), if any; only v2 once v2 was fetched.
    pub fn read_newest(&self) -> Option<CatalogIndex> {
        let v2 = self.read_saved_as(&self.v2, CATALOG_SCHEMA_V2);
        if self.has_seen_v2() {
            return v2.map(|(index, _)| index);
        }
        let v1 = self.read_saved_as(&self.v1, CATALOG_SCHEMA_V1);
        match (v2, v1) {
            (Some((v2_index, v2_saved_at)), Some((v1_index, v1_saved_at))) => {
                Some(if v1_saved_at > v2_saved_at { v1_index } else { v2_index })
            }
            (Some((index, _)), None) | (None, Some((index, _))) => Some(index),
            (None, None) => None,
        }
    }

    /// Saves a fetched index and its signature (each written then renamed; the signature
    /// first, so an index is never saved next to an older signature that would fail it).
    pub fn save(&self, schema: u32, bytes: &[u8], signature: Option<&str>) {
        let cache_file = self.for_schema(schema);
        if let Some(signature) = signature {
            write_cache(&signature_path(cache_file), signature.as_bytes());
        }
        write_cache(cache_file, bytes);
    }

    /// Reads a saved catalog of `schema` and when it was saved, if it exists and is still
    /// valid: its saved signature verified again, then parsed, with the asset links checked
    /// like a fetched one.
    fn read_saved_as(&self, cache_file: &Path, schema: u32) -> Option<(CatalogIndex, SystemTime)> {
        let bytes = std::fs::read(cache_file).ok()?;
        if let Err(error) = self.verify_saved(cache_file, &bytes) {
            log::warn!("ignoring the saved plugin catalog {}: {error}", cache_file.display());
            return None;
        }
        let saved_at =
            std::fs::metadata(cache_file).and_then(|metadata| metadata.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
        match parse_catalog_as(&bytes, schema) {
            Ok(mut index) => {
                restrict_asset_urls(&mut index, self.asset_prefix.as_deref());
                Some((index, saved_at))
            }
            Err(error) => {
                log::warn!("ignoring the saved plugin catalog {}: {error}", cache_file.display());
                None
            }
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

/// Whether `version` is `minimum` or newer, by the rules of [`is_newer_version`].
/// `None` when `minimum` is not a version; a `version` that is not one is never new enough.
pub(crate) fn version_is_at_least(version: &str, minimum: &str) -> Option<bool> {
    let minimum = parse_version(minimum)?;
    Some(parse_version(version).is_some_and(|version| version >= minimum))
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

impl SavedCatalogFiles {
    /// Verifies a saved index against the signature saved next to it.
    fn verify_saved(&self, cache_file: &Path, bytes: &[u8]) -> AppResult<()> {
        match std::fs::read_to_string(signature_path(cache_file)) {
            Ok(signature) => self.keys.verify(bytes, &signature),
            Err(_) if !REQUIRE_CATALOG_SIGNATURE => Ok(()),
            Err(error) => Err(AppError::InvalidInput(format!(
                "the plugin catalog signature is not valid: it has no saved signature ({error})"
            ))),
        }
    }
}

/// `<cache file>.minisig`.
fn signature_path(cache_file: &Path) -> std::path::PathBuf {
    std::path::PathBuf::from(signature_location(&cache_file.to_string_lossy()))
}

/// Saves a file next to the plugins (written then renamed).
fn write_cache(cache_file: &Path, bytes: &[u8]) {
    let temporary = std::path::PathBuf::from(format!("{}.tmp", cache_file.display()));
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
    /// Why the fetch failed, for a saved copy (e.g. an invalid signature).
    pub fetch_error: Option<String>,
}

/// The catalog with each plugin's install state. `index` must already be resolved
/// (v2 nodes filled from details, see `details::resolve_catalog`).
///
/// `app_version` is this app's version: an entry that needs a newer one says so in
/// `needs_newer_app` (see `app_requirement`).
pub(super) fn catalog_view(
    index: &CatalogIndex,
    installed: &[PluginState],
    origin: CatalogOrigin,
    app_version: &str,
) -> PluginCatalog {
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
                mcp_server: plugin.mcp_server.clone(),
                needs_newer_app: super::app_requirement::newer_app_needed(
                    plugin.min_app_version.as_deref(),
                    app_version,
                ),
            }
        })
        .collect();
    PluginCatalog {
        plugins,
        generated_at: index.generated_at.clone(),
        from_cache: origin.from_cache,
        fetched_at: origin.fetched_at,
        fetch_error: origin.fetch_error,
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

#[cfg(test)]
mod parse_tests {
    use super::{parse_catalog, parse_catalog_v2};

    fn entry(name: &str, description: &str, source: Option<&str>) -> serde_json::Value {
        let mut entry = serde_json::json!({
            "name": name, "version": "1.0.0", "description": description,
            "tarball_url": format!("https://plugins.example.test/{name}.tar.gz"), "sha256": "a".repeat(64)
        });
        if let Some(source) = source {
            entry["source"] = source.into();
        }
        entry
    }

    fn catalog(schema: u32, entries: Vec<serde_json::Value>) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "schema": schema, "plugins": entries })).unwrap()
    }

    fn descriptions(index: &crate::plugins::models::CatalogIndex) -> Vec<(&str, &str)> {
        index.plugins.iter().map(|plugin| (plugin.name.as_str(), plugin.description.as_str())).collect()
    }

    #[test]
    fn duplicate_names_keep_the_official_entry() {
        let bytes = catalog(
            1,
            vec![
                entry("acme", "community copy", Some("community")),
                entry("other", "other", None),
                entry("acme", "official", Some("official")),
                entry("acme", "second official", None),
            ],
        );
        let index = parse_catalog(&bytes).unwrap();
        assert_eq!(descriptions(&index), vec![("other", "other"), ("acme", "official")]);
    }

    #[test]
    fn duplicate_community_names_keep_the_first_entry() {
        let bytes =
            catalog(2, vec![entry("acme", "first", Some("community")), entry("acme", "second", Some("community"))]);
        let index = parse_catalog_v2(&bytes).unwrap();
        assert_eq!(descriptions(&index), vec![("acme", "first")]);
    }
}

#[cfg(test)]
mod asset_host_tests {
    use super::{parse_catalog_v2, release_asset_prefix, restrict_asset_urls, DEFAULT_CATALOG_URL};

    const RELEASES: &str = "https://github.com/Graphrt/graphrt-plugins/releases/download/";

    #[test]
    fn the_prefix_is_the_catalog_repository_releases() {
        assert_eq!(release_asset_prefix(DEFAULT_CATALOG_URL).as_deref(), Some(RELEASES));
        assert_eq!(
            release_asset_prefix("https://plugins.example.test/index.json").as_deref(),
            Some("https://plugins.example.test/"),
            "a catalog outside GitHub releases serves assets next to itself"
        );
        assert_eq!(
            release_asset_prefix("https://mirror.test/catalogs/v1/index.json").as_deref(),
            Some("https://mirror.test/catalogs/v1/")
        );
        assert_eq!(release_asset_prefix("not a url"), None);
    }

    fn entry(name: &str, tarball_url: &str, icon_url: &str, detail_url: &str) -> serde_json::Value {
        serde_json::json!({
            "name": name, "version": "1.0.0", "tarball_url": tarball_url, "sha256": "a".repeat(64),
            "icon_url": icon_url, "detail_url": detail_url, "detail_sha256": "b".repeat(64), "detail_size_bytes": 10
        })
    }

    #[test]
    fn assets_outside_the_releases_are_dropped() {
        let good = |file: &str| format!("{RELEASES}catalog/{file}");
        let entries = vec![
            entry("good", &good("good.tar.gz"), &good("good.svg"), &good("plugin-good-1.0.0.json")),
            entry("elsewhere", "https://evil.test/x.tar.gz", &good("e.svg"), &good("e.json")),
            entry(
                "other-repo",
                "https://github.com/someone/else/releases/download/x.tar.gz",
                &good("o.svg"),
                &good("o.json"),
            ),
            entry("traversal", &format!("{RELEASES}../../../someone/else/x.tar.gz"), &good("t.svg"), &good("t.json")),
            entry("encoded", &format!("{RELEASES}%2e%2e/%2e%2e/%2e%2e/x/y.tar.gz"), &good("t.svg"), &good("t.json")),
            entry(
                "userinfo",
                "https://github.com@evil.test/Graphrt/graphrt-plugins/releases/download/x.tar.gz",
                &good("u.svg"),
                &good("u.json"),
            ),
            entry("bad-optional", &good("b.tar.gz"), "https://evil.test/b.svg", "https://evil.test/b.json"),
        ];
        let bytes = serde_json::to_vec(&serde_json::json!({ "schema": 2, "plugins": entries })).unwrap();
        let mut index = parse_catalog_v2(&bytes).unwrap();

        restrict_asset_urls(&mut index, Some(RELEASES));
        let mut nothing_allowed = index.clone();
        restrict_asset_urls(&mut nothing_allowed, None);
        assert!(nothing_allowed.plugins.is_empty());

        let names: Vec<&str> = index.plugins.iter().map(|plugin| plugin.name.as_str()).collect();
        assert_eq!(names, ["good", "bad-optional"]);
        assert!(index.plugins[0].icon_url.is_some() && index.plugins[0].detail_url.is_some());
        let bad_optional = &index.plugins[1];
        assert_eq!((bad_optional.icon_url.as_deref(), bad_optional.detail_url.as_deref()), (None, None));
        assert_eq!((bad_optional.detail_sha256.as_deref(), bad_optional.detail_size_bytes), (None, None));
    }
}
