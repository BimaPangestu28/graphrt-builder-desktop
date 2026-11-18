//! Agents used by other agents: the step catalog (screen 12) and teams (screen 13).
//!
//! Adding a step or a member is a builder revision with a precise instruction
//! (see `agent_steps::instructions`), so it is validated, versioned and shown
//! like any other change.

use tauri::ipc::Channel;
use tauri::State;

use crate::agent_builder::{self, BuildProgress, RevisionResult};
use crate::agent_steps::{self, AgentStepInfo, TeamOverview};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Every agent with its inputs and outputs, and whether it can run as a step.
#[tauri::command]
pub fn list_agent_steps(state: State<'_, AppState>) -> AppResult<Vec<AgentStepInfo>> {
    agent_steps::list_agent_steps(&state.db)
}

/// A team agent's coordinator step and member agents.
#[tauri::command]
pub fn get_team(state: State<'_, AppState>, agent_id: String) -> AppResult<TeamOverview> {
    agent_steps::team_overview(&state.db, &agent_id)
}

/// Adds `step_agent_id` as a `tool` step of `target_agent_id` (a new version).
/// `placement` is optional plain words such as "after Search Google Maps".
#[tauri::command]
pub async fn add_agent_step(
    state: State<'_, AppState>,
    target_agent_id: String,
    step_agent_id: String,
    placement: Option<String>,
    on_progress: Channel<BuildProgress>,
) -> AppResult<RevisionResult> {
    let step_agent = agent_steps::ensure_usable_as_step(&state.db, &target_agent_id, &step_agent_id)?;
    let signature = agent_steps::read_signature(&step_agent.flow_yaml)?;
    let instruction = agent_steps::add_step_instruction(&step_agent, &signature, placement.as_deref());
    let report = move |progress: BuildProgress| {
        // A closed channel only means the screen was left; the revision continues.
        let _ = on_progress.send(progress);
    };
    agent_builder::revise_agent(&state.db, &state.credentials, &target_agent_id, &instruction, &report).await
}

/// Gives the team's coordinator `member_agent_id` as a tool (a new version of the team agent).
#[tauri::command]
pub async fn add_team_member(
    state: State<'_, AppState>,
    team_agent_id: String,
    member_agent_id: String,
    on_progress: Channel<BuildProgress>,
) -> AppResult<RevisionResult> {
    let member = agent_steps::ensure_usable_as_step(&state.db, &team_agent_id, &member_agent_id)?;
    let team = agent_steps::team_overview(&state.db, &team_agent_id)?;
    if team.members.iter().any(|existing| existing.agent_id == member.id) {
        return Err(AppError::InvalidInput(format!("{} is already in the team", member.name)));
    }
    let instruction = agent_steps::add_team_member_instruction(&member, team.coordinator_step_id.as_deref());
    let report = move |progress: BuildProgress| {
        let _ = on_progress.send(progress);
    };
    agent_builder::revise_agent(&state.db, &state.credentials, &team_agent_id, &instruction, &report).await
}
