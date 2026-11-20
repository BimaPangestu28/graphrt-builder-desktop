//! The plugin catalog (`index.json` of the graphrt-plugins `catalog` release):
//! parsing, validation, the on-disk cache and the "available vs installed" view.

use std::path::Path;

use super::download::require_https;
use super::host::PluginState;
use super::models::{CatalogIndex, CatalogPlugin, PluginCatalog, PluginCatalogEntry, PluginPermissions};
use crate::error::{AppError, AppResult};

/// Where the published catalog lives.
pub const DEFAULT_CATALOG_URL: &str =
    "https://github.com/BimaPangestu28/graphrt-plugins/releases/download/catalog/index.json";
/// Catalog schema this app understands.
const CATALOG_SCHEMA: u32 = 1;
/// Largest catalog accepted. The catalog carries every node's config schema, so it
/// grows with the plugin count (146 plugins: 2.0 MB compact, 3.5 MB indented).
pub(super) const MAX_CATALOG_BYTES: u64 = 16 * 1024 * 1024;

/// Parses the catalog. Entries with an invalid name, a non-https tarball URL
/// or a malformed checksum are dropped (logged), so one bad entry does not
/// hide the others. A non-https `icon_url` only loses the icon.
///
/// # Errors
/// `InvalidInput` when the document is not JSON or uses another schema.
pub(super) fn parse_catalog(bytes: &[u8]) -> AppResult<CatalogIndex> {
    let mut index: CatalogIndex = serde_json::from_slice(bytes)
        .map_err(|error| AppError::InvalidInput(format!("the plugin catalog is not valid: {error}")))?;
    if index.schema != CATALOG_SCHEMA {
        return Err(AppError::InvalidInput(format!(
            "the plugin catalog uses schema {}; this app understands schema {CATALOG_SCHEMA}. Update the app",
            index.schema
        )));
    }
    for plugin in &mut index.plugins {
        drop_invalid_icon_url(plugin);
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
    let is_sha256 = plugin.sha256.len() == 64 && plugin.sha256.chars().all(|character| character.is_ascii_hexdigit());
    if !is_sha256 {
        return Err(AppError::InvalidInput("sha256 is not 64 hex characters".into()));
    }
    if let Some(readme_url) = &plugin.readme_url {
        require_https(readme_url)?;
    }
    Ok(())
}

/// Clears an `icon_url` that is not `https://` (logged); the entry stays listed.
fn drop_invalid_icon_url(plugin: &mut CatalogPlugin) {
    let Some(icon_url) = &plugin.icon_url else { return };
    if let Err(error) = require_https(icon_url) {
        log::warn!("ignoring the icon of catalog entry `{}`: {error}", plugin.name);
        plugin.icon_url = None;
    }
}

/// Reads the saved catalog, if any (and still valid).
pub(super) fn read_cached(cache_file: &Path) -> Option<CatalogIndex> {
    let bytes = std::fs::read(cache_file).ok()?;
    match parse_catalog(&bytes) {
        Ok(index) => Some(index),
        Err(error) => {
            log::warn!("ignoring the saved plugin catalog: {error}");
            None
        }
    }
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

/// The catalog with each plugin's install state.
pub(super) fn catalog_view(index: &CatalogIndex, installed: &[PluginState], from_cache: bool) -> PluginCatalog {
    let plugins = index
        .plugins
        .iter()
        .map(|plugin| {
            let installed_state = installed.iter().find(|state| state.name == plugin.name);
            let installed_version = installed_state.map(|state| state.version.clone());
            let update_available = installed_version.as_ref().is_some_and(|version| version != &plugin.version);
            PluginCatalogEntry {
                update_available,
                update_needs_approval: update_available
                    && installed_state.is_some_and(|state| update_asks_for_more(plugin, state)),
                installed_version,
                name: plugin.name.clone(),
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
            }
        })
        .collect();
    PluginCatalog { plugins, generated_at: index.generated_at.clone(), from_cache }
}
