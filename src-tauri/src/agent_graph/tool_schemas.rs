//! Input schemas of the tools a "Use a tool" or "Run an agent" step can call, so the
//! inspector shows a tool's inputs as a form instead of names typed by hand.
//!
//! - Plugin tools: the JSON Schema their manifest declares (`tools[].parameters`).
//! - MCP server tools: the `inputSchema` the server reported on its last successful
//!   "Test connection" (`tools/list`), cached with the server definition.
//!
//! A tool without a usable schema (a server checked before schemas were kept, a
//! schema that is not an object) has `input_schema: None`; the inspector then falls
//! back to typed input names. Agents used as tools are not listed here: their inputs
//! come from `list_agent_steps`.

use graphrt_core::tool::ToolSpec;
use serde::Serialize;
use serde_json::Value;

use crate::mcp::McpServerDefinition;

/// Where a tool comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolSchemaSource {
    Plugin,
    Mcp,
}

/// One tool and the JSON Schema of its arguments.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInputSchema {
    /// `provider_id` in a workflow: the plugin or MCP server name.
    pub provider: String,
    pub name: String,
    pub description: String,
    pub source: ToolSchemaSource,
    /// JSON Schema of the arguments object; `None` when unknown.
    pub input_schema: Option<Value>,
}

/// Every plugin and MCP server tool with its input schema, plugins first, each sorted by
/// provider then tool name. `plugin_tools` are the manifest specs by plugin name
/// (`PluginService::tool_specs`); `mcp_servers` the saved servers with their last known tools.
pub fn collect_tool_input_schemas(
    plugin_tools: &[(String, Vec<ToolSpec>)],
    mcp_servers: &[McpServerDefinition],
) -> Vec<ToolInputSchema> {
    let mut plugin_schemas: Vec<ToolInputSchema> = plugin_tools
        .iter()
        .flat_map(|(plugin_name, specs)| {
            specs.iter().map(move |spec| ToolInputSchema {
                provider: plugin_name.clone(),
                name: spec.name.clone(),
                description: spec.description.clone(),
                source: ToolSchemaSource::Plugin,
                input_schema: usable_schema(Some(&spec.parameters)),
            })
        })
        .collect();
    let mut mcp_schemas: Vec<ToolInputSchema> = mcp_servers
        .iter()
        .flat_map(|server| {
            server.known_tools.iter().map(move |tool| ToolInputSchema {
                provider: server.name.clone(),
                name: tool.name.clone(),
                description: tool.description.clone(),
                source: ToolSchemaSource::Mcp,
                input_schema: usable_schema(tool.input_schema.as_ref()),
            })
        })
        .collect();
    let by_reference = |left: &ToolInputSchema, right: &ToolInputSchema| {
        (left.provider.as_str(), left.name.as_str()).cmp(&(right.provider.as_str(), right.name.as_str()))
    };
    plugin_schemas.sort_by(by_reference);
    mcp_schemas.sort_by(by_reference);
    plugin_schemas.extend(mcp_schemas);
    plugin_schemas
}

/// A schema the inspector can render: a JSON object (`{}` means "takes no arguments").
fn usable_schema(schema: Option<&Value>) -> Option<Value> {
    schema.filter(|schema| schema.is_object()).cloned()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::mcp::{McpServerTransport, McpToolInfo};

    fn server(name: &str, tools: Vec<McpToolInfo>) -> McpServerDefinition {
        McpServerDefinition {
            name: name.into(),
            transport: McpServerTransport::Http { url: "https://mcp.example.com".into() },
            secret_env: Vec::new(),
            bearer_token_secret: None,
            auth: Default::default(),
            plugin: None,
            guide: None,
            approval: Default::default(),
            known_tools: tools,
            last_check: None,
        }
    }

    fn spec(name: &str, parameters: Value) -> ToolSpec {
        ToolSpec { name: name.into(), description: format!("{name} tool"), parameters }
    }

    #[test]
    fn plugin_tools_carry_their_manifest_schema_and_come_first() {
        let address_schema =
            json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] });
        let plugins = vec![("google-maps".to_owned(), vec![spec("search_places", address_schema.clone())])];
        let servers = vec![server(
            "files",
            vec![McpToolInfo {
                name: "read_file".into(),
                description: "Read a file".into(),
                input_schema: Some(json!({ "type": "object", "properties": { "path": { "type": "string" } } })),
            }],
        )];

        let schemas = collect_tool_input_schemas(&plugins, &servers);

        assert_eq!(schemas.len(), 2);
        assert_eq!((schemas[0].provider.as_str(), schemas[0].name.as_str()), ("google-maps", "search_places"));
        assert_eq!(schemas[0].source, ToolSchemaSource::Plugin);
        assert_eq!(schemas[0].input_schema.as_ref(), Some(&address_schema));
        assert_eq!(schemas[1].source, ToolSchemaSource::Mcp);
        assert_eq!(schemas[1].input_schema.as_ref().unwrap()["properties"]["path"]["type"], "string");
    }

    #[test]
    fn tools_without_a_usable_schema_are_listed_without_one() {
        let plugins = vec![("odd".to_owned(), vec![spec("broken", json!("not a schema"))])];
        let servers = vec![server(
            "old-check",
            vec![McpToolInfo { name: "echo".into(), description: String::new(), input_schema: None }],
        )];

        let schemas = collect_tool_input_schemas(&plugins, &servers);

        assert!(schemas.iter().all(|schema| schema.input_schema.is_none()));
        assert_eq!(schemas.len(), 2);
    }

    #[test]
    fn cached_mcp_schemas_survive_a_saved_definition_round_trip() {
        let tool = McpToolInfo {
            name: "read_file".into(),
            description: "Read a file".into(),
            input_schema: Some(json!({ "type": "object" })),
        };
        let saved = serde_json::to_string(&server("files", vec![tool.clone()])).unwrap();
        let older: McpToolInfo = serde_json::from_value(json!({ "name": "echo", "description": "" })).unwrap();

        let restored: McpServerDefinition = serde_json::from_str(&saved).unwrap();

        assert_eq!(restored.known_tools, vec![tool]);
        assert_eq!(older.input_schema, None, "definitions saved before schemas were kept still load");
    }
}
