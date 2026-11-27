//! Plugin operations as the guided builder offers them to a small model.
//!
//! The full builder prompt lists every plugin step with its fields ([`super::prompt_guide`]),
//! which a local model cannot read whole. The guided builder instead offers a handful of
//! operations that match the job, each as one line, and later asks for the fields of the
//! one the model picked. An operation here is a plugin node kind taken from the plugin's
//! own manifest (installed) or from the catalog (not installed yet): its name, what it
//! does and its simple fields. Nothing is invented.

use graphrt_core::catalog::NodeDescriptor;

use super::host::PluginState;
use super::models::CatalogIndex;
use super::placeholder::catalog_descriptor;
use super::sending::is_sending_plugin_kind;

/// Most fields offered per operation: the required ones first.
const MAX_FIELDS: usize = 8;
/// Longest field or operation description kept.
const MAX_DESCRIPTION_CHARS: usize = 140;

/// Operations that are raw escape hatches or connection checks, not steps of a job.
const UNOFFERED_OPERATIONS: &[&str] = &["api_request", "verify_connection", "auth_test", "graphql_request"];

/// A plugin step the guided builder may put into a plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfferedOperation {
    /// The node kind, e.g. `email.send_email`.
    pub kind: String,
    /// The plugin's technical name, e.g. `email`.
    pub plugin: String,
    pub title: String,
    pub description: String,
    pub installed: bool,
    /// Sends or changes something outside the app: the app asks the user first.
    pub sends: bool,
    /// The plugin needs setting up first: an account or key of the person's (it asks
    /// for secrets), or a browser it drives (as its catalog entry says).
    pub needs_setup: bool,
    pub fields: Vec<OperationField>,
}

/// One simple field of an operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OperationField {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub field_type: FieldType,
}

/// The JSON types a small model fills in reliably.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FieldType {
    Text,
    Number,
    Integer,
    Boolean,
}

impl FieldType {
    pub(crate) fn json_schema_type(self) -> &'static str {
        match self {
            Self::Text => "string",
            Self::Number => "number",
            Self::Integer => "integer",
            Self::Boolean => "boolean",
        }
    }

    fn from_schema(property: &serde_json::Value) -> Option<Self> {
        match property.get("type").and_then(serde_json::Value::as_str)? {
            "string" => Some(Self::Text),
            "number" => Some(Self::Number),
            "integer" => Some(Self::Integer),
            "boolean" => Some(Self::Boolean),
            _ => None,
        }
    }
}

/// The operations of the published plugins and catalog (see [`operations_of`]).
pub(crate) fn offered_operations() -> Vec<OfferedOperation> {
    let catalog = super::active::current_catalog();
    match super::active::current() {
        Some(snapshot) => operations_of(&snapshot.plugins, catalog.as_deref()),
        None => operations_of(&[], catalog.as_deref()),
    }
}

/// Every operation a plan may use: those of loaded plugins, then those of catalog plugins
/// that are not installed. An operation is left out when a required field is not a simple
/// value (a list, an object), because the guided builder could not fill it in.
pub(crate) fn operations_of(plugins: &[PluginState], catalog: Option<&CatalogIndex>) -> Vec<OfferedOperation> {
    let loaded: Vec<&PluginState> = plugins.iter().filter(|plugin| plugin.is_loaded()).collect();
    let mut operations = Vec::new();
    let catalog_entries = catalog.map(|catalog| catalog.plugins.as_slice()).unwrap_or_default();
    for plugin in &loaded {
        // A plugin that drives a browser needs one set up, installed or not.
        let needs_browser = catalog_entries.iter().any(|entry| entry.name == plugin.name && entry.needs_browser);
        for descriptor in &plugin.descriptors {
            let operation = offered(descriptor, &plugin.name, &plugin.permissions, true);
            operations.extend(operation.map(|operation| OfferedOperation {
                needs_setup: operation.needs_setup || needs_browser,
                ..operation
            }));
        }
    }
    for entry in catalog_entries {
        if loaded.iter().any(|plugin| plugin.name == entry.name) {
            continue;
        }
        for node in &entry.nodes {
            let descriptor = catalog_descriptor(node, &entry.name);
            let permissions = super::models::PluginPermissions::from(&entry.permissions);
            let operation = offered(&descriptor, &entry.name, &permissions, false);
            operations.extend(operation.map(|operation| OfferedOperation {
                needs_setup: operation.needs_setup || entry.needs_browser,
                ..operation
            }));
        }
    }
    operations
}

fn offered(
    descriptor: &NodeDescriptor,
    plugin: &str,
    permissions: &super::models::PluginPermissions,
    installed: bool,
) -> Option<OfferedOperation> {
    let configured_env = permissions.env.as_slice();
    let (_, operation) = descriptor.kind.split_once('.')?;
    if UNOFFERED_OPERATIONS.contains(&operation) {
        return None;
    }
    let schema = &descriptor.config_schema;
    let required: Vec<&str> = schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .map(|names| names.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default();
    let empty = serde_json::Map::new();
    let properties = schema.get("properties").and_then(serde_json::Value::as_object).unwrap_or(&empty);
    let mut fields = Vec::new();
    for (name, property) in properties {
        if is_configured_by_app(name, configured_env) {
            continue;
        }
        let is_required = required.contains(&name.as_str());
        match FieldType::from_schema(property) {
            Some(field_type) => fields.push(OperationField {
                name: name.clone(),
                description: one_line(property.get("description").and_then(serde_json::Value::as_str).unwrap_or("")),
                required: is_required,
                field_type,
            }),
            // A required list or object: not an operation a plan can fill in.
            None if is_required => return None,
            None => {}
        }
    }
    // A required field the schema does not describe cannot be filled in either.
    if required.iter().any(|name| !properties.contains_key(*name)) {
        return None;
    }
    fields.sort_by_key(|field| !field.required);
    fields.truncate(MAX_FIELDS);
    Some(OfferedOperation {
        kind: descriptor.kind.clone(),
        plugin: plugin.to_owned(),
        title: descriptor.title.clone(),
        description: one_line(&descriptor.description),
        installed,
        sends: is_sending_plugin_kind(&descriptor.kind),
        needs_setup: permissions.secrets,
        fields,
    })
}

/// Whether a plugin node kind sends or changes something, read from its name
/// (see [`super::sending`]). For operations that are not in an offered list.
pub(crate) fn sends(kind: &str) -> bool {
    is_sending_plugin_kind(kind)
}

/// Fields the app fills in itself (the plugin's token and account settings).
fn is_configured_by_app(field: &str, configured_env: &[String]) -> bool {
    let upper = field.to_ascii_uppercase();
    upper == "ACCESS_TOKEN" || configured_env.iter().any(|variable| variable.ends_with(&format!("_{upper}")))
}

fn one_line(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_DESCRIPTION_CHARS {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(MAX_DESCRIPTION_CHARS).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use graphrt_core::catalog::NodeCategory;
    use serde_json::json;

    static NO_PERMISSIONS: std::sync::LazyLock<super::super::models::PluginPermissions> =
        std::sync::LazyLock::new(Default::default);

    fn descriptor(kind: &str, title: &str, schema: serde_json::Value) -> NodeDescriptor {
        let mut descriptor = NodeDescriptor::new(kind.to_owned(), title.to_owned(), NodeCategory::Other);
        descriptor.description = format!("{title} for a test");
        descriptor.config_schema = schema;
        descriptor
    }

    /// The email plugin's sending step as its manifest declares it (shortened).
    pub(crate) fn send_email_operation() -> OfferedOperation {
        let schema = json!({
            "type": "object",
            "properties": {
                "to": { "type": "string", "description": "Recipients, separated by commas" },
                "subject": { "type": "string", "description": "Subject line" },
                "text": { "type": "string", "description": "Plain-text body" },
                "cc": { "type": "string", "description": "Copy to" },
                "attachments": { "type": "array" },
                "access_token": { "type": "string" }
            },
            "required": ["to", "subject"]
        });
        offered(&descriptor("email.send_email", "Send email", schema), "email", &NO_PERMISSIONS, false).unwrap()
    }

    /// A reading operation with typed optional fields.
    pub(crate) fn list_messages_operation() -> OfferedOperation {
        let schema = json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "description": "Messages per page" },
                "unseen_only": { "type": "boolean", "description": "Only unread messages" }
            }
        });
        offered(&descriptor("email.list_messages", "List email messages", schema), "email", &NO_PERMISSIONS, false)
            .unwrap()
    }

    #[test]
    fn an_operation_keeps_its_simple_fields_required_first_without_the_apps_own() {
        let operation = send_email_operation();
        assert_eq!(operation.kind, "email.send_email");
        assert!(operation.sends);
        assert!(!operation.installed);
        let fields: Vec<(&str, bool)> =
            operation.fields.iter().map(|field| (field.name.as_str(), field.required)).collect();
        assert_eq!(fields, [("to", true), ("subject", true), ("text", false), ("cc", false)]);
        assert_eq!(operation.fields[0].description, "Recipients, separated by commas");
    }

    #[test]
    fn catalog_plugins_that_need_an_account_or_a_browser_need_setting_up() {
        let operations = operations_of(&[], Some(&crate::plugins::tests::not_installed_catalog()));
        let setup_of = |plugin: &str| {
            operations
                .iter()
                .filter(|operation| operation.plugin == plugin)
                .map(|operation| operation.needs_setup)
                .collect::<Vec<_>>()
        };
        let mail = setup_of("fixture-mail");
        let browser = setup_of("fixture-browser");
        assert!(!mail.is_empty() && mail.iter().all(|needs| *needs), "secrets: {mail:?}");
        assert!(!browser.is_empty() && browser.iter().all(|needs| *needs), "a browser: {browser:?}");
    }

    #[test]
    fn fields_named_like_a_plugin_setting_are_the_apps() {
        let schema = json!({"type": "object", "properties": {"phone_number_id": {"type": "string"}, "body": {"type": "string"}}});
        let permissions = super::super::models::PluginPermissions {
            network: true,
            secrets: true,
            env: vec!["WHATSAPP_PHONE_NUMBER_ID".to_owned()],
        };
        let operation =
            offered(&descriptor("whatsapp.send_text", "Send text", schema), "whatsapp", &permissions, true).unwrap();
        assert!(operation.needs_setup);
        assert_eq!(operation.fields.iter().map(|field| field.name.as_str()).collect::<Vec<_>>(), ["body"]);
    }

    #[test]
    fn operations_a_plan_cannot_fill_in_are_not_offered() {
        let needs_a_list = json!({"type": "object", "properties": {"uids": {"type": "array"}}, "required": ["uids"]});
        assert!(offered(&descriptor("email.mark_seen", "Mark seen", needs_a_list), "email", &NO_PERMISSIONS, true)
            .is_none());
        let undescribed = json!({"type": "object", "properties": {}, "required": ["id"]});
        assert!(
            offered(&descriptor("crm.get_contact", "Get contact", undescribed), "crm", &NO_PERMISSIONS, true).is_none()
        );
        let raw_call = json!({"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]});
        assert!(offered(&descriptor("slack.api_request", "API request", raw_call), "slack", &NO_PERMISSIONS, true)
            .is_none());
        assert!(offered(&descriptor("not-a-plugin-kind", "Odd", json!({})), "odd", &NO_PERMISSIONS, true).is_none());
    }

    #[test]
    fn reading_operations_do_not_count_as_sending() {
        let operation = list_messages_operation();
        assert!(!operation.sends);
        let types: Vec<FieldType> = operation.fields.iter().map(|field| field.field_type).collect();
        assert_eq!(types, [FieldType::Integer, FieldType::Boolean]);
    }
}
