//! An agent's abilities (long conversations, memory, helper agents, spending limit) and the
//! owner's view of what it remembers. Logic lives in `crate::agent_graph::abilities`,
//! `crate::engine::spending` and `crate::memory`.

use tauri::State;

use crate::agent_graph::abilities::{self, AbilityChange, AgentAbilities};
use crate::agent_graph::{self, GraphContext};
use crate::engine::spending::{self, SpendingLimit};
use crate::error::AppResult;
use crate::flow;
use crate::memory::models::{AgentMemory, ForgottenPerson, MemoryGraphView, MemoryNoteView};
use crate::state::AppState;

#[tauri::command]
pub fn get_agent_abilities(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentAbilities> {
    abilities::agent_abilities(&state.db, &agent_id)
}

/// Changes one ability on every step that can use it (a new version of the agent).
#[tauri::command]
pub fn set_agent_ability(
    state: State<'_, AppState>,
    agent_id: String,
    change: AbilityChange,
) -> AppResult<AgentAbilities> {
    let registry = flow::draft_node_registry();
    let runnable_kinds = agent_graph::registry_kinds(&flow::node_registry());
    let mut context = GraphContext::new(&registry);
    context.validation.runnable_kinds = Some(&runnable_kinds);
    abilities::set_ability(&state.db, &agent_id, &change, &context)
}

/// Sets (or clears) the most tokens and money one run of the agent may use.
#[tauri::command]
pub fn set_agent_spending_limit(
    state: State<'_, AppState>,
    agent_id: String,
    limit: SpendingLimit,
) -> AppResult<AgentAbilities> {
    spending::save(&state.db, &agent_id, limit)?;
    abilities::agent_abilities(&state.db, &agent_id)
}

#[tauri::command]
pub async fn get_agent_memory(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentMemory> {
    state.memory.overview(&agent_id).await
}

/// The notes about `user` (`None`: the agent's own notes).
#[tauri::command]
pub async fn list_memory_notes(
    state: State<'_, AppState>,
    agent_id: String,
    user: Option<String>,
) -> AppResult<Vec<MemoryNoteView>> {
    state.memory.notes(&agent_id, user.as_deref()).await
}

#[tauri::command]
pub async fn get_memory_graph(
    state: State<'_, AppState>,
    agent_id: String,
    user: Option<String>,
) -> AppResult<MemoryGraphView> {
    state.memory.graph(&agent_id, user.as_deref()).await
}

#[tauri::command]
pub async fn delete_memory_note(
    state: State<'_, AppState>,
    agent_id: String,
    user: Option<String>,
    note_id: String,
) -> AppResult<()> {
    state.memory.delete_note(&agent_id, user.as_deref(), &note_id).await
}

/// Uses (`approve`) or removes a note that waits. Only this (the owner's click) approves one.
#[tauri::command]
pub async fn decide_memory_note(
    state: State<'_, AppState>,
    agent_id: String,
    user: Option<String>,
    note_id: String,
    approve: bool,
) -> AppResult<Option<MemoryNoteView>> {
    state.memory.decide(&agent_id, user.as_deref(), &note_id, approve).await
}

/// Erases everything kept about one person: their notes, their memory graph and the lessons
/// about them or from them.
#[tauri::command]
pub async fn forget_memory_person(
    state: State<'_, AppState>,
    agent_id: String,
    user: String,
) -> AppResult<ForgottenPerson> {
    forget_person(&state.memory, &state.learning, &agent_id, &user).await
}

/// Erases a person's notes and graph, then the lessons about them. When the lessons fail, the
/// error says the notes are already gone, so the owner knows what is left to retry.
///
/// # Errors
/// What either store reports.
pub(crate) async fn forget_person(
    memory: &crate::memory::MemoryService,
    learning: &crate::learning::LearningService,
    agent_id: &str,
    user: &str,
) -> AppResult<ForgottenPerson> {
    let notes = memory.erase_person(agent_id, user).await?;
    let lessons = learning.forget_person(agent_id, user).map_err(|error| {
        crate::error::AppError::Internal(format!(
            "the {notes} note(s) about this person were erased, but the lessons about them could not be: {error}. Try again"
        ))
    })?;
    Ok(ForgottenPerson { notes, lessons })
}
