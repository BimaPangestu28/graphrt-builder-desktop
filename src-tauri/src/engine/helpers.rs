//! Helper agents: the other agents an `agent` step may ask for help (graphrt `subagents`).
//!
//! graphrt runs a helper as a child run of the same run, so its events reach the same
//! stream under its own frame (`<step>.<agent id>[<n>]`), an approval inside it pauses the
//! whole run, and it shares the run's step, token and cost budget. The host has to link
//! every workflow a run may start: [`link_helper_agents`] links the agents the document
//! lists, and the ones those list in turn, each with its own services (its own tools, files,
//! memory and trusted hosts), under its agent id.
//!
//! The linked workflows are part of the run's fingerprint: a paused run whose helper was
//! edited meanwhile is refused on resume (graphrt says the workflow changed).

use std::collections::VecDeque;

use graphrt_core::engine::LinkedWorkflow;
use graphrt_core::{Engine, IndexMap};

use super::agent_tools::{agent_tool_registry, EngineDependencies};
use super::preparation::{self, RunScope};
use crate::agent_files::{FileAccess, FileScope};
use crate::agent_graph::abilities::listed_helpers;
use crate::error::{AppError, AppResult};

/// Most agents linked to one run, helpers of helpers included.
pub const MAX_LINKED_AGENTS: usize = 32;

/// `engine` with the helper agents of `flow_yaml` (and theirs) linked. A flow that lists
/// none is returned as it is.
///
/// # Errors
/// - `NotFound` naming a helper agent that no longer exists.
/// - `InvalidInput` when more than [`MAX_LINKED_AGENTS`] agents would be linked, or a
///   helper cannot be started by another agent (graphrt's check of its start inputs).
/// - Whatever building a helper's engine reports (missing keys, plugins, a broken flow).
pub(crate) fn link_helper_agents(
    engine: Engine,
    flow_yaml: &str,
    dependencies: &EngineDependencies,
) -> AppResult<Engine> {
    let mut queue: VecDeque<String> = listed_helpers(flow_yaml)?.into();
    if queue.is_empty() {
        return Ok(engine);
    }
    let mut linked: IndexMap<String, LinkedWorkflow> = IndexMap::new();
    while let Some(helper_id) = queue.pop_front() {
        if linked.contains_key(&helper_id) {
            continue;
        }
        if linked.len() >= MAX_LINKED_AGENTS {
            return Err(AppError::InvalidInput(format!(
                "this agent's helpers ask too many other agents (more than {MAX_LINKED_AGENTS})"
            )));
        }
        let helper = dependencies.db.get_agent(&helper_id).map_err(|error| match error {
            AppError::NotFound(_) => {
                AppError::NotFound(format!("a helper agent ({helper_id}): it was deleted, choose its helpers again"))
            }
            other => other,
        })?;
        if helper.status == crate::storage::models::AgentStatus::Paused {
            return Err(AppError::InvalidInput(format!(
                "{} is paused, so it cannot help other agents: resume it, or take it off the helpers",
                helper.name
            )));
        }
        // Tests and checks: the helper's memory only reads, as the agent's own does.
        let helper_flow = match dependencies.read_only_memory {
            true => crate::agent_graph::abilities::without_memory_writes(&helper.flow_yaml)?,
            false => helper.flow_yaml.clone(),
        };
        let trusted_hosts = dependencies.db.trusted_lookup_hosts(&helper.id)?;
        let files =
            dependencies.agent_files.clone().map(|files| FileAccess { files, scope: FileScope::agent(&helper.id) });
        let scope = RunScope { agent_id: Some(&helper.id), trusted_hosts: &trusted_hosts, files: files.as_ref() };
        let tools = agent_tool_registry(dependencies, vec![helper.id.clone()]);
        let (helper_engine, env) = preparation::prepare_engine_and_env(
            &helper_flow,
            &scope,
            &dependencies.credentials,
            &dependencies.db,
            &*dependencies.model_source,
            tools,
        )
        .map_err(|error| describe_helper_error(&helper.name, error))?;
        let link = LinkedWorkflow::new(helper_engine.graph().clone())
            .with_env(env)
            .with_services(helper_engine.services().clone());
        link.check().map_err(|why| {
            AppError::InvalidInput(format!("{} cannot be asked for help by another agent: {why}", helper.name))
        })?;
        queue.extend(listed_helpers(&helper.flow_yaml)?);
        linked.insert(helper.id.clone(), link);
    }
    Ok(engine.with_linked(linked))
}

/// Says which helper a setup problem belongs to (keeps the error kind, so the UI still offers
/// the right fix, such as connecting a model).
fn describe_helper_error(helper_name: &str, error: AppError) -> AppError {
    match error {
        AppError::InvalidInput(message) => AppError::InvalidInput(format!("helper {helper_name}: {message}")),
        AppError::Workflow(message) => AppError::Workflow(format!("helper {helper_name}: {message}")),
        other => other,
    }
}
