//! What an agent's workflow needs from plugins (screens 03 and 04 show it inline in the
//! build chat). CONTRACT: implemented by the backend owner; the frontend reads it through
//! `list_agent_plugin_requirements`. Mirrors `src/api/pluginRequirementTypes.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::host::PluginState;
use super::models::{CatalogIndex, InstallRecord, PluginPermissions};
use crate::credentials::CredentialStore;
use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementPermissions {
    pub network: bool,
    pub secrets: bool,
    pub env: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequirement {
    pub name: String,
    pub description: String,
    pub used_by_steps: Vec<String>,
    pub permissions: RequirementPermissions,
    pub needs_browser: bool,
    pub warning: Option<String>,
    pub installed: bool,
    pub trusted: bool,
    pub trust_not_needed: bool,
    pub missing_config: Vec<String>,
    pub browser_ready: bool,
    pub ready: bool,
}

/// Requested variables ending in this get a default folder from the app, so they are never missing.
const PROFILE_DIR_SUFFIX: &str = "_PROFILE_DIR";

/// Tuning settings the plugins default themselves (API version, idle minutes, send interval,
/// daily limit, allowed folders). The catalog does not mark optional settings yet, so these
/// name endings stand in for that: they never block "ready" and stay editable in Connections.
const OPTIONAL_SETTING_SUFFIXES: &[&str] =
    &["_VERSION", "_MINUTES", "_SECONDS", "_LIMIT", "_DIR", "_DIRS", "_INTERVAL"];

fn is_optional_setting(variable: &str) -> bool {
    variable.ends_with(PROFILE_DIR_SUFFIX) || OPTIONAL_SETTING_SUFFIXES.iter().any(|suffix| variable.ends_with(suffix))
}

/// Where [`plugin_requirements`] reads plugin state from.
pub(crate) struct RequirementSources<'a> {
    /// Installed plugin folders (loaded or not).
    pub installed: &'a [PluginState],
    pub install_records: &'a BTreeMap<String, InstallRecord>,
    /// The catalog, when fetched or saved; describes plugins that are not installed.
    pub catalog: Option<&'a CatalogIndex>,
    pub credentials: &'a CredentialStore,
    /// Whether Chromium is ready for the named plugin.
    pub browser_ready: &'a dyn Fn(&str) -> bool,
}

/// One requirement per plugin whose node kinds `flow_yaml` uses, in the order
/// the plugins first appear. A node kind belongs to a plugin when an installed
/// plugin or a catalog entry declares it, or by its `<plugin>.` prefix.
/// An unreadable document needs nothing (its problems are reported elsewhere).
///
/// # Errors
/// `Credentials` when the keychain cannot be read.
pub(crate) fn plugin_requirements(
    flow_yaml: &str,
    sources: &RequirementSources<'_>,
) -> AppResult<Vec<PluginRequirement>> {
    let Ok(workflow) = graphrt_core::Workflow::parse(flow_yaml) else { return Ok(Vec::new()) };
    let mut steps_by_plugin: Vec<(String, Vec<String>)> = Vec::new();
    for node in &workflow.graph.nodes {
        let Some(plugin_name) = plugin_of_kind(&node.kind, sources) else { continue };
        let step_title = node.title.as_deref().map(str::trim).filter(|title| !title.is_empty()).unwrap_or(&node.id);
        match steps_by_plugin.iter_mut().find(|(name, _)| *name == plugin_name) {
            Some((_, steps)) => steps.push(step_title.to_owned()),
            None => steps_by_plugin.push((plugin_name, vec![step_title.to_owned()])),
        }
    }
    steps_by_plugin.into_iter().map(|(name, used_by_steps)| requirement(&name, used_by_steps, sources)).collect()
}

/// The plugin a node kind belongs to; `None` for the app's own kinds.
fn plugin_of_kind(kind: &str, sources: &RequirementSources<'_>) -> Option<String> {
    if let Some(plugin) = sources.installed.iter().find(|plugin| plugin.declares_kind(kind)) {
        return Some(plugin.name.clone());
    }
    let in_catalog = sources
        .catalog
        .and_then(|catalog| catalog.plugins.iter().find(|entry| entry.nodes.iter().any(|node| node.kind == kind)));
    if let Some(entry) = in_catalog {
        return Some(entry.name.clone());
    }
    let (prefix, _) = kind.split_once('.')?;
    graphrt_plugin::is_valid_name(prefix).then(|| prefix.to_owned())
}

fn requirement(
    name: &str,
    used_by_steps: Vec<String>,
    sources: &RequirementSources<'_>,
) -> AppResult<PluginRequirement> {
    let state = sources.installed.iter().find(|plugin| plugin.name == name && plugin.is_loaded());
    let entry = sources.catalog.and_then(|catalog| catalog.plugins.iter().find(|entry| entry.name == name));
    let permissions = match (state, entry) {
        (Some(state), _) => state.permissions.clone(),
        (None, Some(entry)) => PluginPermissions::from(&entry.permissions),
        (None, None) => PluginPermissions::default(),
    };
    let description = state
        .map(|state| state.description.clone())
        .filter(|description| !description.trim().is_empty())
        .or_else(|| entry.map(|entry| entry.description.clone()))
        .unwrap_or_default();
    let recorded_browser = sources.install_records.get(name).is_some_and(|record| record.needs_browser);
    let needs_browser = recorded_browser || entry.is_some_and(|entry| entry.needs_browser);
    let missing_config = missing_settings(name, &permissions.env, sources.credentials)?;
    let installed = state.is_some();
    let trusted = state.is_some_and(|state| state.trusted);
    // Settings and plaintext secrets only reach trusted plugins (see `host.rs`).
    let trust_not_needed = !permissions.secrets && permissions.env.is_empty();
    let browser_ready = !needs_browser || (sources.browser_ready)(name);
    let ready = installed && (trusted || trust_not_needed) && missing_config.is_empty() && browser_ready;
    Ok(PluginRequirement {
        name: name.to_owned(),
        description,
        used_by_steps,
        permissions: RequirementPermissions {
            network: permissions.network,
            secrets: permissions.secrets,
            env: permissions.env,
        },
        needs_browser,
        warning: entry.and_then(|entry| entry.warning.clone()).filter(|warning| !warning.trim().is_empty()),
        installed,
        trusted,
        trust_not_needed,
        missing_config,
        browser_ready,
        ready,
    })
}

/// Requested variables with no value in the keychain (browser profile folders
/// default to the app's own, so they are never missing).
fn missing_settings(plugin: &str, requested: &[String], credentials: &CredentialStore) -> AppResult<Vec<String>> {
    let mut missing = Vec::new();
    for variable in requested.iter().filter(|variable| !is_optional_setting(variable)) {
        if !credentials.has_plugin_config(plugin, variable)? {
            missing.push(variable.clone());
        }
    }
    Ok(missing)
}

#[cfg(test)]
mod optional_setting_tests {
    use super::is_optional_setting;

    #[test]
    fn tuning_settings_are_optional_and_credentials_are_not() {
        for optional in [
            "WHATSAPP_GRAPH_VERSION",
            "WHATSAPP_WEB_IDLE_MINUTES",
            "WHATSAPP_WEB_MIN_SEND_INTERVAL_SECONDS",
            "WHATSAPP_WEB_DAILY_SEND_LIMIT",
            "WHATSAPP_WEB_ALLOWED_FILE_DIRS",
            "WHATSAPP_WEB_PROFILE_DIR",
            "META_GRAPH_VERSION",
        ] {
            assert!(is_optional_setting(optional), "{optional}");
        }
        for required in ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_PAGE_ID", "X_CLIENT_SECRET"] {
            assert!(!is_optional_setting(required), "{required}");
        }
    }
}
