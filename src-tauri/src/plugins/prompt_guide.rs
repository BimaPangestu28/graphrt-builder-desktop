//! The builder prompt's dynamic section: the installed plugins' step types.

use graphrt_core::catalog::NodeDescriptor;

use super::host::PluginState;

/// Most config fields listed per node kind (the rest are optional extras).
const MAX_FIELDS_PER_NODE: usize = 12;
/// Description excerpt length per node kind.
const MAX_DESCRIPTION_CHARS: usize = 220;

const SECTION_HEADER: &str = "\
- Installed plugins add the step types listed below. Use a plugin step (its kind as the node `type`, its \
fields directly on the node) instead of a raw `http-request` whenever a listed plugin covers the service. \
Their tokens and account settings are configured in the app (Connections > Plugins): never put them in \
`env` or in the document, and leave fields such as `access_token` out. Plugin steps output `data` (and \
`next_cursor` when listing); read results as `{{#<node id>.data...#}}`. Plugin steps that send, post, \
create, update or delete follow the approval rule above.";

/// The section for the published plugins, or an empty string when none are loaded.
pub fn installed_plugins_guide() -> String {
    match super::active::current() {
        Some(snapshot) => plugin_guide(&snapshot.plugins),
        None => String::new(),
    }
}

/// The section for `plugins` (only loaded ones are listed).
pub(crate) fn plugin_guide(plugins: &[PluginState]) -> String {
    let loaded: Vec<&PluginState> =
        plugins.iter().filter(|plugin| plugin.is_loaded() && !plugin.descriptors.is_empty()).collect();
    if loaded.is_empty() {
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
            section.push_str(&format!("\n  - `{}`", describe_node(descriptor, &plugin.permissions.env)));
        }
    }
    section
}

/// "kind` (Title): description. Fields: a*, b. Outputs: data" (the caller adds the opening backtick).
fn describe_node(descriptor: &NodeDescriptor, configured_env: &[String]) -> String {
    let mut line = format!("{}` ({})", descriptor.kind, descriptor.title);
    let description = one_line(&descriptor.description, MAX_DESCRIPTION_CHARS);
    if !description.is_empty() {
        line.push_str(&format!(": {description}"));
    }
    let fields = config_fields(&descriptor.config_schema, configured_env);
    if !fields.is_empty() {
        line.push_str(&format!(" Fields (* required): {}.", fields.join(", ")));
    }
    let outputs: Vec<&str> = descriptor.outputs.iter().map(|output| output.name.as_str()).collect();
    if !outputs.is_empty() {
        line.push_str(&format!(" Outputs: {}.", outputs.join(", ")));
    }
    line
}

/// `name*` / `name (type)` per schema property, leaving out fields the app
/// configures (a property named like the end of a requested env variable,
/// e.g. `phone_number_id` for `WHATSAPP_PHONE_NUMBER_ID`, and `access_token`).
fn config_fields(schema: &serde_json::Value, configured_env: &[String]) -> Vec<String> {
    let Some(properties) = schema.get("properties").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .map(|names| names.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default();
    properties
        .iter()
        .filter(|(name, _)| !is_configured_by_app(name, configured_env))
        .take(MAX_FIELDS_PER_NODE)
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
