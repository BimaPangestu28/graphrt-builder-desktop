//! Builds a graphrt [`PluginHost`] from the plugin folder and the app's grants.
//!
//! graphrt starts process plugins with a clean environment: the basic variables
//! (`PATH`, `HOME`, ...), the host variables named in `permissions.env`, and
//! the manifest's fixed `env` map. At this graphrt revision a host cannot hand
//! a plugin its own environment, so before adding each manifest to the host
//! this module rewrites the in-memory copy:
//!
//! - `"command": "node"` becomes the bundled Node's absolute path
//!   (`NodeRuntime::node_executable()`), since `add` does not re-validate;
//! - the fixed `env` map gets `NodeRuntime::plugin_process_env()` (bundled
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
    pub trusted: bool,
    pub load_error: Option<String>,
    pub warnings: Vec<String>,
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
    /// From `NodeRuntime::node_executable()`: replaces `"command": "node"`.
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
        if excluded.contains_key(&state.name) {
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
fn plugin_dirs(plugins_dir: &Path) -> Vec<std::path::PathBuf> {
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
    if manifest.manifest.checksums.is_empty() {
        return Err(format!("plugin `{name}` does not pin its files with checksums"));
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
        trusted: trusted.contains(&plugin.name),
        load_error: None,
        warnings: Vec::new(),
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
        trusted: false,
        load_error: Some(message),
        warnings: Vec::new(),
    }
}

/// The manifest command that means "the bundled Node".
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
    // A Finder-launched app has a minimal PATH; run the bundled Node by its absolute path.
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
