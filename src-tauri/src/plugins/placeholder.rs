//! Placeholder node kinds for catalog plugins that are not installed.
//!
//! The agent builder may draft steps from any catalog plugin; the user is asked
//! to install it afterwards. To validate such drafts, `flow::draft_node_registry`
//! adds these placeholders next to the real node kinds. A placeholder checks the
//! step's config against the catalog's `config_schema` (when published) and
//! reports the references it reads, but it can never run: runs compile with
//! `flow::node_registry`, which has no placeholders, and `start_run` refuses an
//! agent whose plugins are missing before anything is recorded.

use std::sync::Arc;

use futures::future::BoxFuture;
use graphrt_core::catalog::{NodeCategory, NodeDescriptor, OutputDescriptor};
use graphrt_core::dsl::NodeDoc;
use graphrt_core::node::{ConfigError, NodeResult};
use graphrt_core::{Node, NodeContext, NodeError, Selector, ValueType};
use serde_json::{Map, Value as Json};

use super::models::{CatalogIndex, CatalogNode};

/// Error kind a placeholder reports if it is ever run.
const NOT_INSTALLED_ERROR: &str = "plugin_not_installed";

/// The graphrt descriptor of a catalog node (`{}` schema when none is published).
pub(crate) fn catalog_descriptor(node: &CatalogNode, plugin: &str) -> NodeDescriptor {
    let mut descriptor = NodeDescriptor::new(node.kind.clone(), node.title.clone(), NodeCategory::Other);
    descriptor.description = node.description.clone();
    if let Some(schema) = node.config_schema.as_ref().filter(|schema| schema.is_object()) {
        descriptor.config_schema = schema.clone();
    }
    descriptor.outputs =
        node.output_names().into_iter().map(|name| OutputDescriptor::new(name, ValueType::Any)).collect();
    descriptor.source = format!("plugin:{plugin}");
    descriptor
}

/// Registers a placeholder for every catalog node kind `registry` does not know yet
/// (installed plugins keep their real kinds).
pub(crate) fn register_placeholders(registry: &mut graphrt_core::Registry, catalog: &CatalogIndex) {
    for plugin in &catalog.plugins {
        for node in &plugin.nodes {
            if registry.contains(&node.kind) {
                continue;
            }
            let descriptor = catalog_descriptor(node, &plugin.name);
            let schema = descriptor.config_schema.clone();
            let plugin_name = plugin.name.clone();
            registry.register_described(descriptor, move |doc: &NodeDoc| build_placeholder(doc, &schema, &plugin_name));
        }
    }
}

fn build_placeholder(doc: &NodeDoc, schema: &Json, plugin: &str) -> Result<Arc<dyn Node>, ConfigError> {
    check_config(schema, &doc.config).map_err(|message| ConfigError::new(doc, message))?;
    Ok(Arc::new(PlaceholderNode {
        plugin: plugin.to_owned(),
        selectors: graphrt_plugin::collect_selectors(&doc.config),
    }))
}

/// A catalog plugin step that is validated but never runs.
#[derive(Debug)]
struct PlaceholderNode {
    plugin: String,
    selectors: Vec<Selector>,
}

impl Node for PlaceholderNode {
    fn inputs(&self) -> Vec<Selector> {
        self.selectors.clone()
    }

    fn run(&self, _ctx: NodeContext) -> BoxFuture<'_, NodeResult> {
        Box::pin(async move {
            Err(NodeError::fatal(NOT_INSTALLED_ERROR, format!("the plugin `{}` is not installed", self.plugin)))
        })
    }
}

/// Checks a step's config against the parts of a JSON Schema the builder's
/// drafts get wrong: required fields, unknown fields (`additionalProperties:
/// false`), literal value types and `enum` choices. Values written as
/// `{{#...#}}` references are only known at run time and are not type-checked.
///
/// # Errors
/// A message naming the first problem, meant for the model to fix.
pub(crate) fn check_config(schema: &Json, config: &Map<String, Json>) -> Result<(), String> {
    let properties = schema.get("properties").and_then(Json::as_object);
    for field in schema.get("required").and_then(Json::as_array).into_iter().flatten().filter_map(Json::as_str) {
        if config.get(field).is_none_or(Json::is_null) {
            return Err(format!("missing required config field `{field}`"));
        }
    }
    let closed = schema.get("additionalProperties") == Some(&Json::Bool(false));
    for (field, value) in config {
        let Some(property) = properties.and_then(|properties| properties.get(field)) else {
            if closed {
                return Err(format!("unknown config field `{field}`"));
            }
            continue;
        };
        if is_reference(value) || value.is_null() {
            continue;
        }
        check_value(field, property, value)?;
    }
    Ok(())
}

fn check_value(field: &str, property: &Json, value: &Json) -> Result<(), String> {
    let allowed_types: Vec<&str> = match property.get("type") {
        Some(Json::String(type_name)) => vec![type_name.as_str()],
        Some(Json::Array(type_names)) => type_names.iter().filter_map(Json::as_str).collect(),
        _ => Vec::new(),
    };
    if !allowed_types.is_empty() && !allowed_types.iter().any(|type_name| matches_type(type_name, value)) {
        return Err(format!("config field `{field}` must be of type {}", allowed_types.join(" or ")));
    }
    if let Some(choices) = property.get("enum").and_then(Json::as_array) {
        if !choices.contains(value) {
            let listed: Vec<String> = choices.iter().map(Json::to_string).collect();
            return Err(format!("config field `{field}` must be one of {}", listed.join(", ")));
        }
    }
    Ok(())
}

fn matches_type(type_name: &str, value: &Json) -> bool {
    match type_name {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        _ => true,
    }
}

/// A string holding a `{{#...#}}` reference (its value is only known at run time).
fn is_reference(value: &Json) -> bool {
    value.as_str().is_some_and(|text| text.contains("{{"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Json {
        serde_json::json!({
            "type": "object",
            "properties": {
                "to": { "type": "string" },
                "count": { "type": "integer" },
                "mode": { "type": "string", "enum": ["fast", "slow"] }
            },
            "required": ["to"],
            "additionalProperties": false
        })
    }

    fn config(value: Json) -> Map<String, Json> {
        value.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn required_fields_types_enums_and_unknown_fields_are_checked() {
        assert!(check_config(&schema(), &config(serde_json::json!({ "to": "a", "count": 2, "mode": "fast" }))).is_ok());
        let missing = check_config(&schema(), &config(serde_json::json!({ "count": 2 }))).unwrap_err();
        assert!(missing.contains("`to`"), "{missing}");
        assert!(check_config(&schema(), &config(serde_json::json!({ "to": "a", "count": "two" }))).is_err());
        assert!(check_config(&schema(), &config(serde_json::json!({ "to": "a", "mode": "medium" }))).is_err());
        assert!(check_config(&schema(), &config(serde_json::json!({ "to": "a", "extra": 1 }))).is_err());
    }

    #[test]
    fn references_and_open_schemas_are_accepted() {
        let with_reference = config(serde_json::json!({ "to": "{{#start.phone#}}", "count": "{{#start.count#}}" }));
        assert!(check_config(&schema(), &with_reference).is_ok());
        let open = serde_json::json!({ "properties": { "to": { "type": "string" } } });
        assert!(check_config(&open, &config(serde_json::json!({ "anything": true }))).is_ok());
        assert!(check_config(&serde_json::json!({}), &Map::new()).is_ok());
    }
}
