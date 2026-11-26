//! Plugins that need a newer version of this app.
//!
//! A catalog entry may say `min_app_version` (e.g. `"0.2.0"`): the oldest graphrt Desktop
//! that can use the plugin. graphrt-plugins works it out from what the plugin's manifest
//! uses (triggers, an MCP server, ...) when it builds the catalog. The value lives in the
//! catalog, not in `graphrt-plugin.json`: graphrt reads a manifest strictly, so a new
//! manifest key would make every older app refuse the plugin with "unknown field".
//!
//! - The Plugins screen gets [`NewerAppNeeded`] for an entry this app is too old for: it
//!   shows "Needs Graphrt Desktop X or newer" with a way to update, and no Install button.
//! - Installing or updating such a plugin anyway is refused with
//!   [`AppError::NeedsNewerApp`] before anything is downloaded, and automatic updates skip it.
//! - A value this app cannot read (a format from the future) counts as "needs a newer
//!   app" without a version: an app that cannot read the rule is not the app it asks for.
//! - A plugin installed from a folder or archive has no catalog entry. When graphrt
//!   refuses its manifest for a key, runtime or value it does not know
//!   ([`unknown_manifest_feature`]), the plugin was made for a newer app, and the error
//!   says so instead of "unknown field".

use serde::Serialize;

use super::catalog::{is_safe_version, version_is_at_least};
use crate::error::AppError;

/// The version of this app, compared with a plugin's `min_app_version`.
pub(crate) const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// This app is too old for a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewerAppNeeded {
    /// The oldest app version that can use the plugin, e.g. `0.3.0`; `None` when only
    /// "a newer one" is known.
    pub min_version: Option<String>,
}

impl NewerAppNeeded {
    /// The error for trying to install the plugin anyway.
    pub(crate) fn into_error(self) -> AppError {
        AppError::NeedsNewerApp { min_version: self.min_version, unknown_feature: None }
    }
}

/// Whether an app at `app_version` is too old for a plugin whose catalog entry says
/// `min_app_version`. `None` when the entry asks for nothing or the app is new enough.
pub(crate) fn newer_app_needed(min_app_version: Option<&str>, app_version: &str) -> Option<NewerAppNeeded> {
    let minimum = min_app_version?.trim();
    match version_is_at_least(app_version, minimum) {
        Some(true) => None,
        Some(false) if is_safe_version(minimum) => Some(NewerAppNeeded { min_version: Some(minimum.to_owned()) }),
        _ => Some(NewerAppNeeded { min_version: None }),
    }
}

/// The key, runtime or value graphrt did not know in a manifest it refused, e.g. `triggers`
/// from "unknown field `triggers`, expected one of ...". `None` for any other refusal.
pub(crate) fn unknown_manifest_feature(refusal: &str) -> Option<String> {
    const MARKERS: [&str; 3] = ["unknown field `", "unknown runtime `", "unknown variant `"];
    MARKERS.iter().find_map(|marker| {
        let after_marker = &refusal[refusal.find(marker)? + marker.len()..];
        let feature = &after_marker[..after_marker.find('`')?];
        let is_plain = !feature.is_empty()
            && feature.len() <= 64
            && feature.chars().all(|character| character.is_ascii_alphanumeric() || "_-.[]".contains(character));
        is_plain.then(|| feature.to_owned())
    })
}

/// The error for a manifest graphrt refused: [`AppError::NeedsNewerApp`] when it uses
/// something this app does not know, else `InvalidInput` with `describe(refusal)`.
pub(crate) fn manifest_refusal(refusal: String, describe: impl FnOnce(String) -> String) -> AppError {
    match unknown_manifest_feature(&refusal) {
        Some(feature) => {
            log::warn!("a plugin manifest was refused: {refusal}");
            AppError::NeedsNewerApp { min_version: None, unknown_feature: Some(feature) }
        }
        None => AppError::InvalidInput(describe(refusal)),
    }
}

#[cfg(test)]
mod tests {
    use super::{manifest_refusal, newer_app_needed, unknown_manifest_feature, NewerAppNeeded};
    use crate::error::AppError;

    fn needed(min_version: Option<&str>) -> Option<NewerAppNeeded> {
        Some(NewerAppNeeded { min_version: min_version.map(str::to_owned) })
    }

    #[test]
    fn an_entry_without_a_minimum_runs_on_every_version() {
        assert_eq!(newer_app_needed(None, "0.1.0"), None);
    }

    #[test]
    fn the_app_is_new_enough_at_or_above_the_minimum() {
        assert_eq!(newer_app_needed(Some("0.2.0"), "0.2.0"), None);
        assert_eq!(newer_app_needed(Some("0.2.0"), "0.2.1"), None);
        assert_eq!(newer_app_needed(Some("0.9.9"), "0.10.0"), None, "numbers, not text, are compared");
        assert_eq!(newer_app_needed(Some("0.2.0"), "1.0.0"), None);
        assert_eq!(newer_app_needed(Some(" 0.2.0 "), "0.2.0"), None);
    }

    #[test]
    fn an_older_app_is_told_which_version_it_needs() {
        assert_eq!(newer_app_needed(Some("0.2.1"), "0.2.0"), needed(Some("0.2.1")));
        assert_eq!(newer_app_needed(Some("0.10.0"), "0.9.9"), needed(Some("0.10.0")));
        assert_eq!(newer_app_needed(Some("1.0.0"), "0.99.99"), needed(Some("1.0.0")));
        assert_eq!(newer_app_needed(Some("0.3.0"), "0.3.0-beta.1"), needed(Some("0.3.0")), "a pre-release is older");
    }

    #[test]
    fn a_minimum_this_app_cannot_read_means_a_newer_app_without_a_version() {
        for unreadable in ["", "latest", "next year", "{\"desktop\":\"0.3\"}", "0.3.x"] {
            assert_eq!(newer_app_needed(Some(unreadable), "0.2.0"), needed(None), "{unreadable}");
        }
    }

    #[test]
    fn finds_what_graphrt_did_not_know_in_a_refused_manifest() {
        let unknown_field =
            "invalid plugin manifest: unknown field `triggers`, expected one of `name`, `version` at line 1 column 9";
        assert_eq!(unknown_manifest_feature(unknown_field).as_deref(), Some("triggers"));
        let unknown_runtime = "invalid plugin manifest: unknown runtime `mcp` (expected process, http or wasm)";
        assert_eq!(unknown_manifest_feature(unknown_runtime).as_deref(), Some("mcp"));
        let unknown_variant = "invalid plugin manifest: unknown variant `array[image]`, expected one of `any`, `none`";
        assert_eq!(unknown_manifest_feature(unknown_variant).as_deref(), Some("array[image]"));
    }

    #[test]
    fn other_refusals_are_not_a_sign_of_a_newer_app() {
        for refusal in [
            "invalid plugin manifest: missing field `name`",
            "plugin `x`: checksum mismatch for `plugin.mjs`",
            "invalid plugin manifest: unknown field ``, expected one of `name`",
            "invalid plugin manifest: unknown field `<script>`, expected one of `name`",
            "invalid plugin manifest: unknown field `never closed",
        ] {
            assert_eq!(unknown_manifest_feature(refusal), None, "{refusal}");
        }
    }

    #[test]
    fn a_refused_manifest_becomes_the_matching_error() {
        let newer = manifest_refusal(
            "invalid plugin manifest: unknown field `triggers`, expected one of `name`".into(),
            |refusal| refusal,
        );
        assert!(
            matches!(&newer, AppError::NeedsNewerApp { min_version: None, unknown_feature: Some(feature) } if feature == "triggers"),
            "{newer:?}"
        );
        let other = manifest_refusal("invalid plugin manifest: missing field `name`".into(), |refusal| {
            format!("refused: {refusal}")
        });
        assert!(matches!(&other, AppError::InvalidInput(message) if message.starts_with("refused: ")), "{other:?}");
    }
}
