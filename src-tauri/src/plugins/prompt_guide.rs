//! The builder prompt's dynamic section: the step types of installed plugins
//! and of catalog plugins that are not installed yet (the user is asked to
//! install those after the draft).

use graphrt_core::catalog::NodeDescriptor;

use super::host::PluginState;
use super::models::{CatalogIndex, CatalogPlugin};
use super::placeholder::catalog_descriptor;

/// Most config fields listed per node kind (the rest are optional extras).
const MAX_FIELDS_PER_NODE: usize = 12;
/// Description excerpt length per node kind.
const MAX_DESCRIPTION_CHARS: usize = 220;
/// Catalog plugins are listed more briefly: there are many of them.
const MAX_CATALOG_FIELDS_PER_NODE: usize = 8;
const MAX_CATALOG_DESCRIPTION_CHARS: usize = 110;

const SECTION_HEADER: &str = "\
- Plugins add the step types listed below. Use a plugin step (its kind as the node `type`, its \
fields directly on the node) instead of a raw `http-request` whenever a listed plugin covers the service, \
installed or not: the app asks the user to install the plugins a draft uses. Their tokens and account settings are configured in the app (Connections > Plugins): never put them in \
`env` or in the document, and leave fields such as `access_token` out. Plugin steps output `data` (and \
`next_cursor` when listing); read results as `{{#<node id>.data...#}}`. Plugin steps that send, post, \
create, update or delete follow the approval rule above.";

/// The section for the published plugins and catalog, or an empty string when there are none.
pub fn installed_plugins_guide() -> String {
    let catalog = super::active::current_catalog();
    match super::active::current() {
        Some(snapshot) => plugin_guide(&snapshot.plugins, catalog.as_deref()),
        None => plugin_guide(&[], catalog.as_deref()),
    }
}

/// How much of each node is listed.
#[derive(Clone, Copy)]
struct Detail {
    max_fields: usize,
    max_description_chars: usize,
}

const INSTALLED_DETAIL: Detail =
    Detail { max_fields: MAX_FIELDS_PER_NODE, max_description_chars: MAX_DESCRIPTION_CHARS };
const CATALOG_DETAIL: Detail =
    Detail { max_fields: MAX_CATALOG_FIELDS_PER_NODE, max_description_chars: MAX_CATALOG_DESCRIPTION_CHARS };

/// The section for `plugins` (only loaded ones are listed) and the `catalog`
/// plugins that are not among them.
pub(crate) fn plugin_guide(plugins: &[PluginState], catalog: Option<&CatalogIndex>) -> String {
    let loaded: Vec<&PluginState> =
        plugins.iter().filter(|plugin| plugin.is_loaded() && !plugin.descriptors.is_empty()).collect();
    let not_installed: Vec<&CatalogPlugin> = catalog
        .map(|catalog| {
            catalog
                .plugins
                .iter()
                .filter(|entry| !entry.nodes.is_empty())
                .filter(|entry| !loaded.iter().any(|plugin| plugin.name == entry.name))
                .collect()
        })
        .unwrap_or_default();
    if loaded.is_empty() && not_installed.is_empty() {
        return String::new();
    }
    let mut section = SECTION_HEADER.to_owned();
    for plugin in loaded {
        section.push_str(&format!(
            "\n  Plugin `{}`: {}",
            plugin.name,
            one_line(&plugin.description, MAX_DESCRIPTION_CHARS)
        ));
        for descriptor in &plugin.descriptors {
            section
                .push_str(&format!("\n  - `{}`", describe_node(descriptor, &plugin.permissions.env, INSTALLED_DETAIL)));
        }
    }
    for entry in not_installed {
        section.push_str(&format!(
            "\n  Plugin `{}` (not installed yet): {}",
            entry.name,
            one_line(&entry.description, MAX_DESCRIPTION_CHARS)
        ));
        for node in &entry.nodes {
            let descriptor = catalog_descriptor(node, &entry.name);
            section
                .push_str(&format!("\n  - `{}`", describe_node(&descriptor, &entry.permissions.env, CATALOG_DETAIL)));
        }
    }
    section
}

/// "kind` (Title): description. Fields: a*, b. Outputs: data" (the caller adds the opening backtick).
fn describe_node(descriptor: &NodeDescriptor, configured_env: &[String], detail: Detail) -> String {
    let mut line = format!("{}` ({})", descriptor.kind, descriptor.title);
    let description = one_line(&descriptor.description, detail.max_description_chars);
    if !description.is_empty() {
        line.push_str(&format!(": {description}"));
    }
    let fields = config_fields(&descriptor.config_schema, configured_env, detail.max_fields);
    if !fields.is_empty() {
        line.push_str(&format!(" Fields (* required): {}.", fields.join(", ")));
    }
    let outputs: Vec<&str> = descriptor.outputs.iter().map(|output| output.name.as_str()).collect();
    if !outputs.is_empty() {
        line.push_str(&format!(" Outputs: {}.", outputs.join(", ")));
    }
    line
}

/// `name*` / `name (type)` per schema property (required ones first), leaving out fields the app
/// configures (a property named like the end of a requested env variable,
/// e.g. `phone_number_id` for `WHATSAPP_PHONE_NUMBER_ID`, and `access_token`).
fn config_fields(schema: &serde_json::Value, configured_env: &[String], max_fields: usize) -> Vec<String> {
    let Some(properties) = schema.get("properties").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .map(|names| names.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default();
    let mut offered: Vec<(&String, &serde_json::Value)> =
        properties.iter().filter(|(name, _)| !is_configured_by_app(name, configured_env)).collect();
    // Required fields first, so the cap never hides one.
    offered.sort_by_key(|(name, _)| !required.contains(&name.as_str()));
    offered
        .into_iter()
        .take(max_fields)
        .map(|(name, property)| {
            let type_name = property.get("type").and_then(serde_json::Value::as_str).unwrap_or("any");
            let marker = if required.contains(&name.as_str()) { "*" } else { "" };
            format!("{name}{marker} ({type_name})")
        })
        .collect()
}

fn is_configured_by_app(field: &str, configured_env: &[String]) -> bool {
    let upper = field.to_ascii_uppercase();
    upper == "ACCESS_TOKEN" || configured_env.iter().any(|variable| variable.ends_with(&format!("_{upper}")))
}

fn one_line(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(max_chars).collect();
    format!("{}…", cut.trim_end())
}
