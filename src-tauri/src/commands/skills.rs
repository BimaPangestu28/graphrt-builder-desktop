//! Skills commands (the Skills page and its wizards). Logic lives in `crate::skills` and
//! `crate::agent_graph::skills`; these only gather what it reads from the app.

use tauri::State;

use crate::agent_graph::skills::{self as agent_skills, AgentSkills};
use crate::agent_graph::{self, GraphContext};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::skills::models::{
    AuthoredSkillInput, InstalledSkill, SkillCatalog, SkillDraftSource, SkillDraftView, SkillReview, ToolPermission,
};
use crate::state::AppState;

#[tauri::command]
pub fn list_installed_skills(state: State<'_, AppState>) -> AppResult<Vec<InstalledSkill>> {
    state.skills.list_installed()
}

/// The catalog's skills with their install state (`refresh` fetches the catalog again).
#[tauri::command]
pub async fn list_skill_catalog(state: State<'_, AppState>, refresh: Option<bool>) -> AppResult<SkillCatalog> {
    state.skills.catalog(refresh.unwrap_or(false)).await
}

/// Downloads and checks a catalog skill for the confirmation screens; installs nothing.
#[tauri::command]
pub async fn review_catalog_skill(state: State<'_, AppState>, name: String) -> AppResult<SkillReview> {
    state.skills.review_catalog_skill(name.trim()).await
}

/// Installs a catalog skill as reviewed (`review_id` from the review) with exactly the
/// tools in `permissions`. `accept_findings` is the person's second confirmation of a
/// finding that blocks.
#[tauri::command]
pub async fn install_catalog_skill(
    state: State<'_, AppState>,
    name: String,
    review_id: String,
    permissions: Vec<ToolPermission>,
    accept_findings: Option<bool>,
) -> AppResult<InstalledSkill> {
    state.skills.install_catalog_skill(name.trim(), &review_id, &permissions, accept_findings.unwrap_or(false)).await
}

/// Asks the person's model to draft a skill from plain words or an example conversation.
#[tauri::command]
pub async fn draft_skill(state: State<'_, AppState>, source: SkillDraftSource) -> AppResult<SkillDraftView> {
    state.skills.draft_skill(&source).await
}

/// Checks the draft as the person left it, for the confirmation screens.
#[tauri::command]
pub fn review_authored_skill(state: State<'_, AppState>, input: AuthoredSkillInput) -> AppResult<SkillReview> {
    state.skills.review_authored_skill(&input)
}

/// Installs the draft, as reviewed.
#[tauri::command]
pub fn install_authored_skill(
    state: State<'_, AppState>,
    input: AuthoredSkillInput,
    review_id: String,
    permissions: Vec<ToolPermission>,
    accept_findings: Option<bool>,
) -> AppResult<InstalledSkill> {
    state.skills.install_authored_skill(&input, &review_id, &permissions, accept_findings.unwrap_or(false))
}

/// Replaces what an installed skill may use.
#[tauri::command]
pub fn set_skill_permissions(
    state: State<'_, AppState>,
    name: String,
    permissions: Vec<ToolPermission>,
) -> AppResult<InstalledSkill> {
    state.skills.set_permissions(name.trim(), &permissions)
}

#[tauri::command]
pub fn set_skill_enabled(state: State<'_, AppState>, name: String, enabled: bool) -> AppResult<InstalledSkill> {
    state.skills.set_enabled(name.trim(), enabled)
}

/// Takes the skill off every agent that uses it, then removes it.
#[tauri::command]
pub fn remove_skill(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let name = name.trim();
    state.skills.installed(name)?;
    with_skill_context(|context| agent_skills::remove_skill_from_agents(&state.db, name, context))?;
    state.skills.remove(name)
}

/// Every agent with its steps that can use skills.
#[tauri::command]
pub fn list_agent_skills(state: State<'_, AppState>) -> AppResult<Vec<AgentSkills>> {
    with_skill_context(|context| agent_skills::list_agent_skills(&state.db, context))
}

/// Sets the skills of one step of an agent (a new version of the agent). Every skill must
/// be installed.
#[tauri::command]
pub fn set_agent_step_skills(
    state: State<'_, AppState>,
    agent_id: String,
    step_id: String,
    skills: Vec<String>,
) -> AppResult<AgentSkills> {
    let installed = state.skills.list_installed()?;
    if let Some(missing) = skills.iter().find(|name| !installed.iter().any(|skill| &skill.name == *name)) {
        return Err(AppError::NotFound(format!("skill {missing}")));
    }
    with_skill_context(|context| agent_skills::set_step_skills(&state.db, &agent_id, &step_id, &skills, context))
}

/// A graph context that checks step settings against the installed node kinds. Model
/// providers and trusted hosts are not checked: a skills change touches neither, and only
/// problems the change itself adds are reported.
fn with_skill_context<T>(action: impl FnOnce(&GraphContext<'_>) -> AppResult<T>) -> AppResult<T> {
    let registry = flow::draft_node_registry();
    let runnable_kinds = agent_graph::registry_kinds(&flow::node_registry());
    let mut context = GraphContext::new(&registry);
    context.validation.runnable_kinds = Some(&runnable_kinds);
    action(&context)
}
