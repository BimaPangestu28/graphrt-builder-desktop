//! "What this agent learned" commands. Logic lives in `crate::learning` and
//! `crate::agent_graph::learning`.

use serde::Serialize;
use tauri::State;

use crate::agent_graph::learning::{self as agent_learning, LearningUse};
use crate::agent_graph::{self, GraphContext};
use crate::error::AppResult;
use crate::flow;
use crate::learning::models::{
    AgentLearning, FeedbackOutcome, LessonDecision, LessonView, RunFeedback, RunSuggestions,
};
use crate::skills::models::SkillDraftView;
use crate::state::AppState;

/// The screen's data: the lessons and history, and whether the agent's steps read them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLearningPage {
    #[serde(flatten)]
    pub learning: AgentLearning,
    pub usage: LearningUse,
}

#[tauri::command]
pub fn get_agent_learning(state: State<'_, AppState>, agent_id: String) -> AppResult<AgentLearningPage> {
    let agent = state.db.get_agent(&agent_id)?;
    Ok(AgentLearningPage { learning: state.learning.overview(&agent_id)?, usage: agent_learning::learning_use(&agent) })
}

/// Approves, rejects or retires a lesson. Only this (the owner's click) approves one.
#[tauri::command]
pub fn decide_lesson(
    state: State<'_, AppState>,
    agent_id: String,
    lesson_id: String,
    decision: LessonDecision,
) -> AppResult<LessonView> {
    state.learning.decide(&agent_id, &lesson_id, decision)
}

#[tauri::command]
pub fn edit_lesson(
    state: State<'_, AppState>,
    agent_id: String,
    lesson_id: String,
    text: String,
) -> AppResult<LessonView> {
    state.learning.edit(&agent_id, &lesson_id, &text)
}

#[tauri::command]
pub fn delete_lesson(state: State<'_, AppState>, agent_id: String, lesson_id: String) -> AppResult<()> {
    state.learning.delete(&agent_id, &lesson_id)
}

/// Makes one person's lesson apply to everyone the agent serves.
#[tauri::command]
pub fn apply_lesson_to_everyone(
    state: State<'_, AppState>,
    agent_id: String,
    lesson_id: String,
) -> AppResult<LessonView> {
    state.learning.apply_to_everyone(&agent_id, &lesson_id)
}

/// Forgets a person: returns how many lessons were removed.
#[tauri::command]
pub fn forget_learning_person(state: State<'_, AppState>, agent_id: String, user: String) -> AppResult<usize> {
    state.learning.forget_person(&agent_id, &user)
}

/// Adds a note the owner wrote; it applies at once.
#[tauri::command]
pub fn add_learning_note(state: State<'_, AppState>, agent_id: String, text: String) -> AppResult<LessonView> {
    state.learning.add_note(&agent_id, &text)
}

#[tauri::command]
pub fn set_auto_learn(state: State<'_, AppState>, agent_id: String, enabled: bool) -> AppResult<bool> {
    state.learning.set_auto_learn(&agent_id, enabled)
}

/// Makes the agent's steps read what it learned, or stop (a new version of the agent).
#[tauri::command]
pub fn set_agent_uses_learning(state: State<'_, AppState>, agent_id: String, enabled: bool) -> AppResult<LearningUse> {
    let registry = flow::draft_node_registry();
    let runnable_kinds = agent_graph::registry_kinds(&flow::node_registry());
    let mut context = GraphContext::new(&registry);
    context.validation.runnable_kinds = Some(&runnable_kinds);
    agent_learning::set_learning_use(&state.db, &agent_id, enabled, &context)
}

/// Thumbs up or down on a finished run. A comment becomes a proposal that waits for the owner.
#[tauri::command]
pub async fn record_run_feedback(
    state: State<'_, AppState>,
    run_id: String,
    feedback: RunFeedback,
) -> AppResult<FeedbackOutcome> {
    state.learning.record_feedback(&run_id, &feedback).await
}

/// Asks the person's model to read the agent's latest runs and suggest notes. Every
/// suggestion waits for the owner.
#[tauri::command]
pub async fn suggest_notes_from_runs(state: State<'_, AppState>, agent_id: String) -> AppResult<RunSuggestions> {
    state.learning.suggest_from_runs(&agent_id).await
}

/// Asks the person's model to write one skill from the notes the agent learned about how
/// to do its work. `None` when there are too few. Nothing is installed.
#[tauri::command]
pub async fn draft_skill_from_notes(state: State<'_, AppState>, agent_id: String) -> AppResult<Option<SkillDraftView>> {
    state.db.get_agent(&agent_id)?;
    state.skills.draft_skill_from_notes(state.learning.store(), &agent_id).await
}
