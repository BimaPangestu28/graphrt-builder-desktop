//! One-off plugin actions run from the UI (log in to WhatsApp Web, check an
//! API connection): one plugin node in a two-step workflow, run on graphrt.

use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use graphrt_core::engine::Limits;
use graphrt_core::{Engine, Event, RunInput, Services};

use super::host::PluginSnapshot;
use crate::error::{AppError, AppResult};

/// Id of the action node in the generated workflow.
const ACTION_NODE_ID: &str = "action";
/// Longest an action may take (a QR login waits up to 4 minutes for the scan).
pub(super) const ACTION_TIMEOUT: Duration = Duration::from_secs(6 * 60);
/// Node fields the caller may not set (they shape the generated workflow).
const RESERVED_FIELDS: &[&str] = &["id", "type", "parent", "policy", "error_strategy"];

/// Checks the request and returns the node kind's workflow document.
///
/// # Errors
/// `NotFound` for an unknown plugin; `InvalidInput` when the plugin did not
/// load, is not trusted, does not declare `kind`, or `config` is not an object
/// or sets a reserved field.
pub(super) fn action_document(
    snapshot: &PluginSnapshot,
    plugin_name: &str,
    kind: &str,
    config: serde_json::Value,
) -> AppResult<String> {
    let plugin = snapshot.plugin(plugin_name).ok_or_else(|| AppError::NotFound(format!("plugin {plugin_name}")))?;
    if let Some(error) = &plugin.load_error {
        return Err(AppError::InvalidInput(format!("plugin {plugin_name} is not loaded: {error}")));
    }
    if !plugin.trusted {
        return Err(AppError::InvalidInput(format!("trust {plugin_name} before running its actions")));
    }
    if !plugin.declares_kind(kind) {
        return Err(AppError::InvalidInput(format!("{plugin_name} has no step `{kind}`")));
    }
    let mut node = match config {
        serde_json::Value::Null => serde_json::Map::new(),
        serde_json::Value::Object(fields) => fields,
        _ => return Err(AppError::InvalidInput("the action settings must be an object".into())),
    };
    if let Some(field) = RESERVED_FIELDS.iter().find(|field| node.contains_key(**field)) {
        return Err(AppError::InvalidInput(format!("`{field}` cannot be set for an action")));
    }
    node.insert("id".into(), ACTION_NODE_ID.into());
    node.insert("type".into(), kind.into());
    let document = serde_json::json!({
        "version": "1",
        "name": "plugin-action",
        "graph": {
            "nodes": [{ "id": "start", "type": "start" }, serde_json::Value::Object(node)],
            "edges": [{ "source": "start", "target": ACTION_NODE_ID }],
        },
    });
    Ok(serde_json::to_string(&document)?)
}

/// Compiles and runs the action document with the snapshot's plugins and
/// returns the action node's outputs.
///
/// # Errors
/// `Workflow` when graphrt rejects the settings, `Internal` when the step fails
/// or takes longer than [`ACTION_TIMEOUT`].
pub(super) async fn run_action(
    snapshot: &PluginSnapshot,
    base_registry: graphrt_core::Registry,
    document: &str,
) -> AppResult<serde_json::Map<String, serde_json::Value>> {
    let mut registry = base_registry;
    snapshot.register_nodes(&mut registry);
    let graph =
        graphrt_core::Graph::from_text(document, &registry).map_err(|error| AppError::Workflow(error.to_string()))?;
    let mut tools = graphrt_core::tool::ToolRegistry::new();
    snapshot.add_tools(&mut tools);
    let limits = Limits {
        max_duration_ms: u64::try_from(ACTION_TIMEOUT.as_millis()).ok(),
        default_node_timeout_ms: u64::try_from(ACTION_TIMEOUT.as_millis()).ok(),
        ..Limits::default()
    };
    let engine = Engine::new(Arc::new(graph)).with_services(Services::new().with(tools)).with_limits(limits);
    let mut stream = engine.run(RunInput::new());
    let outcome = tokio::time::timeout(ACTION_TIMEOUT, async move {
        let mut outputs = None;
        while let Some(event) = stream.next().await {
            match event {
                Event::NodeSucceeded { node_id, outputs: node_outputs, .. } if node_id == ACTION_NODE_ID => {
                    outputs = Some(node_outputs);
                }
                Event::RunSucceeded { .. } => break,
                Event::RunFailed { error, .. } => return Err(AppError::Internal(error)),
                Event::RunAborted { reason, .. } => return Err(AppError::Internal(reason)),
                Event::RunPaused { .. } => {
                    return Err(AppError::Internal("the action stopped to ask for input".into()));
                }
                _ => {}
            }
        }
        outputs.ok_or_else(|| AppError::Internal("the action ended without a result".into()))
    })
    .await
    .map_err(|_| AppError::Internal("the action took too long and was stopped".into()))??;
    let json = serde_json::to_value(&outcome)?;
    match json {
        serde_json::Value::Object(fields) => Ok(fields),
        _ => Ok(serde_json::Map::new()),
    }
}
