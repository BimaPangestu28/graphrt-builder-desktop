//! Where a plugin comes from and who maintains it: the catalog's `source`, `publisher` and
//! `repository_url` (see the catalog v2 spec, "plugin source and publisher"), plus the
//! app-side `local` source of sideloaded plugins.
//!
//! - `official`: built from the graphrt-plugins monorepo (also when `source` is missing).
//! - `community`: a third-party plugin, reviewed and mirrored by the graphrt maintainers.
//! - `local`: installed by the user from a folder or archive (Settings › Developer mode).
//!   Never published by a catalog: a catalog saying `local` counts as official (logged).
//!
//! Invalid optional values only lose that value; the entry stays listed.

use serde::{Deserialize, Serialize};

use super::display_name::validate_display_name;
use super::download::require_https;
use super::models::CatalogPlugin;

/// Longest publisher name accepted, in characters (same rule as display names).
pub(crate) const MAX_PUBLISHER_CHARS: usize = super::display_name::MAX_DISPLAY_NAME_CHARS;

/// Where an installed or listed plugin comes from (snake_case on the wire and in records).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginSource {
    /// Built from the graphrt-plugins monorepo.
    #[default]
    Official,
    /// Third-party, reviewed and mirrored by the graphrt maintainers.
    Community,
    /// Sideloaded from a folder or `.tar.gz` on this computer; not reviewed.
    Local,
}

/// The catalog's `source`: `"official"` or `"community"`; a missing value is official.
///
/// # Errors
/// The unknown value (including `"local"`, which only the app assigns); callers treat it as official.
pub(crate) fn parse_catalog_source(raw: Option<&str>) -> Result<PluginSource, String> {
    match raw.map(str::trim) {
        None | Some("official") => Ok(PluginSource::Official),
        Some("community") => Ok(PluginSource::Community),
        Some(other) => Err(other.to_owned()),
    }
}

/// The publisher name, trimmed, or `None` when it is blank, longer than
/// [`MAX_PUBLISHER_CHARS`] or contains control characters.
pub(crate) fn validate_publisher(raw: &str) -> Option<String> {
    validate_display_name(raw)
}

/// Normalizes the source fields of a catalog entry (logged when one is dropped): `source`
/// becomes `"official"` or `"community"`, `publisher` is trimmed or cleared, and a
/// `repository_url` that is not `https://` is cleared.
pub(super) fn clean_source_fields(plugin: &mut CatalogPlugin) {
    let source = parse_catalog_source(plugin.source.as_deref()).unwrap_or_else(|unknown| {
        log::warn!("catalog entry `{}` has an unknown source {unknown:?}; treating it as official", plugin.name);
        PluginSource::Official
    });
    plugin.source = Some(source_wire_name(source).to_owned());
    if let Some(raw) = plugin.publisher.take() {
        plugin.publisher = validate_publisher(&raw);
        if plugin.publisher.is_none() {
            log::warn!(
                "ignoring the publisher of catalog entry `{}`: it must be 1 to {MAX_PUBLISHER_CHARS} characters without control characters",
                plugin.name
            );
        }
    }
    if let Some(url) = &plugin.repository_url {
        if let Err(error) = require_https(url) {
            log::warn!("ignoring the repository link of catalog entry `{}`: {error}", plugin.name);
            plugin.repository_url = None;
        }
    }
}

/// The source of a parsed catalog entry (see [`clean_source_fields`]).
pub(crate) fn catalog_entry_source(plugin: &CatalogPlugin) -> PluginSource {
    parse_catalog_source(plugin.source.as_deref()).unwrap_or_default()
}

fn source_wire_name(source: PluginSource) -> &'static str {
    match source {
        PluginSource::Official => "official",
        PluginSource::Community => "community",
        PluginSource::Local => "local",
    }
}

/// Reads an install record's `source` leniently: missing or unknown is official, so one
/// odd value never makes the whole install-record setting unreadable.
pub(crate) fn lenient_record_source<'de, D>(deserializer: D) -> Result<PluginSource, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(fields: serde_json::Value) -> CatalogPlugin {
        let mut plugin = serde_json::json!({
            "name": "acme-tools", "version": "1.0.0",
            "tarball_url": "https://example.test/a.tar.gz", "sha256": "0".repeat(64)
        });
        for (key, value) in fields.as_object().unwrap() {
            plugin[key] = value.clone();
        }
        let mut parsed: CatalogPlugin = serde_json::from_value(plugin).unwrap();
        clean_source_fields(&mut parsed);
        parsed
    }

    #[test]
    fn catalog_sources_are_official_community_or_treated_as_official() {
        assert_eq!(parse_catalog_source(None), Ok(PluginSource::Official));
        assert_eq!(parse_catalog_source(Some("official")), Ok(PluginSource::Official));
        assert_eq!(parse_catalog_source(Some("community")), Ok(PluginSource::Community));
        assert_eq!(parse_catalog_source(Some("local")), Err("local".to_owned()), "only the app assigns local");
        assert_eq!(parse_catalog_source(Some("Community")), Err("Community".to_owned()));
        assert_eq!(catalog_entry_source(&entry(serde_json::json!({}))), PluginSource::Official);
        assert_eq!(catalog_entry_source(&entry(serde_json::json!({ "source": "community" }))), PluginSource::Community);
        assert_eq!(catalog_entry_source(&entry(serde_json::json!({ "source": "local" }))), PluginSource::Official);
        assert_eq!(catalog_entry_source(&entry(serde_json::json!({ "source": 7 }))), PluginSource::Official);
    }

    #[test]
    fn publishers_are_trimmed_and_invalid_ones_dropped() {
        assert_eq!(entry(serde_json::json!({ "publisher": "  Acme Inc. " })).publisher.as_deref(), Some("Acme Inc."));
        assert_eq!(entry(serde_json::json!({ "publisher": "   " })).publisher, None);
        assert_eq!(entry(serde_json::json!({ "publisher": "Acme\u{0}Inc" })).publisher, None);
        assert_eq!(entry(serde_json::json!({ "publisher": "a".repeat(MAX_PUBLISHER_CHARS + 1) })).publisher, None);
        assert_eq!(
            entry(serde_json::json!({ "publisher": "é".repeat(MAX_PUBLISHER_CHARS) }))
                .publisher
                .map(|name| name.chars().count()),
            Some(MAX_PUBLISHER_CHARS)
        );
        assert_eq!(entry(serde_json::json!({ "publisher": ["Acme"] })).publisher, None);
    }

    #[test]
    fn repository_links_must_be_https() {
        let https = entry(serde_json::json!({ "repository_url": "https://github.com/acme/tools" }));
        assert_eq!(https.repository_url.as_deref(), Some("https://github.com/acme/tools"));
        assert_eq!(entry(serde_json::json!({ "repository_url": "http://github.com/acme/tools" })).repository_url, None);
        assert_eq!(entry(serde_json::json!({ "repository_url": "javascript:alert(1)" })).repository_url, None);
    }

    #[test]
    fn install_record_sources_are_read_leniently() {
        #[derive(Deserialize)]
        struct Record {
            #[serde(default, deserialize_with = "lenient_record_source")]
            source: PluginSource,
        }
        let read = |json: serde_json::Value| serde_json::from_value::<Record>(json).unwrap().source;
        assert_eq!(read(serde_json::json!({})), PluginSource::Official);
        assert_eq!(read(serde_json::json!({ "source": "local" })), PluginSource::Local);
        assert_eq!(read(serde_json::json!({ "source": "community" })), PluginSource::Community);
        assert_eq!(read(serde_json::json!({ "source": "martian" })), PluginSource::Official);
    }
}
