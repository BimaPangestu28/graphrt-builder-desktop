//! The `agents` graphrt tool provider: every stored agent is a tool.
//!
//! graphrt has no sub-workflow node, so the host provides "agent calls agent"
//! through graphrt's tool contract ([`ToolRuntime`]). A `tool` node with
//! `provider_id: agents, tool_name: <agent id>` (or an `agent` node listing
//! `agents/<id>` in its `tools`) runs that agent's CURRENT version to completion
//! as a nested graphrt run and gets its run outputs back (`text` and `json`).
//!
//! Nested runs are not recorded as top-level runs: the caller's run already
//! records the call (its `tool` node outputs, or the `agent` node's
//! `tool_call` / `tool_result` events), the Runs screen stays a list of things
//! the user started, and the run driver does not have to know about nesting.
//! Dropping the caller (abort, node timeout) drops the nested run with it,
//! because graphrt runs are polled by their stream and never spawned.
//!
//! Guards:
//! - Recursion: each runtime carries the chain of agents above it. Calling an
//!   agent already in that chain (itself, or a cycle A → B → A) fails, and so
//!   does going deeper than [`MAX_AGENT_CALL_DEPTH`] nested calls.
//! - Time: a nested run gets at most [`NESTED_RUN_TIMEOUT`].
//! - Approval: a nested run that pauses (human input / tool approval) is
//!   stopped and the call fails with [`APPROVAL_NOT_SUPPORTED_MESSAGE`]; the
//!   paused state would have nowhere to be resumed from.
//! - A paused agent (status `paused`, e.g. a paused team member) refuses calls.

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use futures::future::BoxFuture;
use futures::StreamExt;
use graphrt_core::tool::{ToolError, ToolOutput, ToolRegistry, ToolRuntime, ToolSpec};
use graphrt_core::{Event, IndexMap, RunInput, RunStream, Value};

use super::{preparation, ModelRegistrySource};
use crate::agent_steps::{self, AGENT_TOOL_PROVIDER, APPROVAL_NOT_SUPPORTED_MESSAGE};
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::storage::models::{Agent, AgentStatus};
use crate::storage::Database;

/// Most nested agent calls below a top-level run (A → B → C → D is depth 3).
pub const MAX_AGENT_CALL_DEPTH: usize = 3;
/// Longest a nested agent run may take.
pub const NESTED_RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// What building an engine needs; shared by top-level and nested runs.
#[derive(Debug, Clone)]
pub(crate) struct EngineDependencies {
    pub(crate) db: Arc<Database>,
    pub(crate) credentials: Arc<CredentialStore>,
    pub(crate) model_source: Arc<dyn ModelRegistrySource>,
}

/// The tool registry for a run of `agent_ids_above.last()`: holds the `agents`
/// provider, which knows the agents above it so it can refuse recursion.
pub(crate) fn agent_tool_registry(dependencies: &EngineDependencies, agent_ids_above: Vec<String>) -> ToolRegistry {
    let runtime = AgentToolRuntime { dependencies: dependencies.clone(), agent_ids_above, timeout: NESTED_RUN_TIMEOUT };
    let mut registry = ToolRegistry::new();
    registry.add(AGENT_TOOL_PROVIDER, Arc::new(runtime));
    // Installed plugins' tools (provider = plugin name), next to the `agents` provider.
    crate::plugins::add_plugin_tools(&mut registry);
    // MCP servers from Connections > Advanced (connected only when a node uses them).
    crate::mcp::add_mcp_tools(&mut registry, &dependencies.credentials);
    registry
}

/// Calls stored agents as tools. One instance per (nested) run.
#[derive(Debug)]
struct AgentToolRuntime {
    dependencies: EngineDependencies,
    /// Agents whose runs are waiting on this one, top-level first; the last is the caller.
    agent_ids_above: Vec<String>,
    timeout: Duration,
}

/// Why a call cannot start; becomes an error result the caller's model can read.
fn recursion_error(agent_ids_above: &[String], agent: &Agent) -> Option<String> {
    if agent_ids_above.iter().any(|agent_id| agent_id == &agent.id) {
        return Some(format!(
            "{} is already running in this chain of agent calls; an agent cannot call itself, directly or through other agents",
            agent.name
        ));
    }
    // The top-level run is not a nested call, so the depth is the number of agents above minus one.
    if agent_ids_above.len() > MAX_AGENT_CALL_DEPTH {
        return Some(format!("agents can call other agents at most {MAX_AGENT_CALL_DEPTH} levels deep"));
    }
    None
}

impl AgentToolRuntime {
    fn list_specs(&self) -> Result<Vec<ToolSpec>, ToolError> {
        let agents = self
            .dependencies
            .db
            .list_agents()
            .map_err(|error| ToolError { tool: "*".into(), message: error.to_string() })?;
        Ok(agents
            .iter()
            .filter(|agent| !self.agent_ids_above.contains(&agent.id))
            .filter_map(|agent| {
                let signature = agent_steps::read_signature(&agent.flow_yaml).ok()?;
                let outputs =
                    if signature.outputs.is_empty() { "nothing".into() } else { signature.outputs.join(", ") };
                Some(ToolSpec {
                    name: agent.id.clone(),
                    description: format!(
                        "Runs the agent \"{}\": {} Gives back: {outputs}.",
                        agent.name,
                        agent.description.trim()
                    ),
                    parameters: agent_steps::tool_parameters_schema(&signature),
                })
            })
            .collect())
    }

    async fn call_agent(&self, agent_id: &str, arguments: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let agent = self
            .dependencies
            .db
            .get_agent(agent_id)
            .map_err(|error| ToolError { tool: agent_id.to_owned(), message: error.to_string() })?;
        if let Some(message) = recursion_error(&self.agent_ids_above, &agent) {
            return Ok(ToolOutput::error(message));
        }
        if agent.status == AgentStatus::Paused {
            return Ok(ToolOutput::error(format!("{} is paused", agent.name)));
        }
        let stream = match self.start_nested_run(&agent, arguments) {
            Ok(stream) => stream,
            Err(error) => return Ok(ToolOutput::error(format!("could not start {}: {error}", agent.name))),
        };
        let handle = stream.handle();
        match tokio::time::timeout(self.timeout, wait_for_outcome(stream)).await {
            Ok(outcome) => Ok(outcome.into_tool_output(&agent.name)),
            Err(_) => {
                handle.abort("took too long as a step");
                let minutes = self.timeout.as_secs() / 60;
                Ok(ToolOutput::error(format!("{} took longer than {minutes} minutes and was stopped", agent.name)))
            }
        }
    }

    fn start_nested_run(&self, agent: &Agent, arguments: serde_json::Value) -> AppResult<RunStream> {
        let mut agent_ids_below = self.agent_ids_above.clone();
        agent_ids_below.push(agent.id.clone());
        let engine = preparation::build_engine(
            &agent.flow_yaml,
            &self.dependencies.credentials,
            &self.dependencies.db,
            &*self.dependencies.model_source,
            agent_tool_registry(&self.dependencies, agent_ids_below),
        )?;
        let mut run_input = RunInput::new();
        run_input.inputs = preparation::json_object_to_value_map(arguments, "step inputs")?;
        run_input.env = preparation::workflow_env(&agent.flow_yaml, &self.dependencies.credentials)?;
        Ok(engine.run(run_input))
    }
}

impl ToolRuntime for AgentToolRuntime {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ToolSpec>, ToolError>> {
        Box::pin(async move { self.list_specs() })
    }

    fn call<'a>(&'a self, name: &'a str, arguments: serde_json::Value) -> BoxFuture<'a, Result<ToolOutput, ToolError>> {
        Box::pin(self.call_agent(name, arguments))
    }
}

/// How a nested run ended.
#[derive(Debug)]
enum NestedOutcome {
    Succeeded(IndexMap<String, Value>),
    Failed(String),
    Aborted(String),
    Paused,
    Vanished,
}

/// Consumes the nested run until its terminal event. A pause ends it: the
/// stream is dropped, which stops the nested run.
async fn wait_for_outcome(mut stream: RunStream) -> NestedOutcome {
    while let Some(event) = stream.next().await {
        match event {
            Event::RunSucceeded { outputs, .. } => return NestedOutcome::Succeeded(outputs),
            Event::RunFailed { error, .. } => return NestedOutcome::Failed(error),
            Event::RunAborted { reason, .. } => return NestedOutcome::Aborted(reason),
            Event::RunPaused { .. } => return NestedOutcome::Paused,
            _ => {}
        }
    }
    NestedOutcome::Vanished
}

impl NestedOutcome {
    fn into_tool_output(self, agent_name: &str) -> ToolOutput {
        match self {
            NestedOutcome::Succeeded(outputs) => success_output(outputs),
            NestedOutcome::Failed(error) => ToolOutput::error(format!("{agent_name} failed: {error}")),
            NestedOutcome::Aborted(reason) => ToolOutput::error(format!("{agent_name} was stopped: {reason}")),
            NestedOutcome::Paused => ToolOutput::error(format!(
                "{agent_name} stopped to ask you something, but {APPROVAL_NOT_SUPPORTED_MESSAGE}"
            )),
            NestedOutcome::Vanished => ToolOutput::error(format!("{agent_name} stopped without reporting a result")),
        }
    }
}

/// Outputs as the tool result: `data` is the outputs object; `text` is the single
/// text output when there is exactly one, otherwise the outputs as JSON.
fn success_output(outputs: IndexMap<String, Value>) -> ToolOutput {
    let text = match outputs.values().next() {
        Some(Value::String(only_text)) if outputs.len() == 1 => only_text.to_string(),
        _ => serde_json::to_string(&outputs).unwrap_or_default(),
    };
    ToolOutput { text, data: Value::from(outputs), is_error: false }
}
