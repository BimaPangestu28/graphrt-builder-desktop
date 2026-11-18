//! Agents used by other agents: "agent as a step" (screen 12) and teams (screen 13).
//!
//! graphrt has no sub-workflow node, so the app provides one: every stored agent
//! is a tool of the `agents` tool provider (`engine::agent_tools`), with
//! `tool_name` = agent id, the agent's start inputs as parameters and its run
//! outputs as the result. An agent then calls another agent with a normal graphrt
//! `tool` node, and a team is an `agent` node whose tools are its member agents.
//!
//! This module holds what the screens need around that: each agent's signature
//! (`signature`), which agents a flow calls (`references`), the step catalog,
//! the team overview and the builder instructions that add a step or a member.

mod instructions;
pub mod references;
pub mod signature;

use serde::{Deserialize, Serialize};

pub use self::instructions::{add_step_instruction, add_team_member_instruction};
pub use self::signature::{read_signature, tool_parameters_schema, AgentInput, AgentSignature, InputValueType};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::{Agent, AgentKind, AgentStatus, Run, RunFilter};
use crate::storage::Database;

/// graphrt tool provider id under which every stored agent is a tool.
pub const AGENT_TOOL_PROVIDER: &str = "agents";

/// Shown when a called agent stops to ask the user something.
pub const APPROVAL_NOT_SUPPORTED_MESSAGE: &str = "agents used as steps cannot ask for approval yet";

/// One agent as offered in the "Add a step" catalog and the chain editor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepInfo {
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub kind: AgentKind,
    pub status: AgentStatus,
    pub current_version: i64,
    pub inputs: Vec<AgentInput>,
    pub outputs: Vec<String>,
    pub step_count: usize,
    /// False when the agent cannot run inside another one (see `unusable_reason`).
    pub usable_as_step: bool,
    pub unusable_reason: Option<String>,
    /// How many other agents call this one.
    pub used_by_count: usize,
}

/// Every agent with its inputs and outputs. Agents whose flow does not compile
/// are listed as unusable rather than hidden, so the user can find and fix them.
///
/// # Errors
/// Storage errors only.
pub fn list_agent_steps(db: &Database) -> AppResult<Vec<AgentStepInfo>> {
    let agents = db.list_agents()?;
    let references: Vec<(String, references::AgentReferences)> = agents
        .iter()
        .filter_map(|agent| {
            let graph = flow::compile_flow(&agent.flow_yaml).ok()?;
            Some((agent.id.clone(), references::flow_references(&graph)))
        })
        .collect();
    Ok(agents
        .iter()
        .map(|agent| {
            let used_by_count = references
                .iter()
                .filter(|(caller_id, caller_references)| {
                    caller_id != &agent.id && caller_references.agent_ids.iter().any(|agent_id| agent_id == &agent.id)
                })
                .count();
            describe_agent_step(agent, used_by_count)
        })
        .collect())
}

fn describe_agent_step(agent: &Agent, used_by_count: usize) -> AgentStepInfo {
    let (signature, unusable_reason) = match read_signature(&agent.flow_yaml) {
        Ok(signature) if signature.asks_for_approval => {
            (Some(signature), Some(APPROVAL_NOT_SUPPORTED_MESSAGE.to_owned()))
        }
        Ok(signature) => (Some(signature), None),
        Err(error) => (None, Some(format!("its steps have a problem: {error}"))),
    };
    let signature = signature.unwrap_or(AgentSignature {
        inputs: Vec::new(),
        outputs: Vec::new(),
        step_count: 0,
        asks_for_approval: false,
    });
    AgentStepInfo {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        description: agent.description.clone(),
        kind: agent.kind,
        status: agent.status,
        current_version: agent.current_version,
        inputs: signature.inputs,
        outputs: signature.outputs,
        step_count: signature.step_count,
        usable_as_step: unusable_reason.is_none(),
        unusable_reason,
        used_by_count,
    }
}

/// One member agent of a team.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub status: AgentStatus,
    pub current_version: i64,
    /// The member's most recent top-level run (calls from the team are not recorded as runs).
    pub latest_run: Option<Run>,
}

/// A team agent: its coordinator `agent` step and the member agents it may call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamOverview {
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub status: AgentStatus,
    /// Node id of the coordinator (the first `agent` node), if the flow has one.
    pub coordinator_step_id: Option<String>,
    pub members: Vec<TeamMember>,
}

/// The team's members are the agent tools of its coordinator; `agents/*` means
/// every other agent. Member ids that no longer exist are skipped.
///
/// # Errors
/// `NotFound` for an unknown team agent; `Workflow` when its flow does not compile.
pub fn team_overview(db: &Database, team_agent_id: &str) -> AppResult<TeamOverview> {
    let team_agent = db.get_agent(team_agent_id)?;
    let graph = flow::compile_flow(&team_agent.flow_yaml)?;
    let coordinator = graph.nodes().iter().find(|node| node.kind == "agent");
    let member_references = coordinator.map(references::node_references).unwrap_or_default();
    let all_agents = db.list_agents()?;
    let member_agents: Vec<&Agent> = if member_references.includes_every_agent {
        all_agents.iter().filter(|agent| agent.id != team_agent.id).collect()
    } else {
        member_references
            .agent_ids
            .iter()
            .filter_map(|member_id| all_agents.iter().find(|agent| &agent.id == member_id))
            .collect()
    };
    let members = member_agents.into_iter().map(|agent| describe_member(db, agent)).collect::<AppResult<Vec<_>>>()?;
    Ok(TeamOverview {
        agent_id: team_agent.id,
        name: team_agent.name,
        description: team_agent.description,
        status: team_agent.status,
        coordinator_step_id: coordinator.map(|node| node.id.to_string()),
        members,
    })
}

fn describe_member(db: &Database, agent: &Agent) -> AppResult<TeamMember> {
    let latest_run =
        db.list_runs(&RunFilter { agent_id: Some(agent.id.clone()), status: None, limit: Some(1) })?.into_iter().next();
    Ok(TeamMember {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        description: agent.description.clone(),
        status: agent.status,
        current_version: agent.current_version,
        latest_run,
    })
}

/// Checks that `step_agent_id` can be called from `target_agent_id`.
///
/// # Errors
/// `InvalidInput` when the agent would call itself, or when the step agent
/// asks for approval or has an invalid flow; `NotFound` for unknown agents.
pub fn ensure_usable_as_step(db: &Database, target_agent_id: &str, step_agent_id: &str) -> AppResult<Agent> {
    db.get_agent(target_agent_id)?;
    if target_agent_id == step_agent_id {
        return Err(AppError::InvalidInput("an agent cannot use itself as a step".into()));
    }
    let step_agent = db.get_agent(step_agent_id)?;
    let signature = read_signature(&step_agent.flow_yaml)?;
    if signature.asks_for_approval {
        return Err(AppError::InvalidInput(format!(
            "{} stops to ask you, and {APPROVAL_NOT_SUPPORTED_MESSAGE}",
            step_agent.name
        )));
    }
    Ok(step_agent)
}

#[cfg(test)]
mod tests;
