//! Types shared with the frontend (`src/api/pluginTypes.ts`) and the catalog
//! wire format (`index.json` of the graphrt-plugins releases).

use serde::{Deserialize, Serialize};

/// What a plugin asks for: network access (informational), plaintext secrets
/// and host environment variables. Shown before install; granted on trust.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissions {
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub secrets: bool,
    #[serde(default)]
    pub env: Vec<String>,
}

impl From<&graphrt_plugin::Permissions> for PluginPermissions {
    fn from(permissions: &graphrt_plugin::Permissions) -> Self {
        Self { network: permissions.network, secrets: permissions.secrets, env: permissions.env.clone() }
    }
}

impl PluginPermissions {
    /// True when `self` asks for something `previous` did not (more env
    /// variables, or plaintext secrets). Used to drop trust on update.
    pub fn asks_for_more_than(&self, previous: &PluginPermissions) -> bool {
        (self.secrets && !previous.secrets) || self.env.iter().any(|variable| !previous.env.contains(variable))
    }
}

/// One node kind a plugin adds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNodeInfo {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
}

/// One plugin as published in the catalog (`index.json`, snake_case on the wire).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CatalogPlugin {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub tarball_url: String,
    pub sha256: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub permissions: CatalogPermissions,
    #[serde(default)]
    pub needs_browser: bool,
    /// Node.js version range the plugin needs, e.g. `>=20`.
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub nodes: Vec<CatalogNode>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub readme_url: Option<String>,
    /// HTTPS link to the plugin's SVG icon (a `catalog` release asset; newer catalogs only).
    #[serde(default)]
    pub icon_url: Option<String>,
    /// Terms-of-service / ban warning from the plugin's README (e.g. whatsapp-web).
    #[serde(default)]
    pub warning: Option<String>,
    /// Maturity label: `stable`, `beta` or `experimental` (newer catalogs only).
    #[serde(default)]
    pub status: Option<String>,
    /// Terms-of-service risk of using the plugin: `none`, `low`, `medium` or `high` (newer catalogs only).
    #[serde(default)]
    pub tos_risk: Option<String>,
    /// How many operations (node kinds) the plugin offers.
    #[serde(default)]
    pub operations_count: Option<u32>,
}

/// One node kind as published in the catalog (snake_case on the wire).
/// `config_schema` and `outputs` are optional: older catalogs only list
/// kind, title and description.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CatalogNode {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema of the node's config object, when published.
    #[serde(default)]
    pub config_schema: Option<serde_json::Value>,
    /// Declared outputs: `[{ "name": "data", ... }]` or `["data"]`.
    #[serde(default)]
    pub outputs: Option<serde_json::Value>,
}

impl CatalogNode {
    /// The kind, title and description shown on the Plugins screen.
    pub fn info(&self) -> PluginNodeInfo {
        PluginNodeInfo { kind: self.kind.clone(), title: self.title.clone(), description: self.description.clone() }
    }

    /// Output names, from either published form of `outputs`.
    pub fn output_names(&self) -> Vec<String> {
        let Some(serde_json::Value::Array(outputs)) = &self.outputs else { return Vec::new() };
        outputs
            .iter()
            .filter_map(|output| match output {
                serde_json::Value::String(name) => Some(name.clone()),
                other => other.get("name").and_then(serde_json::Value::as_str).map(str::to_owned),
            })
            .collect()
    }
}

/// Catalog permissions (snake_case wire form of [`PluginPermissions`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct CatalogPermissions {
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub secrets: bool,
    #[serde(default)]
    pub env: Vec<String>,
}

impl From<&CatalogPermissions> for PluginPermissions {
    fn from(permissions: &CatalogPermissions) -> Self {
        Self { network: permissions.network, secrets: permissions.secrets, env: permissions.env.clone() }
    }
}

/// The catalog document.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CatalogIndex {
    pub schema: u32,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub plugins: Vec<CatalogPlugin>,
}

/// A catalog plugin with its install state, for the Plugins screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub name: String,
    pub version: String,
    pub description: String,
    pub permissions: PluginPermissions,
    pub needs_browser: bool,
    pub nodes: Vec<PluginNodeInfo>,
    pub tools: Vec<String>,
    pub readme_url: Option<String>,
    /// HTTPS link to the plugin's SVG icon, when the catalog has one. The UI shows it
    /// through `get_plugin_icon` (a cached data URL), never by loading this link.
    pub icon_url: Option<String>,
    /// Terms-of-service / ban warning from the plugin's README, when it has one.
    pub warning: Option<String>,
    /// Maturity label (`stable`, `beta`, `experimental`), when the catalog says.
    pub status: Option<String>,
    /// Terms-of-service risk (`none`, `low`, `medium`, `high`), when the catalog says.
    pub tos_risk: Option<String>,
    pub size_bytes: u64,
    pub installed_version: Option<String>,
    pub update_available: bool,
    /// The update asks for more than the installed version (more settings or plaintext
    /// secrets): it is never installed automatically and drops trust when the user installs it.
    pub update_needs_approval: bool,
}

/// What `list_plugin_catalog` returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalog {
    pub plugins: Vec<PluginCatalogEntry>,
    pub generated_at: Option<String>,
    /// The catalog could not be fetched; this is the last saved copy.
    pub from_cache: bool,
}

/// Whether one requested variable has a value in the keychain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigStatus {
    pub name: String,
    pub configured: bool,
    /// The plugin has a default for it (tuning such as limits or folders), so it never
    /// blocks running; same rule as plugin readiness.
    pub optional: bool,
}

/// An installed plugin, loaded or not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    pub version: String,
    pub description: String,
    /// Requested permissions, from the manifest.
    pub permissions: PluginPermissions,
    pub trusted: bool,
    pub needs_browser: bool,
    pub nodes: Vec<PluginNodeInfo>,
    pub tools: Vec<String>,
    pub config: Vec<PluginConfigStatus>,
    pub load_error: Option<String>,
    pub warnings: Vec<String>,
    pub readme_url: Option<String>,
    /// The catalog's icon link at install time (see [`PluginCatalogEntry::icon_url`]).
    pub icon_url: Option<String>,
}

/// The outputs of a one-off plugin action.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActionResult {
    pub outputs: serde_json::Map<String, serde_json::Value>,
}

/// Install steps reported through `plugin-event`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginInstallStage {
    Downloading,
    Verifying,
    Extracting,
    Loading,
    Done,
    Failed,
}

/// Payload of the Tauri event `plugin-event`. Never carries setting values.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PluginEvent {
    #[serde(rename_all = "camelCase")]
    InstallProgress {
        name: String,
        stage: PluginInstallStage,
        received_bytes: Option<u64>,
        total_bytes: Option<u64>,
        message: Option<String>,
    },
    LoadError {
        name: String,
        message: String,
    },
    PluginsChanged,
}

/// What the app remembers about an installed plugin beyond its manifest
/// (stored in the settings table, see `settings.rs`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallRecord {
    pub version: String,
    #[serde(default)]
    pub needs_browser: bool,
    #[serde(default)]
    pub readme_url: Option<String>,
    /// The catalog's icon link at install time, so the icon shows when the catalog does not.
    #[serde(default)]
    pub icon_url: Option<String>,
}
