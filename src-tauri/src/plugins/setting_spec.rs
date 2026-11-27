//! What a plugin says about each setting it reads: whether it is needed, its default, a
//! label and help for people, and what kind of value it is (a folder, a number, a secret).
//!
//! The runtime's manifest (`graphrt-plugin.json`) only has the flat `permissions.env` list
//! and rejects unknown fields, so the declarations live next to it:
//!
//! - in the plugin folder, as `graphrt-settings.json`: `{ "settings": [ ... ] }`;
//! - in the plugin's catalog entry, as `settings: [ ... ]` (same items), which also covers
//!   plugins that are not installed yet and versions released before the file existed.
//!
//! One item (snake_case on the wire, everything but `name` optional):
//!
//! ```json
//! { "name": "DOCUMENT_TEMPLATES_OUTPUT_DIR", "label": "Folder for finished documents",
//!   "help": "Invoices and other documents are saved here.", "kind": "folder",
//!   "required": true, "default": null, "multiple": false }
//! ```
//!
//! A setting with a `default` is never required. A setting nothing declares falls back to
//! its name (see `optional_settings.rs`). Reading is lenient: one odd item is skipped and
//! never hides the others or fails the catalog.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use super::models::PluginConfigStatus;
use super::optional_settings;

/// The file a plugin ships next to its manifest.
pub(crate) const SETTINGS_FILE_NAME: &str = "graphrt-settings.json";
const MAX_SETTINGS_FILE_BYTES: u64 = 64 * 1024;
const MAX_DECLARATIONS: usize = 100;
const MAX_LABEL_CHARS: usize = 80;
const MAX_HELP_CHARS: usize = 300;
const MAX_DEFAULT_CHARS: usize = 200;

/// What kind of value a setting holds; decides the control people get and whether the
/// saved value is shown again.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingKind {
    /// Plain text that may be shown (an account id, a region, an address).
    #[default]
    Text,
    /// A key, token or password: never shown again once saved.
    Secret,
    Number,
    /// A folder on this computer, chosen with a folder picker and created when missing.
    Folder,
    /// A file on this computer, chosen with a file picker.
    File,
}

impl SettingKind {
    fn from_wire(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "text" => Some(Self::Text),
            "secret" => Some(Self::Secret),
            "number" => Some(Self::Number),
            "folder" => Some(Self::Folder),
            "file" => Some(Self::File),
            _ => None,
        }
    }
}

/// One declared setting, as the plugin or the catalog wrote it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingDeclaration {
    /// The variable, one of the manifest's `permissions.env`.
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub help: Option<String>,
    #[serde(default)]
    pub kind: SettingKind,
    #[serde(default)]
    pub required: bool,
    /// What the plugin uses when the setting has no value, as text (shown as a hint).
    #[serde(default)]
    pub default: Option<String>,
    /// The value is a comma-separated list (several folders or files).
    #[serde(default)]
    pub multiple: bool,
}

/// How the app treats one setting, from its declaration or else from its name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SettingProfile {
    pub label: Option<String>,
    pub help: Option<String>,
    pub kind: SettingKind,
    /// The plugin cannot do its job without a value.
    pub required: bool,
    pub default_value: Option<String>,
    pub multiple: bool,
}

impl SettingProfile {
    /// Whether a saved value must never be shown again.
    pub fn is_secret(&self) -> bool {
        self.kind == SettingKind::Secret
    }

    /// The setting as the screens get it. `stored` is its saved value, which is only passed
    /// on when the setting is not a secret.
    pub fn status(self, name: &str, stored: Option<String>) -> PluginConfigStatus {
        let is_secret = self.is_secret();
        PluginConfigStatus {
            name: name.to_owned(),
            configured: stored.is_some(),
            optional: !self.required,
            label: self.label,
            help: self.help,
            kind: self.kind,
            default_value: self.default_value,
            multiple: self.multiple,
            value: stored.filter(|_| !is_secret),
        }
    }
}

/// The plugin folder's declarations, then the catalog's for the settings the folder's file
/// does not name.
pub(crate) fn merged(
    from_plugin: &[SettingDeclaration],
    from_catalog: &[SettingDeclaration],
) -> Vec<SettingDeclaration> {
    let mut declarations = from_plugin.to_vec();
    for declaration in from_catalog {
        if !declarations.iter().any(|known| known.name == declaration.name) {
            declarations.push(declaration.clone());
        }
    }
    declarations
}

/// The profile of `variable`: its declaration when one names it, else the name rules.
pub(crate) fn profile(variable: &str, declarations: &[SettingDeclaration]) -> SettingProfile {
    match declarations.iter().find(|declaration| declaration.name == variable) {
        Some(declaration) => SettingProfile {
            label: declaration.label.clone(),
            help: declaration.help.clone(),
            kind: declaration.kind,
            // A plugin that has a default works without the setting, whatever else it says.
            required: declaration.required && declaration.default.is_none(),
            default_value: declaration.default.clone(),
            multiple: declaration.multiple,
        },
        None => {
            let guess = optional_settings::guess_from_name(variable);
            SettingProfile {
                label: None,
                help: None,
                kind: guess.kind,
                required: !guess.optional,
                default_value: None,
                multiple: guess.multiple,
            }
        }
    }
}

/// The declarations in a plugin folder's `graphrt-settings.json`; empty when the plugin has
/// none. A file that cannot be used is logged and ignored: the name rules apply instead.
pub(crate) fn read_plugin_declarations(plugin_dir: &Path) -> Vec<SettingDeclaration> {
    let path = plugin_dir.join(SETTINGS_FILE_NAME);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("could not read {}: {error}", path.display());
            }
            return Vec::new();
        }
    };
    if !metadata.is_file() || metadata.len() > MAX_SETTINGS_FILE_BYTES {
        log::warn!("ignoring {}: not a plain file of at most {MAX_SETTINGS_FILE_BYTES} bytes", path.display());
        return Vec::new();
    }
    let document: Json = match std::fs::read(&path)
        .map_err(|error| error.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
    {
        Ok(document) => document,
        Err(error) => {
            log::warn!("ignoring {}: {error}", path.display());
            return Vec::new();
        }
    };
    parse_declarations(document.get("settings").unwrap_or(&document))
}

/// Reads a list of declarations leniently: anything that is not a list is empty, items
/// without a usable `name` are dropped, and a repeated name keeps its first item.
pub(crate) fn parse_declarations(value: &Json) -> Vec<SettingDeclaration> {
    let Json::Array(items) = value else { return Vec::new() };
    let mut declarations: Vec<SettingDeclaration> = Vec::new();
    for item in items.iter().take(MAX_DECLARATIONS) {
        let Some(declaration) = parse_declaration(item) else { continue };
        if !declarations.iter().any(|known| known.name == declaration.name) {
            declarations.push(declaration);
        }
    }
    declarations
}

fn parse_declaration(item: &Json) -> Option<SettingDeclaration> {
    let name = item.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let text = |field: &str, max_chars: usize| {
        item.get(field)
            .and_then(Json::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| clip(text, max_chars))
    };
    let default = match item.get("default") {
        Some(Json::String(text)) if !text.trim().is_empty() => Some(clip(text.trim(), MAX_DEFAULT_CHARS)),
        Some(Json::Number(number)) => Some(number.to_string()),
        Some(Json::Bool(flag)) => Some(flag.to_string()),
        _ => None,
    };
    Some(SettingDeclaration {
        name: name.to_owned(),
        label: text("label", MAX_LABEL_CHARS),
        help: text("help", MAX_HELP_CHARS),
        kind: item.get("kind").and_then(Json::as_str).and_then(SettingKind::from_wire).unwrap_or_default(),
        required: item.get("required").and_then(Json::as_bool).unwrap_or(false),
        default,
        multiple: item.get("multiple").and_then(Json::as_bool).unwrap_or(false),
    })
}

fn clip(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

/// Serde helper for a catalog entry's `settings`.
pub(crate) fn lenient_declarations<'de, D>(deserializer: D) -> Result<Vec<SettingDeclaration>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(parse_declarations(&Json::deserialize(deserializer)?))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn declared() -> Vec<SettingDeclaration> {
        parse_declarations(&json!([
            { "name": "DOCS_OUTPUT_DIR", "label": "Folder for finished documents", "help": "Saved here.",
              "kind": "folder", "required": true },
            { "name": "DOCS_MAX_PAGES", "kind": "number", "required": true, "default": 200 },
            { "name": "DOCS_INPUT_DIRS", "kind": "folder", "multiple": true },
            { "name": "DOCS_TOKEN", "kind": "secret", "required": true },
        ]))
    }

    #[test]
    fn a_declared_setting_is_required_only_without_a_default() {
        let declarations = declared();
        let folder = profile("DOCS_OUTPUT_DIR", &declarations);
        assert!(folder.required);
        assert_eq!(folder.kind, SettingKind::Folder);
        assert_eq!(folder.label.as_deref(), Some("Folder for finished documents"));
        assert!(!folder.is_secret());

        // `required: true` with a default: the plugin works without it.
        let pages = profile("DOCS_MAX_PAGES", &declarations);
        assert!(!pages.required);
        assert_eq!(pages.default_value.as_deref(), Some("200"));
        assert_eq!(pages.kind, SettingKind::Number);

        let inputs = profile("DOCS_INPUT_DIRS", &declarations);
        assert!(!inputs.required && inputs.multiple);
        assert!(profile("DOCS_TOKEN", &declarations).is_secret());
    }

    #[test]
    fn a_setting_nothing_declares_falls_back_to_its_name() {
        let declarations = declared();
        let token = profile("OTHER_ACCESS_TOKEN", &declarations);
        assert!(token.required && token.is_secret());
        let limit = profile("OTHER_MAX_INPUT_BYTES", &declarations);
        assert!(!limit.required);
        assert_eq!(limit.kind, SettingKind::Number);
    }

    #[test]
    fn a_saved_value_is_passed_on_unless_it_is_a_secret() {
        let declarations = declared();
        let folder =
            profile("DOCS_OUTPUT_DIR", &declarations).status("DOCS_OUTPUT_DIR", Some("/home/me/Invoices".into()));
        assert!(folder.configured && !folder.optional);
        assert_eq!(folder.value.as_deref(), Some("/home/me/Invoices"));

        let token = profile("DOCS_TOKEN", &declarations).status("DOCS_TOKEN", Some("s3cret".into()));
        assert!(token.configured);
        assert_eq!(token.value, None);
        // A setting nothing declares is treated as a secret.
        let unknown = profile("OTHER_ACCESS_TOKEN", &declarations).status("OTHER_ACCESS_TOKEN", Some("s3cret".into()));
        assert_eq!(unknown.value, None);

        let unset = profile("DOCS_MAX_PAGES", &declarations).status("DOCS_MAX_PAGES", None);
        assert!(!unset.configured && unset.optional);
        assert_eq!(unset.default_value.as_deref(), Some("200"));
    }

    #[test]
    fn the_plugins_own_file_wins_over_the_catalog() {
        let from_plugin = parse_declarations(&json!([{ "name": "A", "label": "From the plugin" }]));
        let from_catalog = parse_declarations(&json!([{ "name": "A", "label": "From the catalog" }, { "name": "B" }]));
        let all = merged(&from_plugin, &from_catalog);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].label.as_deref(), Some("From the plugin"));
        assert_eq!(merged(&[], &from_catalog), from_catalog);
    }

    #[test]
    fn odd_items_are_skipped_and_unknown_kinds_are_text() {
        let declarations = parse_declarations(&json!([
            "not an object",
            { "label": "no name" },
            { "name": "  " },
            { "name": "A", "kind": "colour", "required": "yes", "default": "", "label": 7 },
            { "name": "A", "kind": "secret" },
        ]));
        assert_eq!(declarations.len(), 1);
        let only = &declarations[0];
        assert_eq!(
            (only.kind, only.required, only.default.clone(), only.label.clone()),
            (SettingKind::Text, false, None, None)
        );
        assert!(parse_declarations(&json!({ "settings": [] })).is_empty());
        assert!(parse_declarations(&json!(null)).is_empty());
    }

    #[test]
    fn long_texts_are_clipped() {
        let declarations =
            parse_declarations(&json!([{ "name": "A", "label": "x".repeat(500), "help": "y".repeat(900) }]));
        assert_eq!(declarations[0].label.as_ref().map(|label| label.chars().count()), Some(MAX_LABEL_CHARS));
        assert_eq!(declarations[0].help.as_ref().map(|help| help.chars().count()), Some(MAX_HELP_CHARS));
    }

    #[test]
    fn reads_the_file_in_a_plugin_folder_and_ignores_a_broken_one() {
        let folder = tempfile::tempdir().unwrap();
        assert!(read_plugin_declarations(folder.path()).is_empty());

        let path = folder.path().join(SETTINGS_FILE_NAME);
        std::fs::write(&path, r#"{ "settings": [{ "name": "A_DIR", "kind": "folder", "required": true }] }"#).unwrap();
        let declarations = read_plugin_declarations(folder.path());
        assert_eq!(declarations.len(), 1);
        assert!(profile("A_DIR", &declarations).required);

        std::fs::write(&path, "{ not json").unwrap();
        assert!(read_plugin_declarations(folder.path()).is_empty());
    }
}
