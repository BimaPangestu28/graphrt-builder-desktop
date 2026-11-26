//! Builds a graphrt [`PluginHost`] from the plugin folder and the app's grants.
//!
//! graphrt starts process plugins with a clean environment: the basic variables
//! (`PATH`, `HOME`, ...), the host variables named in `permissions.env`, and
//! the manifest's fixed `env` map. At this graphrt revision a host cannot hand
//! a plugin its own environment, so before adding each manifest to the host
//! this module rewrites the in-memory copy:
//!
//! - `"command": "node"` becomes the plugin runtime's (Node) absolute path
//!   (`NodeRuntime::node_command_path()`), since `add` does not re-validate;
//! - the fixed `env` map gets `NodeRuntime::plugin_process_env()` (plugin runtime
//!   Node on `PATH`, the Playwright browser cache) and, for trusted plugins
//!   only, the requested variables stored in the keychain;
//! - requested `*_PROFILE_DIR` variables default to
//!   `<app data>/plugin-data/<plugin>/profile` (browser sessions stay with the app);
//! - `permissions.env` is emptied, so graphrt never copies those variables from
//!   the app's own process environment (the keychain is the only source);
//! - `inherit_env` is forced off, so a manifest cannot ask for the app's full
//!   environment.
//!
//! The files on disk are untouched, and their checksums are verified here and
//! again by graphrt before every process start.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

use graphrt_core::tool::ToolRegistry;
use graphrt_plugin::{LoadedManifest, PluginHost, Runtime};

use super::models::{PluginNodeInfo, PluginPermissions};
use crate::agent_steps::AGENT_TOOL_PROVIDER;
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};

/// One plugin folder as the app sees it (loaded or not).
#[derive(Debug, Clone)]
pub(crate) struct PluginState {
    pub name: String,
    pub version: String,
    pub description: String,
    /// Requested permissions (before the app's grants).
    pub permissions: PluginPermissions,
    /// Full node descriptors (for the builder prompt and action checks).
    pub descriptors: Vec<graphrt_core::catalog::NodeDescriptor>,
    pub tools: Vec<String>,
    /// The tools as the manifest declares them (description, JSON Schema of the arguments).
    pub tool_specs: Vec<graphrt_core::tool::ToolSpec>,
    /// Events the plugin can start agents on (see `crate::plugin_triggers`).
    pub triggers: Vec<graphrt_plugin::TriggerDescriptor>,
    pub trusted: bool,
    /// Runs on Node (`"command": "node"`), so it needs the plugin runtime.
    pub needs_node: bool,
    pub load_error: Option<String>,
    pub warnings: Vec<String>,
    /// `runtime: mcp`: the MCP server the plugin declares, with its builder guide.
    pub mcp_server: Option<PluginMcpServer>,
    /// Starter prompts for the New agent screen.
    pub templates: Vec<graphrt_plugin::PluginTemplate>,
}

/// The MCP server of an MCP preset plugin (registered in Connections > MCP servers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PluginMcpServer {
    pub spec: graphrt_plugin::McpServerSpec,
    /// The `guide` file's text (at most `MAX_GUIDE_BYTES`), when the plugin has one.
    pub guide: Option<String>,
}

impl PluginState {
    pub fn nodes(&self) -> Vec<PluginNodeInfo> {
        self.descriptors
            .iter()
            .map(|descriptor| PluginNodeInfo {
                kind: descriptor.kind.clone(),
                title: descriptor.title.clone(),
                description: descriptor.description.clone(),
            })
            .collect()
    }

    pub fn is_loaded(&self) -> bool {
        self.load_error.is_none()
    }

    pub fn declares_kind(&self, kind: &str) -> bool {
        self.descriptors.iter().any(|descriptor| descriptor.kind == kind)
    }
}

/// The loaded plugins at one point in time; replaced whole when plugins change.
pub(crate) struct PluginSnapshot {
    pub host: PluginHost,
    /// Plugin tool providers (provider name = plugin name).
    pub tools: ToolRegistry,
    /// Every plugin folder, sorted by name, with load errors.
    pub plugins: Vec<PluginState>,
}

impl std::fmt::Debug for PluginSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let names: Vec<&str> = self.plugins.iter().map(|plugin| plugin.name.as_str()).collect();
        formatter.debug_struct("PluginSnapshot").field("plugins", &names).finish()
    }
}

impl PluginSnapshot {
    pub fn empty() -> Self {
        Self { host: PluginHost::new(), tools: ToolRegistry::new(), plugins: Vec::new() }
    }

    /// Registers the loaded plugins' node kinds into `registry`. Never fails
    /// for a snapshot built by [`build_snapshot`] (it checked registration).
    pub fn register_nodes(&self, registry: &mut graphrt_core::Registry) {
        let mut unused_tools = ToolRegistry::new();
        if let Err(error) = self.host.register(registry, &mut unused_tools) {
            log::warn!("could not add plugin steps: {error}");
        }
    }

    /// Adds the plugin tool providers to `tools` (providers already present win).
    pub fn add_tools(&self, tools: &mut ToolRegistry) {
        for (provider, runtime) in self.tools.providers() {
            if tools.get(provider).is_none() {
                tools.add(provider, runtime.clone());
            }
        }
    }

    pub fn plugin(&self, name: &str) -> Option<&PluginState> {
        self.plugins.iter().find(|plugin| plugin.name == name)
    }
}

/// What building a host needs besides the folder.
pub(crate) struct HostInputs<'a> {
    pub trusted: &'a BTreeSet<String>,
    pub credentials: &'a CredentialStore,
    /// From `NodeRuntime::plugin_process_env()`.
    pub process_env: &'a [(String, String)],
    /// From `NodeRuntime::node_command_path()`: replaces `"command": "node"`.
    pub node_executable: Option<&'a Path>,
    /// The built-in registry plugin kinds must not collide with.
    pub base_registry: &'a graphrt_core::Registry,
    /// `<app data>/plugin-data`: per-plugin folders for requested `*_PROFILE_DIR` variables.
    pub plugin_data_dir: &'a Path,
}

/// Loads every plugin folder under `plugins_dir` (folders starting with `.`
/// are staging leftovers and skipped). A plugin that fails to load is listed
/// with its error and left out of the host; the others still load.
pub(crate) fn build_snapshot(plugins_dir: &Path, inputs: &HostInputs<'_>) -> PluginSnapshot {
    let mut states = Vec::new();
    let mut loadable = Vec::new();
    for dir in plugin_dirs(plugins_dir) {
        match read_plugin(&dir) {
            Ok(manifest) => {
                let state = state_from_manifest(&manifest, inputs.trusted);
                loadable.push((manifest, state));
            }
            Err(message) => states.push(failed_state(&dir, message)),
        }
    }
    let mut excluded: BTreeMap<String, String> = BTreeMap::new();
    // Each pass drops at most the plugins that failed; a handful of passes
    // settles even when several conflict.
    let (host, tools) = loop {
        match try_build(&loadable, &excluded, inputs) {
            Ok(built) => break built,
            Err((name, message)) => {
                let already_excluded = excluded.insert(name, message).is_some();
                if already_excluded || excluded.len() > loadable.len() {
                    break (PluginHost::new(), ToolRegistry::new());
                }
            }
        }
    };
    for (_, mut state) in loadable {
        if let Some(message) = excluded.get(&state.name) {
            state.load_error = Some(message.clone());
        }
        states.push(state);
    }
    states.sort_by(|left, right| left.name.cmp(&right.name));
    attach_host_warnings(&host, &mut states);
    PluginSnapshot { host, tools, plugins: states }
}

/// Builds a host from every loadable plugin not excluded, checking
/// registration against the base registry. On failure names the plugin to drop.
fn try_build(
    loadable: &[(LoadedManifest, PluginState)],
    excluded: &BTreeMap<String, String>,
    inputs: &HostInputs<'_>,
) -> Result<(PluginHost, ToolRegistry), (String, String)> {
    let mut host = PluginHost::new().with_trusted(inputs.trusted.iter().cloned());
    for (manifest, state) in loadable {
        // An MCP preset has no code: its server goes to Connections > MCP servers instead.
        if excluded.contains_key(&state.name) || state.mcp_server.is_some() {
            continue;
        }
        let prepared = prepare_for_host(manifest.clone(), state.trusted, inputs)
            .map_err(|error| (state.name.clone(), error.to_string()))?;
        host.add(prepared).map_err(|error| (state.name.clone(), error.to_string()))?;
    }
    let mut registry = inputs.base_registry.clone();
    let mut tools = ToolRegistry::new();
    host.register(&mut registry, &mut tools)
        .map_err(|error| (culprit(&error, loadable, excluded), error.to_string()))?;
    Ok((host, tools))
}

/// The plugin a registration error is about (first loadable one as a fallback).
fn culprit(
    error: &graphrt_plugin::PluginError,
    loadable: &[(LoadedManifest, PluginState)],
    excluded: &BTreeMap<String, String>,
) -> String {
    let message = error.to_string();
    loadable
        .iter()
        .map(|(_, state)| state.name.as_str())
        .filter(|name| !excluded.contains_key(*name))
        .find(|name| message.contains(&format!("`{name}`")) || message.contains(&format!("{name}.")))
        .or_else(|| loadable.iter().map(|(_, state)| state.name.as_str()).find(|name| !excluded.contains_key(*name)))
        .unwrap_or_default()
        .to_owned()
}

fn attach_host_warnings(host: &PluginHost, states: &mut [PluginState]) {
    for info in host.plugins() {
        if let Some(state) = states.iter_mut().find(|state| state.name == info.name) {
            state.warnings.extend(info.warnings);
        }
    }
}

/// Plugin folders, sorted, skipping dot folders.
pub(super) fn plugin_dirs(plugins_dir: &Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(plugins_dir) else { return Vec::new() };
    let mut dirs: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
        .map(|entry| entry.path())
        .collect();
    dirs.sort();
    dirs
}

/// Parses and checks one installed plugin folder.
pub(crate) fn read_plugin(dir: &Path) -> Result<LoadedManifest, String> {
    let manifest = LoadedManifest::from_dir(dir).map_err(|error| error.to_string())?;
    let folder_name = dir.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    check_manifest(&manifest, &folder_name)?;
    graphrt_plugin::verify_checksums(&manifest).map_err(|error| error.to_string())?;
    Ok(manifest)
}

/// Rules the app adds on top of graphrt's manifest validation.
pub(crate) fn check_manifest(manifest: &LoadedManifest, expected_name: &str) -> Result<(), String> {
    let name = &manifest.manifest.name;
    if name != expected_name {
        return Err(format!("the plugin in `{expected_name}` calls itself `{name}`"));
    }
    if name == AGENT_TOOL_PROVIDER {
        return Err(format!("`{name}` is reserved for the app's own agent tools"));
    }
    match &manifest.manifest.runtime {
        // An MCP preset has no code; its guide (what the builder is told) is pinned.
        Runtime::Mcp(runtime) => {
            let guide = runtime.mcp.guide.as_deref().map(|guide| guide.trim_start_matches("./"));
            if let Some(guide) = guide {
                if !manifest.manifest.checksums.keys().any(|path| path.trim_start_matches("./") == guide) {
                    return Err(format!("plugin `{name}` does not pin its guide `{guide}` with a checksum"));
                }
            }
        }
        _ if manifest.manifest.checksums.is_empty() => {
            return Err(format!("plugin `{name}` does not pin its files with checksums"));
        }
        _ => {}
    }
    Ok(())
}

fn state_from_manifest(manifest: &LoadedManifest, trusted: &BTreeSet<String>) -> PluginState {
    let plugin = &manifest.manifest;
    PluginState {
        name: plugin.name.clone(),
        version: plugin.version.clone(),
        description: plugin.description.clone(),
        permissions: PluginPermissions::from(&plugin.permissions),
        descriptors: plugin.nodes.clone(),
        tools: plugin.tools.iter().map(|tool| tool.name.clone()).collect(),
        tool_specs: plugin.tools.clone(),
        triggers: plugin.triggers.clone(),
        trusted: trusted.contains(&plugin.name),
        needs_node: matches!(&plugin.runtime, Runtime::Process(process) if process.command == NODE_COMMAND),
        load_error: None,
        warnings: Vec::new(),
        mcp_server: match &plugin.runtime {
            Runtime::Mcp(runtime) => {
                Some(PluginMcpServer { spec: runtime.mcp.clone(), guide: read_guide(manifest, &runtime.mcp) })
            }
            _ => None,
        },
        templates: plugin.templates.clone(),
    }
}

/// The MCP preset's guide text; a missing, unreadable or oversized file is logged and left out.
fn read_guide(manifest: &LoadedManifest, spec: &graphrt_plugin::McpServerSpec) -> Option<String> {
    let relative = spec.guide.as_deref()?;
    let path = manifest.resolve(relative);
    let limit = graphrt_plugin::mcp_preset::MAX_GUIDE_BYTES;
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.len() > limit => {
            log::warn!("plugin {}: guide {relative} is larger than {limit} bytes, ignored", manifest.manifest.name);
            return None;
        }
        Err(error) => {
            log::warn!("plugin {}: could not read guide {relative}: {error}", manifest.manifest.name);
            return None;
        }
        Ok(_) => {}
    }
    match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(error) => {
            log::warn!("plugin {}: could not read guide {relative}: {error}", manifest.manifest.name);
            None
        }
    }
}

fn failed_state(dir: &Path, message: String) -> PluginState {
    PluginState {
        name: dir.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        version: String::new(),
        description: String::new(),
        permissions: PluginPermissions::default(),
        descriptors: Vec::new(),
        tools: Vec::new(),
        tool_specs: Vec::new(),
        triggers: Vec::new(),
        trusted: false,
        // Unknown for a folder that does not load; every catalog plugin runs on Node.
        needs_node: true,
        load_error: Some(message),
        warnings: Vec::new(),
        mcp_server: None,
        templates: Vec::new(),
    }
}

/// The manifest command that means "the plugin runtime (Node)".
const NODE_COMMAND: &str = "node";

/// Requested variables ending in this get a default folder under `plugin-data`.
const PROFILE_DIR_SUFFIX: &str = "_PROFILE_DIR";

/// Applies the app's environment policy to an in-memory manifest copy (see the module docs).
fn prepare_for_host(mut manifest: LoadedManifest, trusted: bool, inputs: &HostInputs<'_>) -> AppResult<LoadedManifest> {
    let name = manifest.manifest.name.clone();
    let requested = std::mem::take(&mut manifest.manifest.permissions.env);
    let Runtime::Process(process) = &mut manifest.manifest.runtime else {
        return Err(AppError::InvalidInput(format!(
            "plugin `{name}` is not a process plugin; only those are supported"
        )));
    };
    process.inherit_env = false;
    // A Finder-launched app has a minimal PATH; run the plugin runtime's Node by its absolute path.
    if process.command == NODE_COMMAND {
        if let Some(node_executable) = inputs.node_executable {
            process.command = node_executable.to_string_lossy().into_owned();
        }
    }
    for (variable, value) in inputs.process_env {
        process.env.insert(variable.clone(), value.clone());
    }
    // Browser profiles (e.g. WHATSAPP_WEB_PROFILE_DIR) default to the app data
    // folder instead of the plugin's own default under HOME; a stored value wins.
    for variable in requested.iter().filter(|variable| variable.ends_with(PROFILE_DIR_SUFFIX)) {
        let profile_dir = inputs.plugin_data_dir.join(&name).join("profile");
        process.env.insert(variable.clone(), profile_dir.to_string_lossy().into_owned());
    }
    if trusted {
        for variable in &requested {
            if let Some(value) = inputs.credentials.read_plugin_config(&name, variable)? {
                process.env.insert(variable.clone(), value);
            }
        }
    }
    Ok(manifest)
}

/// Shared handle to a snapshot.
pub(crate) type SharedSnapshot = Arc<PluginSnapshot>;
