//! Knowledge bases: local documents and web pages that agents can search,
//! built on the graphrt runtime's `graphrt-rag` crate.
//!
//! Layout:
//! - [`KnowledgeService`] (this file): the API the Tauri commands call.
//! - `records`: knowledge bases, sources and document fingerprints in the app database.
//! - `stores`: one graphrt-rag `SqliteStore` file per knowledge base, and embedders.
//! - `sources`: validating sources and reading files, folders and links.
//! - `sync`: background indexing with progress events.
//! - `retrieval`: search for the UI and the `knowledge-retrieval` node in runs.
//! - `events`: the `knowledge-event` Tauri event.
//!
//! Embeddings: a knowledge base uses OpenAI `text-embedding-3-small` when an
//! OpenAI key is configured at creation, otherwise graphrt-rag's offline
//! hashing embedder. Both are blended with BM25 keyword search, and search
//! falls back to keywords only when the OpenAI key is removed or unreachable,
//! so knowledge works without any key.

pub mod events;
pub mod models;
pub mod records;
pub mod retrieval;
pub mod sources;
pub mod stores;
mod sync;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use self::events::KnowledgeEventSink;
use self::models::{
    EmbeddingChoice, KnowledgeBase, KnowledgeBaseDetail, KnowledgeBaseStatus, KnowledgePassage, KnowledgeSettings,
    KnowledgeSource, KnowledgeUsage, SourceKind, SourceStatus, SyncProgress,
};
use self::records::StoredKnowledgeBase;
use self::sources::WebFetcher;
use self::stores::EmbeddingKeys;
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::models::Agent;
use crate::storage::{now_rfc3339, Database};

pub use self::retrieval::knowledge_service_for_runs;

/// Folder under the app data directory holding the knowledge store files.
pub const KNOWLEDGE_DIR_NAME: &str = "knowledge";
const MAX_NAME_LENGTH: usize = 120;
/// Most passages one search returns.
pub const MAX_SEARCH_RESULTS: usize = 50;

/// Knowledge bases currently syncing, with their progress.
#[derive(Debug, Default)]
struct SyncTracker {
    running: Mutex<HashMap<String, RunningSync>>,
}

#[derive(Debug, Clone, Copy)]
struct RunningSync {
    /// Another sync was requested while this one ran; run again when it ends.
    rerun_requested: bool,
    progress: SyncProgress,
}

impl SyncTracker {
    fn lock(&self) -> AppResult<MutexGuard<'_, HashMap<String, RunningSync>>> {
        self.running.lock().map_err(|_| AppError::Internal("knowledge sync table lock poisoned".into()))
    }

    /// Claims the knowledge base. Returns false (and asks the running sync to
    /// go again) when it is already syncing.
    fn begin(&self, knowledge_base_id: &str) -> AppResult<bool> {
        let mut running = self.lock()?;
        if let Some(sync) = running.get_mut(knowledge_base_id) {
            sync.rerun_requested = true;
            return Ok(false);
        }
        let idle = RunningSync { rerun_requested: false, progress: SyncProgress { done: 0, total: 0 } };
        running.insert(knowledge_base_id.to_owned(), idle);
        Ok(true)
    }

    /// Releases the knowledge base, unless a rerun was requested (then returns true and keeps it).
    fn finish(&self, knowledge_base_id: &str) -> bool {
        let Ok(mut running) = self.lock() else { return false };
        match running.get_mut(knowledge_base_id) {
            Some(sync) if sync.rerun_requested => {
                sync.rerun_requested = false;
                true
            }
            _ => {
                running.remove(knowledge_base_id);
                false
            }
        }
    }

    fn set_progress(&self, knowledge_base_id: &str, progress: SyncProgress) {
        if let Ok(mut running) = self.lock() {
            if let Some(sync) = running.get_mut(knowledge_base_id) {
                sync.progress = progress;
            }
        }
    }

    fn progress(&self, knowledge_base_id: &str) -> Option<SyncProgress> {
        self.lock().ok()?.get(knowledge_base_id).map(|sync| sync.progress)
    }
}

/// Knowledge base operations. One per app, shared as `Arc<KnowledgeService>`.
#[derive(Debug)]
pub struct KnowledgeService {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    knowledge_dir: PathBuf,
    sink: Arc<dyn KnowledgeEventSink>,
    tracker: SyncTracker,
    web: WebFetcher,
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("give the knowledge base a name".into()));
    }
    if name.chars().count() > MAX_NAME_LENGTH {
        return Err(AppError::InvalidInput(format!("names are at most {MAX_NAME_LENGTH} characters")));
    }
    Ok(name.to_owned())
}

/// Agents whose current workflow refers to the knowledge base, by id or (in a
/// `knowledge-retrieval` step) by its exact name.
fn usages_of(knowledge_base: &StoredKnowledgeBase, agents: &[Agent]) -> Vec<KnowledgeUsage> {
    let mentions_name = |flow_yaml: &str| {
        flow_yaml.contains(retrieval::KNOWLEDGE_RETRIEVAL_KIND) && flow_yaml.contains(&knowledge_base.name)
    };
    agents
        .iter()
        .filter(|agent| agent.flow_yaml.contains(&knowledge_base.id) || mentions_name(&agent.flow_yaml))
        .map(|agent| KnowledgeUsage { agent_id: agent.id.clone(), agent_name: agent.name.clone() })
        .collect()
}

fn derive_status(sources: &[KnowledgeSource], is_syncing: bool) -> KnowledgeBaseStatus {
    if is_syncing {
        return KnowledgeBaseStatus::Syncing;
    }
    if sources.is_empty() {
        return KnowledgeBaseStatus::Empty;
    }
    let needs_attention =
        sources.iter().any(|source| source.status != SourceStatus::Indexed || source.failed_count > 0);
    if needs_attention {
        KnowledgeBaseStatus::NeedsAttention
    } else {
        KnowledgeBaseStatus::UpToDate
    }
}

impl KnowledgeService {
    /// `knowledge_dir` holds one store file per knowledge base.
    pub fn new(
        db: Arc<Database>,
        credentials: Arc<CredentialStore>,
        knowledge_dir: PathBuf,
        sink: Arc<dyn KnowledgeEventSink>,
    ) -> Self {
        Self { db, credentials, knowledge_dir, sink, tracker: SyncTracker::default(), web: WebFetcher::new() }
    }

    fn summarize(&self, stored: &StoredKnowledgeBase, sources: &[KnowledgeSource], agents: &[Agent]) -> KnowledgeBase {
        let sync_progress = self.tracker.progress(&stored.id);
        KnowledgeBase {
            id: stored.id.clone(),
            name: stored.name.clone(),
            description: stored.description.clone(),
            settings: stored.settings,
            status: derive_status(sources, sync_progress.is_some()),
            sync_progress,
            source_count: u32::try_from(sources.len()).unwrap_or(u32::MAX),
            file_count: sources
                .iter()
                .filter(|source| source.kind != SourceKind::Url)
                .map(|source| source.document_count)
                .sum(),
            website_count: u32::try_from(sources.iter().filter(|source| source.kind == SourceKind::Url).count())
                .unwrap_or(u32::MAX),
            passage_count: sources.iter().map(|source| source.passage_count).sum(),
            storage_bytes: stores::store_size_bytes(Path::new(&stored.store_path)),
            used_by: usages_of(stored, agents),
            last_synced_at: stored.last_synced_at.clone(),
            created_at: stored.created_at.clone(),
            updated_at: stored.updated_at.clone(),
        }
    }

    fn list_agents_for_usage(&self) -> Vec<Agent> {
        self.db.list_agents().unwrap_or_else(|error| {
            log::warn!("could not list agents for knowledge usage: {error}");
            Vec::new()
        })
    }

    /// The knowledge base with its current totals.
    ///
    /// # Errors
    /// `NotFound` for an unknown id.
    pub fn knowledge_base_summary(&self, knowledge_base_id: &str) -> AppResult<KnowledgeBase> {
        let stored = records::get_knowledge_base(&self.db, knowledge_base_id)?;
        let sources = records::list_sources(&self.db, knowledge_base_id)?;
        Ok(self.summarize(&stored, &sources, &self.list_agents_for_usage()))
    }

    /// Every knowledge base, most recently changed first.
    pub fn list_knowledge_bases(&self) -> AppResult<Vec<KnowledgeBase>> {
        let agents = self.list_agents_for_usage();
        records::list_knowledge_bases(&self.db)?
            .iter()
            .map(|stored| Ok(self.summarize(stored, &records::list_sources(&self.db, &stored.id)?, &agents)))
            .collect()
    }

    /// # Errors
    /// `NotFound` for an unknown id.
    pub fn get_knowledge_base(&self, knowledge_base_id: &str) -> AppResult<KnowledgeBaseDetail> {
        let stored = records::get_knowledge_base(&self.db, knowledge_base_id)?;
        let sources = records::list_sources(&self.db, knowledge_base_id)?;
        let knowledge_base = self.summarize(&stored, &sources, &self.list_agents_for_usage());
        Ok(KnowledgeBaseDetail { knowledge_base, sources })
    }

    /// Creates an empty knowledge base. It embeds with OpenAI when an OpenAI
    /// key is configured, otherwise on this computer.
    ///
    /// # Errors
    /// `InvalidInput` for a blank or too long name.
    pub fn create_knowledge_base(&self, name: &str, description: &str) -> AppResult<KnowledgeBase> {
        let name = validate_name(name)?;
        let id = format!("kb_{}", uuid::Uuid::new_v4().simple());
        let now = now_rfc3339();
        let stored = StoredKnowledgeBase {
            store_path: self.knowledge_dir.join(format!("{id}.sqlite")).display().to_string(),
            id,
            name,
            description: description.trim().to_owned(),
            settings: KnowledgeSettings::with_embedding(stores::default_embedding(&self.credentials)),
            last_synced_at: None,
            created_at: now.clone(),
            updated_at: now,
        };
        records::insert_knowledge_base(&self.db, &stored)?;
        Ok(self.summarize(&stored, &[], &[]))
    }

    /// # Errors
    /// `InvalidInput` for a bad name, `NotFound` for an unknown id.
    pub fn rename_knowledge_base(&self, knowledge_base_id: &str, name: &str) -> AppResult<KnowledgeBase> {
        records::rename_knowledge_base(&self.db, knowledge_base_id, &validate_name(name)?)?;
        self.knowledge_base_summary(knowledge_base_id)
    }

    /// Deletes the knowledge base, its sources and its passage store file.
    ///
    /// # Errors
    /// `NotFound` for an unknown id, `Internal` when the store file cannot be removed.
    pub fn delete_knowledge_base(&self, knowledge_base_id: &str) -> AppResult<()> {
        let stored = records::get_knowledge_base(&self.db, knowledge_base_id)?;
        records::delete_knowledge_base(&self.db, knowledge_base_id)?;
        stores::delete_store(Path::new(&stored.store_path))
    }

    /// Adds a file, folder or link. It is indexed by the next sync.
    ///
    /// # Errors
    /// `NotFound` for an unknown knowledge base, `InvalidInput` for an unusable
    /// or duplicate location.
    pub fn add_source(&self, knowledge_base_id: &str, kind: SourceKind, location: &str) -> AppResult<KnowledgeSource> {
        records::get_knowledge_base(&self.db, knowledge_base_id)?;
        let validated = sources::validate_new_source(kind, location)?;
        let source = KnowledgeSource {
            id: format!("src_{}", uuid::Uuid::new_v4().simple()),
            knowledge_base_id: knowledge_base_id.to_owned(),
            kind,
            location: validated.location,
            name: validated.name,
            status: SourceStatus::Pending,
            status_message: None,
            document_count: 0,
            failed_count: 0,
            passage_count: 0,
            last_synced_at: None,
            created_at: now_rfc3339(),
        };
        records::insert_source(&self.db, &source)?;
        Ok(source)
    }

    /// Removes a source and its passages.
    ///
    /// # Errors
    /// `NotFound` for an unknown source.
    pub async fn remove_source(&self, source_id: &str) -> AppResult<()> {
        let source = records::get_source(&self.db, source_id)?;
        let stored = records::get_knowledge_base(&self.db, &source.knowledge_base_id)?;
        let store = stores::open_store(Path::new(&stored.store_path))?;
        for document in records::list_documents(&self.db, source_id)? {
            graphrt_rag::VectorStore::delete_document(store.as_ref(), &stored.id, &document.document_id)
                .await
                .map_err(|error| AppError::Internal(format!("could not remove passages: {error}")))?;
        }
        records::delete_source(&self.db, source_id)
    }

    /// Saves settings. Changing the embedding model clears the passages; the
    /// returned flag says a sync is needed to index them again.
    ///
    /// # Errors
    /// `InvalidInput` for out-of-range values or OpenAI without a key.
    pub async fn update_settings(
        &self,
        knowledge_base_id: &str,
        settings: KnowledgeSettings,
    ) -> AppResult<(KnowledgeBase, bool)> {
        settings.validate()?;
        let stored = records::get_knowledge_base(&self.db, knowledge_base_id)?;
        let embedding_changed = stored.settings.embedding != settings.embedding;
        if embedding_changed && settings.embedding == EmbeddingChoice::Openai {
            let keys = EmbeddingKeys::load(&self.credentials, [EmbeddingChoice::Openai])?;
            if !keys.has_openai() {
                return Err(AppError::InvalidInput("add an OpenAI key in Settings to use OpenAI embeddings".into()));
            }
        }
        records::update_settings(&self.db, knowledge_base_id, &settings)?;
        if embedding_changed {
            // Vectors from two models cannot be compared: index everything again.
            let store = stores::open_store(Path::new(&stored.store_path))?;
            graphrt_rag::VectorStore::delete_dataset(store.as_ref(), knowledge_base_id)
                .await
                .map_err(|error| AppError::Internal(format!("could not clear passages: {error}")))?;
            records::clear_documents(&self.db, knowledge_base_id)?;
            records::mark_sources_pending(&self.db, knowledge_base_id)?;
        }
        Ok((self.knowledge_base_summary(knowledge_base_id)?, embedding_changed))
    }

    /// Searches `knowledge_base_ids` (every knowledge base when `None`), best first.
    /// Weak matches are kept so the UI can flag them.
    ///
    /// # Errors
    /// `NotFound` for an unknown id, `Internal` when the search itself fails.
    pub async fn search(
        &self,
        query: &str,
        knowledge_base_ids: Option<Vec<String>>,
        limit: usize,
    ) -> AppResult<Vec<KnowledgePassage>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let all_bases = records::list_knowledge_bases(&self.db)?;
        let selected: Vec<StoredKnowledgeBase> = match knowledge_base_ids {
            None => all_bases,
            Some(ids) => ids
                .iter()
                .map(|id| {
                    all_bases
                        .iter()
                        .find(|base| &base.id == id)
                        .cloned()
                        .ok_or_else(|| AppError::NotFound(format!("knowledge base {id}")))
                })
                .collect::<AppResult<_>>()?,
        };
        if selected.is_empty() {
            return Ok(Vec::new());
        }
        let keys = EmbeddingKeys::load(&self.credentials, selected.iter().map(|base| base.settings.embedding))?;
        let service = retrieval::build_knowledge_service(&selected, &keys, false)?;
        let dataset_ids = selected.iter().map(|base| base.id.clone()).collect();
        let request = graphrt_rag::RetrievalRequest::new(query, dataset_ids).top_k(limit.clamp(1, MAX_SEARCH_RESULTS));
        let hits = service
            .retrieve(&request)
            .await
            .map_err(|error| AppError::Internal(format!("knowledge search failed: {error}")))?;
        Ok(hits.into_iter().map(|hit| retrieval::passage_from_hit(hit, &selected)).collect())
    }

    /// Starts [`KnowledgeService::sync_knowledge_base`] in the background.
    pub fn spawn_sync(self: &Arc<Self>, knowledge_base_id: String) {
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = service.sync_knowledge_base(&knowledge_base_id).await {
                log::warn!("knowledge base {knowledge_base_id} could not sync: {error}");
            }
        });
    }
}
