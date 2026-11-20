//! What an agent's workflow needs from plugins (screens 03 and 04 show it inline in the
//! build chat). CONTRACT: implemented by the backend owner; the frontend reads it through
//! `list_agent_plugin_requirements`. Mirrors `src/api/pluginRequirementTypes.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::display_name::resolve_display_name;
use super::host::PluginState;
use super::models::{CatalogIndex, InstallRecord, PluginPermissions};
use super::optional_settings::is_optional_setting;
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
    /// What people see (see `display_name.rs`): catalog, then install record, then humanized.
    pub display_name: String,
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
    /// The plugin only works with a linked account session (WhatsApp Web by QR code).
    pub needs_session: bool,
    /// The session is known to be linked (always true when not needed). A session never
    /// checked counts as not linked.
    pub session_linked: bool,
    pub ready: bool,
}

/// A setting a plugin reads only in some of its node kinds.
struct NodeScopedSetting {
    variable: &'static str,
    /// The node kinds that cannot run without it.
    needed_by_kinds: &'static [&'static str],
}

/// Settings that block "ready" only when the agent uses a node kind that needs them. Plugin
/// manifests and the catalog declare one flat `permissions.env` list with no required/optional
/// marker, so the known cases are listed here (taken from each plugin's README and operation
/// code). Every setting still shows and stays editable in Connections.
const NODE_SCOPED_SETTINGS: &[NodeScopedSetting] = &[NodeScopedSetting {
    // Sending, media and the business profile use the phone number id; only template
    // management and listing phone numbers address the WhatsApp Business Account.
    variable: "WHATSAPP_BUSINESS_ACCOUNT_ID",
    needed_by_kinds: &[
        "whatsapp-api.list_templates",
        "whatsapp-api.create_template",
        "whatsapp-api.delete_template",
        "whatsapp-api.list_phone_numbers",
    ],
}];

/// Whether `variable` must be set before an agent using `used_kinds` can run.
fn is_required_setting(variable: &str, used_kinds: &[String]) -> bool {
    if is_optional_setting(variable) {
        return false;
    }
    match NODE_SCOPED_SETTINGS.iter().find(|setting| setting.variable == variable) {
        Some(setting) => used_kinds.iter().any(|kind| setting.needed_by_kinds.contains(&kind.as_str())),
        None => true,
    }
}

/// The steps and node kinds of one plugin that a workflow uses.
struct PluginUsage {
    plugin_name: String,
    step_titles: Vec<String>,
    node_kinds: Vec<String>,
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
    /// For plugins that need a linked account session (see `session.rs`): whether it is
    /// known to be linked. `None` for plugins without a session.
    pub session_linked: &'a dyn Fn(&str) -> Option<bool>,
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
    let mut usages: Vec<PluginUsage> = Vec::new();
    for node in &workflow.graph.nodes {
        let Some(plugin_name) = plugin_of_kind(&node.kind, sources) else { continue };
        let step_title = node.title.as_deref().map(str::trim).filter(|title| !title.is_empty()).unwrap_or(&node.id);
        let usage_index = match usages.iter().position(|usage| usage.plugin_name == plugin_name) {
            Some(index) => index,
            None => {
                usages.push(PluginUsage { plugin_name, step_titles: Vec::new(), node_kinds: Vec::new() });
                usages.len() - 1
            }
        };
        let usage = &mut usages[usage_index];
        usage.step_titles.push(step_title.to_owned());
        if !usage.node_kinds.contains(&node.kind) {
            usage.node_kinds.push(node.kind.clone());
        }
    }
    usages.into_iter().map(|usage| requirement(usage, sources)).collect()
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

fn requirement(usage: PluginUsage, sources: &RequirementSources<'_>) -> AppResult<PluginRequirement> {
    let PluginUsage { plugin_name, step_titles: used_by_steps, node_kinds } = usage;
    let name = plugin_name.as_str();
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
    let missing_config = missing_settings(name, &permissions.env, &node_kinds, sources.credentials)?;
    let installed = state.is_some();
    let trusted = state.is_some_and(|state| state.trusted);
    // Settings and plaintext secrets only reach trusted plugins (see `host.rs`).
    let trust_not_needed = !permissions.secrets && permissions.env.is_empty();
    let browser_ready = !needs_browser || (sources.browser_ready)(name);
    let session_state = (sources.session_linked)(name);
    let needs_session = session_state.is_some();
    let session_linked = session_state.unwrap_or(true);
    let ready =
        installed && (trusted || trust_not_needed) && missing_config.is_empty() && browser_ready && session_linked;
    let display_name = resolve_display_name(
        name,
        [
            entry.and_then(|entry| entry.display_name.as_deref()),
            sources.install_records.get(name).and_then(|record| record.display_name.as_deref()),
        ],
    );
    Ok(PluginRequirement {
        name: name.to_owned(),
        display_name,
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
        needs_session,
        session_linked,
        ready,
    })
}

/// Required variables (see [`is_required_setting`]) with no value in the keychain.
fn missing_settings(
    plugin: &str,
    requested: &[String],
    used_kinds: &[String],
    credentials: &CredentialStore,
) -> AppResult<Vec<String>> {
    let mut missing = Vec::new();
    for variable in requested.iter().filter(|variable| is_required_setting(variable, used_kinds)) {
        if !credentials.has_plugin_config(plugin, variable)? {
            missing.push(variable.clone());
        }
    }
    Ok(missing)
}

#[cfg(test)]
mod optional_setting_tests {
    use super::is_required_setting;

    fn kinds(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn whatsapp_business_account_id_is_required_only_by_template_and_account_nodes() {
        let sending = kinds(&["whatsapp-api.send_text", "whatsapp-api.send_template", "whatsapp-api.send_media"]);
        assert!(!is_required_setting("WHATSAPP_BUSINESS_ACCOUNT_ID", &sending));
        assert!(is_required_setting("WHATSAPP_ACCESS_TOKEN", &sending));
        assert!(is_required_setting("WHATSAPP_PHONE_NUMBER_ID", &sending));
        assert!(!is_required_setting("WHATSAPP_GRAPH_VERSION", &sending));

        for management in
            ["whatsapp-api.list_templates", "whatsapp-api.create_template", "whatsapp-api.list_phone_numbers"]
        {
            let used = kinds(&["whatsapp-api.send_text", management]);
            assert!(is_required_setting("WHATSAPP_BUSINESS_ACCOUNT_ID", &used), "{management}");
        }
    }

    #[test]
    fn unlisted_settings_stay_required_whatever_nodes_are_used() {
        assert!(is_required_setting("META_PAGE_ID", &[]));
        assert!(is_required_setting("X_CLIENT_SECRET", &kinds(&["x-api.create_post"])));
        assert!(!is_required_setting("META_GRAPH_VERSION", &[]));
    }
}
