//! Knowledge base commands. Indexing runs in the background; progress arrives
//! as `knowledge-event` Tauri events (see `knowledge::events`).

use tauri::State;

use crate::error::AppResult;
use crate::knowledge::models::{
    KnowledgeBase, KnowledgeBaseDetail, KnowledgePassage, KnowledgeSettings, KnowledgeSource, SourceKind,
};
use crate::state::AppState;

/// Passages returned when the caller does not say.
const DEFAULT_SEARCH_LIMIT: usize = 8;

#[tauri::command]
pub fn list_knowledge_bases(state: State<'_, AppState>) -> AppResult<Vec<KnowledgeBase>> {
    state.knowledge.list_knowledge_bases()
}

#[tauri::command]
pub fn get_knowledge_base(state: State<'_, AppState>, knowledge_base_id: String) -> AppResult<KnowledgeBaseDetail> {
    state.knowledge.get_knowledge_base(&knowledge_base_id)
}

#[tauri::command]
pub fn create_knowledge_base(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> AppResult<KnowledgeBase> {
    state.knowledge.create_knowledge_base(&name, description.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn rename_knowledge_base(
    state: State<'_, AppState>,
    knowledge_base_id: String,
    name: String,
) -> AppResult<KnowledgeBase> {
    state.knowledge.rename_knowledge_base(&knowledge_base_id, &name)
}

#[tauri::command]
pub fn delete_knowledge_base(state: State<'_, AppState>, knowledge_base_id: String) -> AppResult<()> {
    state.knowledge.delete_knowledge_base(&knowledge_base_id)
}

/// Adds a file, folder or link and starts indexing it in the background.
#[tauri::command]
pub fn add_knowledge_source(
    state: State<'_, AppState>,
    knowledge_base_id: String,
    kind: SourceKind,
    location: String,
) -> AppResult<KnowledgeSource> {
    let source = state.knowledge.add_source(&knowledge_base_id, kind, &location)?;
    state.knowledge.spawn_sync(knowledge_base_id);
    Ok(source)
}

#[tauri::command]
pub async fn remove_knowledge_source(state: State<'_, AppState>, source_id: String) -> AppResult<()> {
    state.knowledge.remove_source(&source_id).await
}

/// Re-reads every source in the background; unchanged files are skipped.
#[tauri::command]
pub fn sync_knowledge_base(state: State<'_, AppState>, knowledge_base_id: String) -> AppResult<KnowledgeBase> {
    let knowledge_base = state.knowledge.knowledge_base_summary(&knowledge_base_id)?;
    state.knowledge.spawn_sync(knowledge_base_id);
    Ok(knowledge_base)
}

/// Saves settings; a new embedding model re-indexes in the background.
#[tauri::command]
pub async fn update_knowledge_settings(
    state: State<'_, AppState>,
    knowledge_base_id: String,
    settings: KnowledgeSettings,
) -> AppResult<KnowledgeBase> {
    let (knowledge_base, needs_sync) = state.knowledge.update_settings(&knowledge_base_id, settings).await?;
    if needs_sync {
        state.knowledge.spawn_sync(knowledge_base_id);
    }
    Ok(knowledge_base)
}

/// Searches the given knowledge bases (all when omitted), best match first.
#[tauri::command]
pub async fn search_knowledge(
    state: State<'_, AppState>,
    query: String,
    knowledge_base_ids: Option<Vec<String>>,
    limit: Option<usize>,
) -> AppResult<Vec<KnowledgePassage>> {
    state.knowledge.search(&query, knowledge_base_ids, limit.unwrap_or(DEFAULT_SEARCH_LIMIT)).await
}
