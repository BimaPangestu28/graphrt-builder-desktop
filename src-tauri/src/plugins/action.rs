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

/// How an action ended: the action node's outputs, plus the error kind the node failed
/// with (e.g. `auth_error`) so callers can tell why it failed. A failed node makes
/// `result` an [`AppError::PluginStepFailed`] with that kind and the plugin's message.
pub(super) struct ActionOutcome {
    pub result: AppResult<serde_json::Map<String, serde_json::Value>>,
    pub failure_type: Option<String>,
}

/// Compiles and runs the action document with the snapshot's plugins.
///
/// `result` is `Workflow` when graphrt rejects the settings, `PluginStepFailed` when
/// the plugin's step fails, `Internal` when the run fails otherwise or takes longer
/// than [`ACTION_TIMEOUT`].
pub(super) async fn run_action(
    snapshot: &PluginSnapshot,
    base_registry: graphrt_core::Registry,
    document: &str,
) -> ActionOutcome {
    let mut failure_type = None;
    let result = run_action_graph(snapshot, base_registry, document, &mut failure_type).await;
    ActionOutcome { result, failure_type }
}

async fn run_action_graph(
    snapshot: &PluginSnapshot,
    base_registry: graphrt_core::Registry,
    document: &str,
    failure_type: &mut Option<String>,
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
        let mut step_failure: Option<(String, String)> = None;
        while let Some(event) = stream.next().await {
            match event {
                Event::NodeSucceeded { node_id, outputs: node_outputs, .. } if &*node_id == ACTION_NODE_ID => {
                    outputs = Some(node_outputs);
                }
                Event::NodeFailed { node_id, error, error_type, .. } if &*node_id == ACTION_NODE_ID => {
                    *failure_type = Some(error_type.clone());
                    step_failure = Some((error_type, error));
                }
                Event::RunSucceeded { .. } => break,
                Event::RunFailed { error, .. } => return Err(run_failure(step_failure, error)),
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

/// The error of a failed action run: the plugin step's own kind and message when the
/// step failed, else graphrt's run error.
fn run_failure(step_failure: Option<(String, String)>, run_error: String) -> AppError {
    match step_failure {
        Some((kind, message)) if !kind.is_empty() => AppError::PluginStepFailed { kind, message },
        _ => AppError::Internal(run_error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_step_reports_the_plugins_kind_and_message() {
        let error = run_failure(
            Some(("invalid_input".into(), "`amount` must be a number".into())),
            "node action failed: `amount` must be a number".into(),
        );

        assert!(
            matches!(&error, AppError::PluginStepFailed { kind, message } if kind == "invalid_input" && message == "`amount` must be a number"),
            "{error:?}"
        );
    }

    #[test]
    fn a_run_error_without_a_failed_step_stays_internal() {
        let error = run_failure(None, "the run stopped".into());
        assert!(matches!(&error, AppError::Internal(message) if message == "the run stopped"), "{error:?}");

        let without_kind = run_failure(Some((String::new(), "boom".into())), "the run stopped".into());
        assert!(matches!(without_kind, AppError::Internal(_)));
    }
}
