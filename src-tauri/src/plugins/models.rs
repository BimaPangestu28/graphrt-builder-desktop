//! Types shared with the frontend (`src/api/pluginTypes.ts`) and the catalog
//! wire formats of the graphrt-plugins `catalog` release: v1 `index.json`, v2
//! `index-v2.json` and the per-version v2 details (`plugin-<name>-<version>.json`).

use serde::{Deserialize, Serialize};

pub use super::app_requirement::NewerAppNeeded;
pub use super::source::PluginSource;

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
        !self.requests_beyond(previous).is_empty()
    }

    /// What `self` asks for that `approved` does not grant, as words for an error message
    /// (`"plaintext secrets"`, `"the setting FOO"`); empty when it asks for nothing more.
    /// Network access is informational and never counts.
    pub fn requests_beyond(&self, approved: &PluginPermissions) -> Vec<String> {
        let secrets = (self.secrets && !approved.secrets).then(|| "plaintext secrets".to_owned());
        let settings = self
            .env
            .iter()
            .filter(|variable| !approved.env.contains(variable))
            .map(|variable| format!("the setting {variable}"));
        secrets.into_iter().chain(settings).collect()
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

/// One plugin as published in the catalog (`index.json` or `index-v2.json`, snake_case on the wire).
///
/// v1 entries carry every node in `nodes` (with `config_schema` / `outputs`). v2 entries
/// list only `node_kinds` (kind and title) and point at an immutable detail file
/// (`detail_url`, `detail_sha256`, `detail_size_bytes`) holding the full nodes; the
/// service fills `nodes` from that detail, or from `node_kinds` until it is cached
/// (see `details::resolve_catalog`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CatalogPlugin {
    pub name: String,
    /// Curated name people see, e.g. "WhatsApp Cloud API" (newer catalogs only). Checked
    /// when the catalog is parsed: an invalid one is dropped, the entry stays.
    #[serde(default, deserialize_with = "string_or_none")]
    pub display_name: Option<String>,
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
    /// An MCP preset plugin's server (newer catalogs only; an unreadable value is dropped).
    #[serde(default, deserialize_with = "lenient_mcp_server")]
    pub mcp_server: Option<McpServerSummary>,
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
    /// v2: kind and title of each node; the full nodes are in the detail file.
    #[serde(default, deserialize_with = "lenient_node_kinds")]
    pub node_kinds: Vec<CatalogNodeKind>,
    /// v2: HTTPS link to this version's detail file (checked when parsed; dropped when invalid).
    #[serde(default, deserialize_with = "string_or_none")]
    pub detail_url: Option<String>,
    /// v2: sha256 (64 hex) of the detail file's bytes.
    #[serde(default, deserialize_with = "string_or_none")]
    pub detail_sha256: Option<String>,
    /// v2: size of the detail file in bytes.
    #[serde(default, deserialize_with = "u64_or_none")]
    pub detail_size_bytes: Option<u64>,
    /// `official` (missing means official) or `community`; normalized when the catalog is
    /// parsed (see `source::clean_source_fields`), read with `source::catalog_entry_source`.
    #[serde(default, deserialize_with = "string_or_none")]
    pub source: Option<String>,
    /// Who maintains the plugin, e.g. "graphrt" or "Acme Inc." (at most 60 characters).
    #[serde(default, deserialize_with = "string_or_none")]
    pub publisher: Option<String>,
    /// HTTPS link to the plugin's source repository (dropped when not https).
    #[serde(default, deserialize_with = "string_or_none")]
    pub repository_url: Option<String>,
    /// The oldest app version that can use the plugin, e.g. `0.2.0` (newer catalogs only;
    /// missing means every version). Kept as written: `app_requirement::newer_app_needed`
    /// reads it, and a value it cannot read counts as "needs a newer app".
    #[serde(default, deserialize_with = "text_of_any_value")]
    pub min_app_version: Option<String>,
}

/// Reads an optional field as text whatever JSON value it holds: `null` is `None`, a string
/// is itself and anything else is its JSON text, so the reader can tell "not there" from
/// "there, in a form this app does not know".
fn text_of_any_value<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text),
        other => Some(other.to_string()),
    })
}

/// A v2 index's short form of a node: enough for lists and "which plugin owns this kind".
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct CatalogNodeKind {
    pub kind: String,
    #[serde(default)]
    pub title: String,
}

impl CatalogNodeKind {
    /// The node as v1 would list it without description, schema or outputs.
    pub fn to_node(&self) -> CatalogNode {
        CatalogNode {
            kind: self.kind.clone(),
            title: self.title.clone(),
            description: String::new(),
            config_schema: None,
            outputs: None,
        }
    }
}

/// Reads `node_kinds` leniently: a non-array becomes empty and entries without a
/// usable `kind` are dropped, so one odd field never fails the whole catalog.
fn lenient_node_kinds<'de, D>(deserializer: D) -> Result<Vec<CatalogNodeKind>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let serde_json::Value::Array(items) = serde_json::Value::deserialize(deserializer)? else { return Ok(Vec::new()) };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<CatalogNodeKind>(item).ok())
        .filter(|node_kind| !node_kind.kind.trim().is_empty())
        .collect())
}

/// Reads an optional unsigned number that may hold any JSON value (anything else is `None`).
fn u64_or_none<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(serde_json::Value::deserialize(deserializer)?.as_u64())
}

/// A v2 detail file (`plugin-<name>-<version>.json`): the full nodes and tools of one
/// released plugin version. Immutable once published.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PluginDetail {
    pub schema: u32,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub nodes: Vec<CatalogNode>,
    #[serde(default)]
    pub tools: Vec<CatalogTool>,
}

/// One tool a plugin adds, as listed in its detail file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct CatalogTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Reads an optional string field that may hold any JSON value: a non-string becomes
/// `None` instead of failing the whole catalog over one odd field.
fn string_or_none<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::String(text) => Ok(Some(text)),
        _ => Ok(None),
    }
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

/// The catalog document (v1 `index.json` or v2 `index-v2.json`; `schema` says which).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CatalogIndex {
    pub schema: u32,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub plugins: Vec<CatalogPlugin>,
    /// Agent skills the catalog offers (newer catalogs only). Part of the signed index, so a
    /// skill is covered by the same signature as a plugin; an unreadable entry is dropped.
    #[serde(default, deserialize_with = "lenient_skills")]
    pub skills: Vec<CatalogSkill>,
}

/// One agent skill of the catalog: a `SKILL.md` package in a `.tar.gz` whose single
/// top-level folder is the skill's name (snake_case on the wire).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct CatalogSkill {
    pub name: String,
    /// Curated name people see, e.g. "Refund policy"; checked like a plugin's.
    #[serde(default, deserialize_with = "string_or_none")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub tarball_url: String,
    pub sha256: String,
    #[serde(default)]
    pub size_bytes: u64,
    /// Who maintains the skill, e.g. "graphrt" (at most 60 characters).
    #[serde(default, deserialize_with = "string_or_none")]
    pub publisher: Option<String>,
}

/// The `skills` list of an index; anything that is not a list of readable entries is left
/// out (logged), so a malformed skills section never hides the plugins.
fn lenient_skills<'de, D>(deserializer: D) -> Result<Vec<CatalogSkill>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let serde_json::Value::Array(entries) = serde_json::Value::deserialize(deserializer)? else {
        return Ok(Vec::new());
    };
    Ok(entries
        .into_iter()
        .filter_map(|entry| match serde_json::from_value::<CatalogSkill>(entry) {
            Ok(skill) => Some(skill),
            Err(error) => {
                log::warn!("skipping a catalog skill that cannot be read: {error}");
                None
            }
        })
        .collect())
}

/// A catalog plugin with its install state, for the Plugins screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub name: String,
    /// What people see: the catalog's curated name, else the humanized `name`.
    pub display_name: String,
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
    /// `official` or `community` (never `local`: sideloaded plugins are not in the catalog).
    pub source: PluginSource,
    /// Who maintains it, when the catalog says.
    pub publisher: Option<String>,
    /// HTTPS link to its source repository, when the catalog has one.
    pub repository_url: Option<String>,
    pub installed_version: Option<String>,
    pub update_available: bool,
    /// The update asks for more than the installed version (more settings or plaintext
    /// secrets): it is never installed automatically and drops trust when the user installs it.
    pub update_needs_approval: bool,
    /// For an MCP preset plugin: the server it adds to Connections > MCP servers.
    pub mcp_server: Option<McpServerSummary>,
    /// This app is too old for the catalog's version of the plugin: it cannot be installed
    /// (or updated to that version) until the app is updated. `None` when the app is new enough.
    pub needs_newer_app: Option<NewerAppNeeded>,
}

/// The server of an MCP preset plugin, as the Plugins screen shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSummary {
    pub url: String,
    /// `none`, `bearer` or `oauth`.
    pub auth: String,
}

fn lenient_mcp_server<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<McpServerSummary>, D::Error> {
    #[derive(Deserialize)]
    struct Wire {
        url: String,
        #[serde(default)]
        auth: Option<String>,
    }
    let value = serde_json::Value::deserialize(deserializer)?;
    let summary = serde_json::from_value::<Wire>(value).ok().and_then(|wire| {
        let auth = wire.auth.unwrap_or_else(|| "none".to_owned());
        let known_auth = matches!(auth.as_str(), "none" | "bearer" | "oauth");
        (wire.url.starts_with("https://") && known_auth).then_some(McpServerSummary { url: wire.url, auth })
    });
    Ok(summary)
}

/// What `list_plugin_catalog` returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalog {
    pub plugins: Vec<PluginCatalogEntry>,
    pub generated_at: Option<String>,
    /// The catalog could not be fetched; this is the last saved copy.
    pub from_cache: bool,
    /// When this session last fetched the catalog (RFC 3339), or `None` for a saved copy.
    pub fetched_at: Option<String>,
    /// For a saved copy: why the online catalog could not be used (offline, or an index
    /// whose signature is missing or invalid).
    pub fetch_error: Option<String>,
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
    /// What people see: the curated name from the catalog (saved at install time, so it
    /// shows offline), else the humanized `name`.
    pub display_name: String,
    pub version: String,
    pub description: String,
    /// Requested permissions, from the manifest.
    pub permissions: PluginPermissions,
    pub trusted: bool,
    pub needs_browser: bool,
    /// Runs on Node, so it needs the plugin runtime (downloaded on demand).
    pub needs_node_runtime: bool,
    pub nodes: Vec<PluginNodeInfo>,
    pub tools: Vec<String>,
    pub config: Vec<PluginConfigStatus>,
    pub load_error: Option<String>,
    pub warnings: Vec<String>,
    pub readme_url: Option<String>,
    /// The catalog's icon link at install time (see [`PluginCatalogEntry::icon_url`]).
    pub icon_url: Option<String>,
    /// Where it was installed from: the catalog's `official` / `community`, or `local`.
    pub source: PluginSource,
    /// Who maintains it (from the catalog at install time), when known.
    pub publisher: Option<String>,
    /// HTTPS link to its source repository (from the catalog at install time), when known.
    pub repository_url: Option<String>,
    /// For a `local` plugin: the folder or archive it was installed from, for display only.
    pub local_path: Option<String>,
    /// For an MCP preset plugin: the server it added to Connections > MCP servers.
    pub mcp_server: Option<McpServerSummary>,
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
    /// The catalog's curated display name at install time, so it shows offline.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Where it was installed from. Missing (older records) or unknown means official.
    /// A `local` plugin is never auto-updated or matched against catalog updates.
    #[serde(default, deserialize_with = "super::source::lenient_record_source")]
    pub source: PluginSource,
    /// The catalog's publisher at install time.
    #[serde(default)]
    pub publisher: Option<String>,
    /// The catalog's repository link at install time.
    #[serde(default)]
    pub repository_url: Option<String>,
    /// For a `local` plugin: the folder or archive it was installed from (display only).
    #[serde(default)]
    pub local_path: Option<String>,
}

impl InstallRecord {
    /// Whether the plugin was sideloaded (Settings › Developer mode), not installed from the catalog.
    pub fn is_local(&self) -> bool {
        self.source == PluginSource::Local
    }
}

/// A starter prompt from an installed plugin (New agent screen).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTemplateInfo {
    pub plugin: String,
    pub plugin_display_name: String,
    pub id: String,
    pub title: String,
    pub description: String,
    pub prompt: String,
}
