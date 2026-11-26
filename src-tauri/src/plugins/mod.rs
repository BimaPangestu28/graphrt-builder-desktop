//! graphrt plugins: install from the graphrt-plugins catalog, trust, settings,
//! and making their node kinds and tools available to every run.
//!
//! - Plugins live in `<app data>/plugins/<name>/`, one folder per plugin, as
//!   published in the catalog's tarballs (`graphrt-plugin.json` + files pinned
//!   by `checksums`).
//! - [`PluginService`] (in `AppState`) owns a graphrt `PluginHost` built from
//!   that folder, rebuilt whenever plugins, trust or settings change, and
//!   publishes it process-wide (see [`active`]) so `flow::node_registry()`
//!   compiles plugin kinds and every run's tool registry gets plugin tools.
//! - Trusting a plugin is an explicit user action. Only trusted plugins get
//!   plaintext secrets (graphrt `PluginHost::trust`) and the settings they
//!   request (`permissions.env`), which are kept in the keychain
//!   (`CredentialStore::set_plugin_config`) and passed to the plugin process
//!   with the plugin runtime's (Node) environment (see `host.rs`).
//! - Installing downloads over HTTPS (size-capped), checks the catalog's
//!   sha256, extracts safely into a staging folder, loads the plugin with
//!   graphrt (manifest + entrypoint checksums), then moves it into place.
//! - The catalog is read from `index-v2.json` (slim index + per-version detail
//!   files, see [`details`]) with v1 `index.json` as the fallback; see
//!   `catalog_fetch.rs`.

mod action;
pub mod active;
pub(crate) mod archive;
pub mod auto_update;
mod catalog;
mod catalog_fetch;
mod catalog_signature;
mod details;
pub(crate) mod display_name;
pub mod download;
pub mod events;
pub(crate) mod host;
mod icons;
mod install;
pub mod models;
mod optional_settings;
mod placeholder;
mod prompt_guide;
pub mod requirements;
mod sending;
pub(crate) mod session;
mod settings;
mod sideload;
pub(crate) mod source;

#[cfg(test)]
pub(crate) mod tests;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

pub use active::{add_plugin_tools, register_catalog_placeholders, register_plugin_nodes};
pub use catalog::DEFAULT_CATALOG_URL;
use display_name::resolve_display_name;
use download::{require_https, Downloader, ProgressCallback};
use events::PluginEventSink;
use host::{build_snapshot, HostInputs, PluginSnapshot, SharedSnapshot};
use models::{
    InstallRecord, InstalledPlugin, McpServerSummary, PluginActionResult, PluginConfigStatus, PluginEvent,
    PluginInstallStage, PluginPermissions, PluginTemplateInfo,
};
pub use prompt_guide::installed_plugins_guide;
pub use sending::{is_sending_operation, is_sending_plugin_kind};

use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::node_runtime::{BrowserRuntimeStatus, NodeRuntime, PluginRuntimeStatus};
use crate::storage::Database;

/// Folder under the app data folder holding one folder per plugin.
pub const PLUGINS_DIR_NAME: &str = "plugins";
/// Folder under the app data folder for plugin state (browser profiles).
pub const PLUGIN_DATA_DIR_NAME: &str = "plugin-data";
/// The saved v1 catalog, next to the plugins folder.
const CATALOG_CACHE_FILE_NAME: &str = "plugin-catalog.json";
/// The saved v2 catalog (`index-v2.json`), next to the v1 copy.
const CATALOG_V2_CACHE_FILE_NAME: &str = "plugin-catalog-v2.json";
/// Written once a v2 index was fetched: v1 is never used again (see `catalog_fetch.rs`).
const CATALOG_V2_MARKER_FILE_NAME: &str = "plugin-catalog-v2.seen";
/// Largest plugin tarball accepted.
const MAX_TARBALL_BYTES: u64 = 256 * 1024 * 1024;
const CATALOG_TIMEOUT: Duration = Duration::from_secs(20);
/// How long building an agent waits for the catalog before using the saved copy.
const BUILDER_CATALOG_TIMEOUT: Duration = Duration::from_secs(5);
const TARBALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Download progress is reported at most every this many bytes.
const PROGRESS_STEP_BYTES: u64 = 256 * 1024;

/// How an install reports progress and which permissions it may bring in.
#[derive(Debug, Clone)]
struct InstallMode {
    /// `None`: any (an update the user started; trust drops when it asks for more).
    /// `Some`: a plugin asking for more than this is refused and nothing changes.
    permission_limit: Option<install::PermissionLimit>,
    /// Sends `install_progress` events (off for background updates).
    reports_progress: bool,
}

impl InstallMode {
    /// The user started an update on screen (Update on the plugin card).
    fn user_update() -> Self {
        Self { permission_limit: None, reports_progress: true }
    }

    /// The user approved `permissions` on screen (install card, builder requirement card):
    /// a manifest asking for more is refused.
    fn approved(permissions: PluginPermissions) -> Self {
        let origin = install::PermissionLimitOrigin::UserApproval;
        Self { permission_limit: Some(install::PermissionLimit { permissions, origin }), reports_progress: true }
    }

    /// An update the user did not approve one by one: no new permissions, no progress.
    fn within(permissions: PluginPermissions) -> Self {
        let origin = install::PermissionLimitOrigin::InstalledVersion;
        Self { permission_limit: Some(install::PermissionLimit { permissions, origin }), reports_progress: false }
    }
}

/// What [`PluginService::new`] needs.
#[derive(Debug)]
pub struct PluginServiceConfig {
    /// The app data folder; plugins go to `<app_data_dir>/plugins`.
    pub app_data_dir: PathBuf,
    pub catalog_url: String,
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub node_runtime: Arc<NodeRuntime>,
    pub downloader: Arc<dyn Downloader>,
    pub events: Arc<dyn PluginEventSink>,
}

/// Installed plugins, their trust and settings, and the graphrt host built from them.
pub struct PluginService {
    plugins_dir: PathBuf,
    plugin_data_dir: PathBuf,
    /// Where browser plugins write live view frames (`crate::live_view`).
    live_view_dir: PathBuf,
    /// The saved v1 and v2 catalogs.
    catalog_files: catalog::SavedCatalogFiles,
    /// Downloaded plugin icons (see [`icons`]), next to the catalog cache.
    icons_dir: PathBuf,
    /// The v1 `index.json` URL (the fallback).
    catalog_url: String,
    /// The `index-v2.json` URL next to it, tried first.
    catalog_v2_url: Option<String>,
    /// Catalog v2 plugin details, saved under `plugin-details/`.
    details: Arc<details::DetailStore>,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    node_runtime: Arc<NodeRuntime>,
    downloader: Arc<dyn Downloader>,
    events: Arc<dyn PluginEventSink>,
    snapshot: RwLock<SharedSnapshot>,
    /// The catalog fetched this session and when (shared with the detail sync).
    catalog: catalog_fetch::CatalogSlot,
    /// The known catalog computed last (see `catalog_fetch::KnownCatalogMemo`).
    known_catalog_memo: catalog_fetch::KnownCatalogMemo,
    /// The background detail sync of the last catalog fetch, if one runs.
    detail_sync: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// `name -> icon_url` of the saved catalog, read once when no catalog was fetched yet.
    saved_catalog_icon_urls: OnceLock<HashMap<String, Option<String>>>,
    /// Icon URLs that failed to download this session, so lists do not retry them per card.
    failed_icon_urls: Mutex<HashSet<String>>,
    /// Serializes installs, updates, removals and trust / setting changes.
    changes: tokio::sync::Mutex<()>,
    /// The app's service publishes its snapshot process-wide; test services do not.
    publishes_globally: Arc<AtomicBool>,
}

impl std::fmt::Debug for PluginService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PluginService")
            .field("plugins_dir", &self.plugins_dir)
            .field("snapshot", &*self.snapshot())
            .finish_non_exhaustive()
    }
}

impl PluginService {
    /// Creates the service and loads the installed plugins (load errors are
    /// reported per plugin, never fatal). Catalogs must be signed with a built-in key
    /// (see [`catalog_signature`]).
    pub fn new(config: PluginServiceConfig) -> Self {
        Self::with_catalog_keys(config, catalog_signature::CatalogKeys::built_in())
    }

    /// [`PluginService::new`] trusting catalogs signed with `catalog_keys` (tests sign
    /// their fixture catalogs with a throwaway key; the app always uses the built-in keys).
    fn with_catalog_keys(config: PluginServiceConfig, catalog_keys: catalog_signature::CatalogKeys) -> Self {
        let plugins_dir = config.app_data_dir.join(PLUGINS_DIR_NAME);
        install::clean_leftovers(&plugins_dir);
        let service = Self {
            catalog_files: catalog::SavedCatalogFiles {
                v1: config.app_data_dir.join(CATALOG_CACHE_FILE_NAME),
                v2: config.app_data_dir.join(CATALOG_V2_CACHE_FILE_NAME),
                v2_marker: config.app_data_dir.join(CATALOG_V2_MARKER_FILE_NAME),
                asset_prefix: catalog::release_asset_prefix(&config.catalog_url),
                keys: catalog_keys,
            },
            details: Arc::new(details::DetailStore::new(
                config.app_data_dir.join(details::DETAILS_DIR_NAME),
                config.downloader.clone(),
            )),
            catalog_v2_url: catalog::v2_catalog_url(&config.catalog_url),
            icons_dir: config.app_data_dir.join(icons::ICONS_DIR_NAME),
            plugin_data_dir: config.app_data_dir.join(PLUGIN_DATA_DIR_NAME),
            live_view_dir: config.app_data_dir.join(crate::live_view::LIVE_VIEW_DIR_NAME),
            plugins_dir,
            catalog_url: config.catalog_url,
            db: config.db,
            credentials: config.credentials,
            node_runtime: config.node_runtime,
            downloader: config.downloader,
            events: config.events,
            snapshot: RwLock::new(Arc::new(PluginSnapshot::empty())),
            catalog: Arc::new(Mutex::new(None)),
            known_catalog_memo: catalog_fetch::KnownCatalogMemo::default(),
            detail_sync: Mutex::new(None),
            saved_catalog_icon_urls: OnceLock::new(),
            failed_icon_urls: Mutex::new(HashSet::new()),
            changes: tokio::sync::Mutex::new(()),
            publishes_globally: Arc::new(AtomicBool::new(false)),
        };
        service.catalog_files.remove_obsolete_v1();
        service.reload();
        service
    }

    /// Makes this service's plugins the ones every run and compile uses, and publishes
    /// the known catalog for drafts.
    pub fn activate(&self) {
        self.activate_installed();
        self.publish_known_catalog();
    }

    /// The cheap half of [`PluginService::activate`]: the installed plugins (what runs
    /// need) become the process-wide ones. The app publishes the catalog (a disk read and
    /// signature check) later with [`PluginService::publish_known_catalog`].
    pub fn activate_installed(&self) {
        self.publishes_globally.store(true, Ordering::SeqCst);
        active::publish(Some(self.snapshot()));
    }

    /// The Node runtime plugin processes run on.
    pub fn node_runtime(&self) -> &Arc<NodeRuntime> {
        &self.node_runtime
    }

    pub(crate) fn snapshot(&self) -> SharedSnapshot {
        match self.snapshot.read() {
            Ok(snapshot) => snapshot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// The built-in node kinds plus this service's plugin kinds.
    pub fn node_registry(&self) -> graphrt_core::Registry {
        let mut registry = crate::flow::builtin_node_registry();
        self.snapshot().register_nodes(&mut registry);
        registry
    }

    /// [`PluginService::node_registry`] plus placeholders for the node kinds of
    /// catalog plugins that are not installed: validates drafts, never runs.
    pub fn draft_node_registry(&self) -> graphrt_core::Registry {
        let mut registry = self.node_registry();
        if let Some(catalog) = self.known_catalog() {
            placeholder::register_placeholders(&mut registry, &catalog);
        }
        registry
    }

    /// The builder prompt section for this service's plugins (installed ones,
    /// then catalog plugins not installed yet).
    pub fn prompt_guide(&self) -> String {
        prompt_guide::plugin_guide(&self.snapshot().plugins, self.known_catalog().as_deref())
    }

    /// What `flow_yaml` needs from plugins (see [`requirements`]).
    ///
    /// # Errors
    /// `Database` / `Credentials` when install records or the keychain cannot be read.
    pub fn requirements(&self, flow_yaml: &str) -> AppResult<Vec<requirements::PluginRequirement>> {
        let snapshot = self.snapshot();
        let records = settings::install_records(&self.db)?;
        let catalog = self.known_catalog();
        let browser_ready = |plugin: &str| self.browser_ready_for(plugin);
        let node_runtime_ready = self.node_runtime.node_runtime_status() == BrowserRuntimeStatus::Installed;
        let session_linked = |plugin: &str| session::needs_session(plugin).then(|| self.session_linked(plugin));
        let sources = requirements::RequirementSources {
            installed: &snapshot.plugins,
            install_records: &records,
            catalog: catalog.as_deref(),
            credentials: &self.credentials,
            browser_ready: &browser_ready,
            node_runtime_ready,
            session_linked: &session_linked,
        };
        requirements::plugin_requirements(flow_yaml, &sources)
    }

    /// Whether `plugin`'s account session is known to be linked; an unreadable setting counts as not linked.
    fn session_linked(&self, plugin: &str) -> bool {
        session::is_linked(&self.db, plugin).unwrap_or_else(|error| {
            log::warn!("could not read the session state of plugin {plugin}: {error}");
            false
        })
    }

    /// Whether Chromium is ready for `plugin`: the build its own Playwright
    /// expects when it is installed, any Chromium otherwise.
    fn browser_ready_for(&self, plugin: &str) -> bool {
        let plugin_dir = self.plugins_dir.join(plugin);
        let status = match self.node_runtime.browser_runtime_status_for(&plugin_dir) {
            Ok(status) => status,
            Err(_) => self.node_runtime.browser_runtime_status(),
        };
        status == BrowserRuntimeStatus::Installed
    }

    /// Rebuilds the graphrt host from the plugin folder, trust and settings.
    pub fn reload(&self) {
        let trusted = match settings::trusted_plugins(&self.db) {
            Ok(trusted) => trusted,
            Err(error) => {
                log::warn!("could not read trusted plugins, trusting none: {error}");
                Default::default()
            }
        };
        let base_registry = crate::flow::builtin_node_registry();
        let mut process_env = self.node_runtime.plugin_process_env();
        process_env.push(crate::live_view::plugin_env_entry(&self.live_view_dir));
        // The runtime's install location until it is downloaded: plugins then fail to start
        // with that path, and work as soon as it is installed.
        let node_executable = Some(self.node_runtime.node_command_path());
        let inputs = HostInputs {
            trusted: &trusted,
            credentials: &self.credentials,
            process_env: &process_env,
            base_registry: &base_registry,
            plugin_data_dir: &self.plugin_data_dir,
            node_executable: node_executable.as_deref(),
        };
        let snapshot = Arc::new(build_snapshot(&self.plugins_dir, &inputs));
        for plugin in &snapshot.plugins {
            if let Some(message) = &plugin.load_error {
                log::warn!("plugin {} could not be loaded: {message}", plugin.name);
                self.events.send(PluginEvent::LoadError { name: plugin.name.clone(), message: message.clone() });
            }
        }
        match self.snapshot.write() {
            Ok(mut slot) => *slot = snapshot.clone(),
            Err(poisoned) => *poisoned.into_inner() = snapshot.clone(),
        }
        self.sync_mcp_servers(&snapshot);
        if self.publishes_globally.load(Ordering::SeqCst) {
            active::publish(Some(snapshot));
        }
    }

    /// Makes Connections > MCP servers match the installed MCP preset plugins.
    fn sync_mcp_servers(&self, snapshot: &PluginSnapshot) {
        let presets: Vec<(String, host::PluginMcpServer)> = snapshot
            .plugins
            .iter()
            .filter(|plugin| plugin.load_error.is_none())
            .filter_map(|plugin| plugin.mcp_server.clone().map(|server| (plugin.name.clone(), server)))
            .collect();
        match crate::mcp::plugin_servers::sync(&self.db, &self.credentials, &presets) {
            Ok((outcome, definitions)) => {
                for (plugin, reason) in &outcome.skipped {
                    log::warn!("plugin {plugin}: its MCP server was not added: {reason}");
                    self.events.send(PluginEvent::LoadError { name: plugin.clone(), message: reason.clone() });
                }
                if self.publishes_globally.load(Ordering::SeqCst) {
                    crate::mcp::publish(definitions);
                }
            }
            Err(error) => log::warn!("could not update the MCP servers of the installed plugins: {error}"),
        }
    }

    /// The templates of the installed plugins, with the plugin's display name.
    pub fn templates(&self) -> Vec<PluginTemplateInfo> {
        let snapshot = self.snapshot();
        let display_names = self.plugin_display_names();
        snapshot
            .plugins
            .iter()
            .filter(|plugin| plugin.load_error.is_none())
            .flat_map(|plugin| {
                let display_name = display_names.get(&plugin.name).cloned().unwrap_or_else(|| plugin.name.clone());
                plugin.templates.iter().map(move |template| PluginTemplateInfo {
                    plugin: plugin.name.clone(),
                    plugin_display_name: display_name.clone(),
                    id: template.id.clone(),
                    title: template.title.clone(),
                    description: template.description.clone(),
                    prompt: template.prompt.clone(),
                })
            })
            .collect()
    }

    /// Every installed plugin with trust, setting status and load errors.
    ///
    /// # Errors
    /// `Database` / `Credentials` when the settings or keychain cannot be read.
    pub fn list_installed(&self) -> AppResult<Vec<InstalledPlugin>> {
        let snapshot = self.snapshot();
        let records = settings::install_records(&self.db)?;
        let session_display_names = self.session_catalog_display_names();
        snapshot
            .plugins
            .iter()
            .map(|plugin| {
                let record = records.get(&plugin.name).cloned().unwrap_or_default();
                let config = plugin
                    .permissions
                    .env
                    .iter()
                    .map(|variable| {
                        Ok(PluginConfigStatus {
                            configured: self.credentials.has_plugin_config(&plugin.name, variable)?,
                            optional: optional_settings::is_optional_setting(variable),
                            name: variable.clone(),
                        })
                    })
                    .collect::<AppResult<Vec<_>>>()?;
                // A sideloaded plugin never takes a catalog plugin's name, icon or links.
                let session_display_name = if record.is_local() {
                    None
                } else {
                    session_display_names.get(&plugin.name).and_then(Option::as_deref)
                };
                let display_name =
                    resolve_display_name(&plugin.name, [session_display_name, record.display_name.as_deref()]);
                Ok(InstalledPlugin {
                    name: plugin.name.clone(),
                    display_name,
                    version: plugin.version.clone(),
                    description: plugin.description.clone(),
                    permissions: plugin.permissions.clone(),
                    trusted: plugin.trusted,
                    needs_browser: record.needs_browser,
                    needs_node_runtime: plugin.needs_node,
                    nodes: plugin.nodes(),
                    tools: plugin.tools.clone(),
                    config,
                    load_error: plugin.load_error.clone(),
                    warnings: plugin.warnings.clone(),
                    readme_url: record.readme_url,
                    icon_url: record.icon_url,
                    source: record.source,
                    publisher: record.publisher,
                    repository_url: record.repository_url,
                    local_path: record.local_path,
                    mcp_server: plugin.mcp_server.as_ref().map(|server| McpServerSummary {
                        url: server.spec.url.clone(),
                        auth: auth_name(server.spec.auth).to_owned(),
                    }),
                })
            })
            .collect()
    }

    /// The tools of every loaded plugin as their manifests declare them, by plugin name
    /// (tool provider). Plugins that failed to load have none.
    pub fn tool_specs(&self) -> Vec<(String, Vec<graphrt_core::tool::ToolSpec>)> {
        let snapshot = self.snapshot();
        snapshot
            .plugins
            .iter()
            .filter(|plugin| plugin.is_loaded() && !plugin.tool_specs.is_empty())
            .map(|plugin| (plugin.name.clone(), plugin.tool_specs.clone()))
            .collect()
    }

    /// What people see for each plugin the app knows (installed ones, then the known
    /// catalog), keyed by technical name. Reading the install records may fail; the
    /// installed plugins then fall back to their catalog or humanized names.
    pub fn plugin_display_names(&self) -> HashMap<String, String> {
        let mut names: HashMap<String, String> = self
            .known_catalog()
            .map(|catalog| {
                catalog
                    .plugins
                    .iter()
                    .map(|plugin| {
                        (plugin.name.clone(), resolve_display_name(&plugin.name, [plugin.display_name.as_deref()]))
                    })
                    .collect()
            })
            .unwrap_or_default();
        match self.list_installed() {
            Ok(installed) => names.extend(installed.into_iter().map(|plugin| (plugin.name, plugin.display_name))),
            Err(error) => log::warn!("could not read the installed plugins' names: {error}"),
        }
        names
    }

    /// One installed plugin.
    ///
    /// # Errors
    /// `NotFound` when it is not installed.
    pub fn installed(&self, name: &str) -> AppResult<InstalledPlugin> {
        self.list_installed()?
            .into_iter()
            .find(|plugin| plugin.name == name)
            .ok_or_else(|| AppError::NotFound(format!("plugin {name}")))
    }

    /// The README link of a plugin, from the installed copy or the known catalog
    /// (never fetched for this). Only `https://` links are returned.
    ///
    /// # Errors
    /// `NotFound` when neither lists the plugin or it has no README link;
    /// `InvalidInput` when the link is not `https://`.
    pub fn readme_url(&self, name: &str) -> AppResult<String> {
        self.plugin_link(name, "README", |installed| installed.readme_url.clone(), |entry| entry.readme_url.clone())
    }

    /// The source repository link of a plugin, looked up like [`PluginService::readme_url`].
    ///
    /// # Errors
    /// `NotFound` when neither lists the plugin or it has no repository link;
    /// `InvalidInput` when the link is not `https://`.
    pub fn repository_url(&self, name: &str) -> AppResult<String> {
        self.plugin_link(
            name,
            "repository",
            |installed| installed.repository_url.clone(),
            |entry| entry.repository_url.clone(),
        )
    }

    /// A link of `name` from the installed copy, else the known catalog (never for a
    /// sideloaded plugin: a catalog plugin of the same name is a different plugin).
    fn plugin_link(
        &self,
        name: &str,
        label: &str,
        from_installed: impl Fn(&InstalledPlugin) -> Option<String>,
        from_catalog: impl Fn(&models::CatalogPlugin) -> Option<String>,
    ) -> AppResult<String> {
        let installed = self.installed(name).ok();
        let is_local = installed.as_ref().is_some_and(|plugin| plugin.source == models::PluginSource::Local);
        let installed_url = installed.as_ref().and_then(&from_installed);
        let catalog_url = || {
            if is_local {
                return None;
            }
            self.known_catalog()
                .and_then(|index| index.plugins.iter().find(|plugin| plugin.name == name).and_then(&from_catalog))
        };
        let url = installed_url
            .or_else(catalog_url)
            .ok_or_else(|| AppError::NotFound(format!("{label} of plugin {name}")))?;
        require_https(&url).map_err(|_| AppError::InvalidInput(format!("the {label} link of {name} is not https")))?;
        Ok(url)
    }

    /// A plugin's icon as a `data:image/svg+xml;base64,...` URL for an `<img>`, or `None`
    /// when it has none or it cannot be fetched (the UI shows its placeholder). The icon is
    /// downloaded once (HTTPS, at most [`icons::MAX_ICON_BYTES`]) and then read from disk,
    /// so it keeps working offline. A failed download is not retried this session.
    ///
    /// # Errors
    /// `InvalidInput` when `name` is not a valid plugin name.
    pub async fn icon_data_url(&self, name: &str) -> AppResult<Option<String>> {
        validate_name(name)?;
        let Some(icon_url) = self.icon_url(name) else { return Ok(None) };
        let cache_file = icons::cached_icon_path(&self.icons_dir, name, &icon_url);
        if let Some(bytes) = icons::read_cached_icon(&cache_file) {
            return Ok(Some(icons::svg_data_url(&bytes)));
        }
        if self.failed_icon_urls.lock().is_ok_and(|failed| failed.contains(&icon_url)) {
            return Ok(None);
        }
        match self.download_icon(&icon_url).await {
            Ok(bytes) => {
                icons::write_cached_icon(&self.icons_dir, name, &cache_file, &bytes);
                Ok(Some(icons::svg_data_url(&bytes)))
            }
            Err(error) => {
                log::warn!("could not fetch the icon of plugin {name}: {error}");
                if let Ok(mut failed) = self.failed_icon_urls.lock() {
                    failed.insert(icon_url);
                }
                Ok(None)
            }
        }
    }

    /// `name -> display_name` of the catalog fetched this session (empty before one), so
    /// installed plugins pick up a curated name the catalog added after they were installed.
    fn session_catalog_display_names(&self) -> HashMap<String, Option<String>> {
        let Ok(catalog) = self.catalog.lock() else { return HashMap::new() };
        let plugins = catalog.as_ref().map(|fetched| fetched.index.plugins.as_slice()).unwrap_or_default();
        plugins.iter().map(|plugin| (plugin.name.clone(), plugin.display_name.clone())).collect()
    }

    /// The icon link of `name`: from the catalog fetched this session when it lists the
    /// plugin, else the saved catalog, else the install record.
    fn icon_url(&self, name: &str) -> Option<String> {
        if self.is_local_plugin(name) {
            return None;
        }
        let from_session_catalog = self.catalog.lock().ok().and_then(|catalog| {
            let plugin = catalog.as_ref()?.index.plugins.iter().find(|plugin| plugin.name == name)?;
            Some(plugin.icon_url.clone())
        });
        let from_saved_catalog = || {
            let icon_urls = self.saved_catalog_icon_urls.get_or_init(|| {
                let index = self.saved_catalog();
                index
                    .map(|index| {
                        index.plugins.iter().map(|plugin| (plugin.name.clone(), plugin.icon_url.clone())).collect()
                    })
                    .unwrap_or_default()
            });
            icon_urls.get(name).cloned()
        };
        let from_install_record = || match settings::install_records(&self.db) {
            Ok(records) => records.get(name).and_then(|record| record.icon_url.clone()),
            Err(error) => {
                log::warn!("could not read the install record of plugin {name}: {error}");
                None
            }
        };
        let icon_url = match from_session_catalog.or_else(from_saved_catalog) {
            Some(listed) => listed,
            None => from_install_record(),
        }?;
        require_https(&icon_url).ok()?;
        // Install records written before the host check may hold any https link.
        let prefix = self.catalog_files.asset_prefix.as_deref()?;
        catalog::is_under_prefix(&icon_url, prefix).then_some(icon_url)
    }

    async fn download_icon(&self, icon_url: &str) -> AppResult<Vec<u8>> {
        require_https(icon_url)?;
        let bytes = self.downloader.fetch(icon_url, icons::MAX_ICON_BYTES, icons::ICON_TIMEOUT, None).await?;
        if !icons::looks_like_svg(&bytes) {
            return Err(AppError::InvalidInput(format!("{icon_url} is not an SVG image")));
        }
        Ok(bytes)
    }

    /// Installs (or reinstalls) `name` from the catalog. Progress goes to `plugin-event`.
    /// `approved` is what the user saw and approved (the catalog entry's permissions on
    /// the install card): a downloaded manifest asking for more is refused, so a catalog
    /// that understates its tarball can never get more than was shown.
    ///
    /// # Errors
    /// `NotFound` when the catalog has no such plugin; `InvalidInput` for a
    /// checksum mismatch, an unsafe archive, a plugin graphrt rejects or one asking
    /// for more than `approved`; `Internal` for download / I/O errors. Nothing is
    /// installed on error.
    pub async fn install(&self, name: &str, approved: &PluginPermissions) -> AppResult<InstalledPlugin> {
        self.install_with(name, &InstallMode::approved(approved.clone())).await
    }

    /// [`PluginService::install`] with `mode`'s permission limit and progress reporting.
    async fn install_with(&self, name: &str, mode: &InstallMode) -> AppResult<InstalledPlugin> {
        let _change = self.changes.lock().await;
        let result = self.install_from_catalog(name, mode).await;
        let (stage, message) = match &result {
            Ok(_) => (PluginInstallStage::Done, None),
            Err(error) => (PluginInstallStage::Failed, Some(error.to_string())),
        };
        if mode.reports_progress {
            self.send_progress(name, stage, None, message);
        }
        if result.is_ok() {
            self.events.send(PluginEvent::PluginsChanged);
        }
        result
    }

    /// Reinstalls an installed plugin from the catalog's current version.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; otherwise as [`PluginService::install`].
    pub async fn update(&self, name: &str) -> AppResult<InstalledPlugin> {
        if self.snapshot().plugin(name).is_none() {
            return Err(AppError::NotFound(format!("plugin {name}")));
        }
        self.install_with(name, &InstallMode::user_update()).await
    }

    async fn install_from_catalog(&self, name: &str, mode: &InstallMode) -> AppResult<InstalledPlugin> {
        if self.is_local_plugin(name) {
            return Err(AppError::InvalidInput(format!(
                "plugin {name} was installed from a folder or archive on this computer; remove it before installing the catalog version"
            )));
        }
        let entry = self.catalog_entry(name).await?;
        require_https(&entry.tarball_url)?;
        self.cache_detail_for_install(&entry).await;
        if entry.size_bytes > MAX_TARBALL_BYTES {
            return Err(AppError::InvalidInput(format!("plugin {name} is larger than the download limit")));
        }
        let max_bytes = if entry.size_bytes > 0 { entry.size_bytes } else { MAX_TARBALL_BYTES };
        let report = |stage: PluginInstallStage, bytes: Option<(u64, Option<u64>)>| {
            if mode.reports_progress {
                self.send_progress(name, stage, bytes, None);
            }
        };
        report(PluginInstallStage::Downloading, Some((0, Some(entry.size_bytes))));
        let progress = mode.reports_progress.then(|| self.progress_callback(name));
        let tarball = self.downloader.fetch(&entry.tarball_url, max_bytes, TARBALL_TIMEOUT, progress).await?;
        report(PluginInstallStage::Verifying, None);
        archive::verify_sha256(&tarball, &entry.sha256)?;
        report(PluginInstallStage::Extracting, None);
        let previous_permissions = self.snapshot().plugin(name).map(|plugin| plugin.permissions.clone());
        let plugins_dir = self.plugins_dir.clone();
        let plugin_name = name.to_owned();
        let permission_limit = mode.permission_limit.clone();
        let expected_version = Some(entry.version.clone());
        let manifest = tokio::task::spawn_blocking(move || {
            let base_registry = crate::flow::builtin_node_registry();
            let checks = install::InstallChecks { base_registry: &base_registry, permission_limit, expected_version };
            install::install_tarball(&plugins_dir, &plugin_name, &tarball, &checks)
        })
        .await
        .map_err(|error| AppError::Internal(format!("the install task stopped: {error}")))??;
        report(PluginInstallStage::Loading, None);
        let new_permissions = PluginPermissions::from(&manifest.manifest.permissions);
        if previous_permissions.is_some_and(|previous| new_permissions.asks_for_more_than(&previous)) {
            log::info!("plugin {name} asks for more permissions after the update; it is no longer trusted");
            settings::set_trusted(&self.db, name, false)?;
        }
        let record = InstallRecord {
            version: manifest.manifest.version.clone(),
            needs_browser: entry.needs_browser,
            readme_url: entry.readme_url.clone(),
            icon_url: entry.icon_url.clone(),
            display_name: entry.display_name.clone(),
            source: source::catalog_entry_source(&entry),
            publisher: entry.publisher.clone(),
            repository_url: entry.repository_url.clone(),
            local_path: None,
        };
        settings::save_install_record(&self.db, name, Some(record))?;
        self.reload();
        self.installed(name)
    }

    /// Removes a plugin, its trust and its settings.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; `Internal` for I/O errors.
    pub async fn remove(&self, name: &str) -> AppResult<()> {
        let _change = self.changes.lock().await;
        validate_name(name)?;
        let requested_env =
            self.snapshot().plugin(name).map(|plugin| plugin.permissions.env.clone()).unwrap_or_default();
        // An MCP preset's server is signed out (tokens revoked) while its record is still there.
        crate::mcp::plugin_servers::sign_out_plugin_server(&self.db, &self.credentials, name).await;
        install::remove_plugin_dir(&self.plugins_dir, name)?;
        for variable in requested_env {
            if let Err(error) = self.credentials.delete_plugin_config(name, &variable) {
                log::warn!("could not delete the {variable} setting of plugin {name}: {error}");
            }
        }
        settings::set_trusted(&self.db, name, false)?;
        settings::save_install_record(&self.db, name, None)?;
        self.reload();
        self.events.send(PluginEvent::PluginsChanged);
        Ok(())
    }

    /// Settings › Delete all data: removes every installed plugin and the
    /// `plugin-data` folder (browser profiles such as a WhatsApp Web login),
    /// and with `remove_settings` also each plugin's keychain settings.
    /// Trust records go with the settings table, which the caller empties.
    /// Returns how many plugins were removed; failures are logged per plugin.
    pub async fn remove_all(&self, remove_settings: bool) -> usize {
        let _change = self.changes.lock().await;
        let snapshot = self.snapshot();
        let mut removed_count = 0;
        for plugin_dir in host::plugin_dirs(&self.plugins_dir) {
            let Some(name) = plugin_dir.file_name().and_then(|file_name| file_name.to_str()).map(str::to_owned) else {
                continue;
            };
            if remove_settings {
                let requested_env =
                    snapshot.plugin(&name).map(|plugin| plugin.permissions.env.clone()).unwrap_or_default();
                for variable in requested_env {
                    if let Err(error) = self.credentials.delete_plugin_config(&name, &variable) {
                        log::warn!("could not delete the {variable} setting of plugin {name}: {error}");
                    }
                }
            }
            match install::remove_plugin_dir(&self.plugins_dir, &name) {
                Ok(()) => removed_count += 1,
                Err(error) => log::warn!("could not remove plugin {name}: {error}"),
            }
        }
        if let Err(error) = std::fs::remove_dir_all(&self.plugin_data_dir) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("could not remove the plugin data folder: {error}");
            }
        }
        self.reload();
        self.events.send(PluginEvent::PluginsChanged);
        removed_count
    }

    /// Trusts or stops trusting a plugin: trusted plugins receive their
    /// settings and plaintext secrets. Trusting needs `approved`, the permissions the
    /// user saw when approving (the trust toggle or requirement card), and is refused
    /// when the installed manifest asks for more. Untrusting needs no approval.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; `InvalidInput` when trusting without
    /// `approved` or the installed manifest asks for more than `approved`.
    pub async fn set_trusted(
        &self,
        name: &str,
        trusted: bool,
        approved: Option<&PluginPermissions>,
    ) -> AppResult<InstalledPlugin> {
        let _change = self.changes.lock().await;
        self.require_installed(name)?;
        if trusted {
            self.require_approved(name, approved)?;
        }
        settings::set_trusted(&self.db, name, trusted)?;
        self.reload();
        self.events.send(PluginEvent::PluginsChanged);
        self.installed(name)
    }

    /// Stores a setting the plugin requests (`permissions.env`) in the keychain.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; `InvalidInput` when the plugin does
    /// not request `variable` or `value` is empty.
    pub async fn set_config(&self, name: &str, variable: &str, value: &str) -> AppResult<InstalledPlugin> {
        let _change = self.changes.lock().await;
        self.require_requested(name, variable)?;
        self.credentials.set_plugin_config(name, variable, value)?;
        self.reload();
        self.installed(name)
    }

    /// Removes a stored setting.
    ///
    /// # Errors
    /// As [`PluginService::set_config`].
    pub async fn delete_config(&self, name: &str, variable: &str) -> AppResult<InstalledPlugin> {
        let _change = self.changes.lock().await;
        self.require_requested(name, variable)?;
        self.credentials.delete_plugin_config(name, variable)?;
        self.reload();
        self.installed(name)
    }

    /// Runs one node kind the plugin declares, once, and returns its outputs
    /// (e.g. `whatsapp-web.login` to show the QR window). Trusted plugins only.
    ///
    /// # Errors
    /// See `action::action_document` and `action::run_action`.
    pub async fn run_action(&self, name: &str, kind: &str, config: serde_json::Value) -> AppResult<PluginActionResult> {
        let snapshot = self.snapshot();
        let document = action::action_document(&snapshot, name, kind, config)?;
        let outcome = action::run_action(&snapshot, crate::flow::builtin_node_registry(), &document).await;
        self.record_session_report(name, kind, &outcome);
        Ok(PluginActionResult { outputs: outcome.result? })
    }

    /// Runs the status action of a session plugin (`whatsapp-web.get_status`), which also
    /// stores the state it reports, and returns that state.
    ///
    /// # Errors
    /// `InvalidInput` when `name` has no session; the action's errors otherwise.
    pub async fn check_session(&self, name: &str) -> AppResult<session::SessionState> {
        let kind = session::status_kind(name)
            .ok_or_else(|| AppError::InvalidInput(format!("plugin {name} has no account session to check")))?;
        let result = self.run_action(name, kind, serde_json::Value::Null).await?;
        Ok(session::state_from_outputs(name, kind, &result.outputs).unwrap_or(session::SessionState::Unknown))
    }

    /// Stores the session state a session plugin's action reported (or failed with).
    fn record_session_report(&self, name: &str, kind: &str, outcome: &action::ActionOutcome) {
        let reported = match &outcome.result {
            Ok(outputs) => session::state_from_outputs(name, kind, outputs),
            Err(_) => {
                outcome.failure_type.as_deref().and_then(|error_type| session::state_from_failure(name, error_type))
            }
        };
        let Some(state) = reported else { return };
        if let Err(error) = session::save_session(&self.db, name, state) {
            log::warn!("could not record the session state of plugin {name}: {error}");
        }
    }

    pub fn browser_runtime_status(&self) -> BrowserRuntimeStatus {
        self.node_runtime.browser_runtime_status()
    }

    /// Whether the plugin runtime (Node) is installed.
    pub fn plugin_runtime_status(&self) -> PluginRuntimeStatus {
        self.node_runtime.node_runtime_status()
    }

    /// After the plugin runtime was installed or removed: rebuilds the host (it resolves
    /// Node again) and tells the screens to refresh.
    pub fn plugin_runtime_changed(&self) {
        self.reload();
        self.events.send(PluginEvent::PluginsChanged);
    }

    /// Whether `name` was sideloaded (its install record says `local`). An unreadable
    /// record counts as local, so a catalog update never replaces it by mistake.
    fn is_local_plugin(&self, name: &str) -> bool {
        match settings::install_records(&self.db) {
            Ok(records) => records.get(name).is_some_and(InstallRecord::is_local),
            Err(error) => {
                log::warn!("could not read the install record of plugin {name}: {error}");
                true
            }
        }
    }

    /// The installed plugins that catalog versions apply to: every one except sideloaded
    /// plugins, which are never matched against catalog updates (or auto-updated).
    pub(super) fn catalog_matched_plugins(&self) -> Vec<host::PluginState> {
        let local_names: HashSet<String> = match settings::install_records(&self.db) {
            Ok(records) => records.into_iter().filter(|(_, record)| record.is_local()).map(|(name, _)| name).collect(),
            Err(error) => {
                log::warn!("could not read the plugin install records; no catalog updates are offered: {error}");
                return Vec::new();
            }
        };
        self.snapshot().plugins.iter().filter(|plugin| !local_names.contains(&plugin.name)).cloned().collect()
    }

    fn require_installed(&self, name: &str) -> AppResult<()> {
        validate_name(name)?;
        match self.snapshot().plugin(name) {
            Some(_) => Ok(()),
            None => Err(AppError::NotFound(format!("plugin {name}"))),
        }
    }

    /// `InvalidInput` unless the installed manifest of `name` asks for nothing beyond `approved`.
    fn require_approved(&self, name: &str, approved: Option<&PluginPermissions>) -> AppResult<()> {
        let Some(approved) = approved else {
            return Err(AppError::InvalidInput(format!(
                "approve what plugin {name} asks for before trusting it; it was not trusted"
            )));
        };
        let requested = self.snapshot().plugin(name).map(|plugin| plugin.permissions.clone()).unwrap_or_default();
        let beyond = requested.requests_beyond(approved);
        if beyond.is_empty() {
            return Ok(());
        }
        log::warn!("refused to trust plugin {name}: it asks for more than was approved ({})", beyond.join(", "));
        Err(AppError::InvalidInput(format!(
            "plugin {name} asks for more than you approved ({}); it was not trusted. Look at what it asks for again and approve it",
            beyond.join(", ")
        )))
    }

    fn require_requested(&self, name: &str, variable: &str) -> AppResult<()> {
        self.require_installed(name)?;
        let snapshot = self.snapshot();
        let requested =
            snapshot.plugin(name).is_some_and(|plugin| plugin.permissions.env.iter().any(|env| env == variable));
        if requested {
            Ok(())
        } else {
            Err(AppError::InvalidInput(format!("plugin {name} does not use a setting named {variable}")))
        }
    }

    fn send_progress(
        &self,
        name: &str,
        stage: PluginInstallStage,
        bytes: Option<(u64, Option<u64>)>,
        message: Option<String>,
    ) {
        self.events.send(PluginEvent::InstallProgress {
            name: name.to_owned(),
            stage,
            received_bytes: bytes.map(|(received, _)| received),
            total_bytes: bytes.and_then(|(_, total)| total).filter(|total| *total > 0),
            message,
        });
    }

    /// Download progress events, at most one per [`PROGRESS_STEP_BYTES`].
    fn progress_callback(&self, name: &str) -> ProgressCallback {
        let events = self.events.clone();
        let name = name.to_owned();
        let last_reported = AtomicU64::new(0);
        Arc::new(move |received, total| {
            let previous = last_reported.load(Ordering::Relaxed);
            let finished = total.is_some_and(|total| received >= total);
            if received.saturating_sub(previous) < PROGRESS_STEP_BYTES && !finished {
                return;
            }
            last_reported.store(received, Ordering::Relaxed);
            events.send(PluginEvent::InstallProgress {
                name: name.clone(),
                stage: PluginInstallStage::Downloading,
                received_bytes: Some(received),
                total_bytes: total,
                message: None,
            });
        })
    }
}

fn validate_name(name: &str) -> AppResult<()> {
    if graphrt_plugin::is_valid_name(name) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("`{name}` is not a valid plugin name")))
    }
}

/// How an MCP preset signs in, as the Plugins screen names it.
fn auth_name(auth: graphrt_plugin::McpAuth) -> &'static str {
    match auth {
        graphrt_plugin::McpAuth::None => "none",
        graphrt_plugin::McpAuth::Bearer => "bearer",
        graphrt_plugin::McpAuth::Oauth => "oauth",
    }
}
