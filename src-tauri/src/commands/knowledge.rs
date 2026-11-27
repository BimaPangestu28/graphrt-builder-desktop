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

/// Adds a source that syncs from a web site, an API, Google Drive, Notion or
/// SharePoint, and starts its first sync in the background. Credentials go to
/// the keychain and are never sent back.
#[tauri::command]
pub fn add_knowledge_connector_source(
    state: State<'_, AppState>,
    knowledge_base_id: String,
    source: crate::knowledge::connectors::NewConnectorSource,
) -> AppResult<KnowledgeSource> {
    let added = state.knowledge.add_connector_source(&knowledge_base_id, source)?;
    let knowledge = state.knowledge.clone();
    let source_id = added.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = knowledge.sync_sources(&knowledge_base_id, &[source_id]).await {
            log::warn!("first sync of a knowledge connector failed: {error}");
        }
    });
    Ok(added)
}

/// Changes when a connector source syncs by itself.
#[tauri::command]
pub fn set_knowledge_source_schedule(
    state: State<'_, AppState>,
    source_id: String,
    schedule: graphrt_connect::SyncSchedule,
) -> AppResult<KnowledgeSource> {
    state.knowledge.set_connector_schedule(&source_id, schedule)
}

/// "Sync now" on one source, in the background (progress arrives as `knowledge-event`s).
#[tauri::command]
pub fn sync_knowledge_source(state: State<'_, AppState>, source_id: String) -> AppResult<KnowledgeSource> {
    let source = state.knowledge.source(&source_id)?;
    let knowledge = state.knowledge.clone();
    let (knowledge_base_id, id) = (source.knowledge_base_id.clone(), source.id.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(error) = knowledge.sync_sources(&knowledge_base_id, &[id]).await {
            log::warn!("knowledge source sync failed: {error}");
        }
    });
    Ok(source)
}

/// Whether Google Drive or SharePoint can be signed in to with the app's own
/// registration, and what an own registration needs.
#[tauri::command]
pub fn knowledge_connector_sign_in_setup(
    provider: crate::knowledge::connectors::OAuthProvider,
) -> crate::knowledge::connector_oauth::ProviderSetup {
    crate::knowledge::connector_oauth::provider_setup(provider)
}

/// Signs in to Google Drive or SharePoint / OneDrive in the browser (read only
/// access). Returns an id to pass with the new source; tokens stay in the backend.
#[tauri::command]
pub async fn sign_in_knowledge_connector(
    provider: crate::knowledge::connectors::OAuthProvider,
    client: Option<crate::knowledge::connector_oauth::ClientChoice>,
) -> AppResult<crate::knowledge::connector_oauth::SignInResult> {
    let open_browser = |url: &str| crate::crash_reports::sharing::open_in_browser(url).map_err(|e| e.to_string());
    crate::knowledge::connector_oauth::sign_in(
        provider,
        client.unwrap_or_default(),
        &open_browser,
        crate::knowledge::connector_oauth::SIGN_IN_TIMEOUT,
    )
    .await
}
