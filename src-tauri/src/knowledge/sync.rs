//! Indexing: reads every source of a knowledge base, re-indexes documents
//! whose bytes changed, drops documents that disappeared and reports progress.
//!
//! Unchanged documents (same byte fingerprint as last time) are not even
//! extracted again; changed ones go through graphrt-rag's [`Ingestor`], which
//! re-embeds only the passages whose text changed. A document that fails to
//! read keeps its previously indexed passages.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use graphrt_rag::{Document, Embedder, Ingestor, Metadata, SqliteStore, VectorStore};

use super::events::KnowledgeEvent;
use super::models::{KnowledgeSource, SourceKind, SourceStatus, SyncProgress, SyncReport};
use super::records::{self, SourceOutcome, StoredDocument, StoredKnowledgeBase};
use super::retrieval::{METADATA_SOURCE_ID, METADATA_SOURCE_NAME};
use super::sources::{self, SourceEntry};
use super::stores::{self, EmbeddingKeys, EmbeddingSetup};
use super::KnowledgeService;
use crate::error::{AppError, AppResult};
use crate::storage::now_rfc3339;

const MISSING_OPENAI_KEY: &str =
    "add an OpenAI key in Settings, or switch this knowledge base to embeddings on this Mac";

/// What happened to one document.
enum DocumentResult {
    Unchanged { passage_count: u64 },
    Indexed { passage_count: u64 },
    Failed { message: String },
}

/// Running totals while one source syncs.
#[derive(Default)]
struct SourceTally {
    report: SyncReport,
    document_count: u32,
    passage_count: u64,
    failures: Vec<String>,
}

/// What every document of one sync shares.
struct SyncContext<'a> {
    knowledge_base: &'a StoredKnowledgeBase,
    store: Arc<SqliteStore>,
    setup: EmbeddingSetup,
}

impl SourceTally {
    fn outcome(&self, entry_count: usize) -> SourceOutcome {
        let failed_count = u32::try_from(self.failures.len()).unwrap_or(u32::MAX);
        let (status, status_message) = if entry_count == 0 {
            (SourceStatus::Failed, Some("no supported files found".to_owned()))
        } else if self.document_count == 0 && failed_count > 0 {
            (SourceStatus::Failed, self.failures.first().cloned())
        } else if failed_count == 1 {
            (SourceStatus::Indexed, Some(format!("1 file could not be read: {}", self.failures.join(""))))
        } else if failed_count > 1 {
            (SourceStatus::Indexed, Some(format!("{failed_count} files could not be read")))
        } else {
            (SourceStatus::Indexed, None)
        };
        SourceOutcome {
            status,
            status_message,
            document_count: self.document_count,
            failed_count,
            passage_count: self.passage_count,
        }
    }
}

fn percent(done: usize, total: usize) -> u8 {
    if total == 0 {
        return 100;
    }
    u8::try_from(done.saturating_mul(100) / total).unwrap_or(100)
}

fn to_u32(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

impl KnowledgeService {
    /// Indexes every source of the knowledge base. When a sync of it is already
    /// running, that sync runs once more instead and this returns at once.
    ///
    /// # Errors
    /// `NotFound` for an unknown id; database and store failures. Problems
    /// with single files are reported on their source instead.
    pub async fn sync_knowledge_base(&self, knowledge_base_id: &str) -> AppResult<SyncReport> {
        records::get_knowledge_base(&self.db, knowledge_base_id)?;
        if !self.tracker.begin(knowledge_base_id)? {
            return Ok(SyncReport::default());
        }
        let mut outcome = Ok(SyncReport::default());
        loop {
            match self.sync_once(knowledge_base_id).await {
                Ok(report) => {
                    if let Ok(total) = &mut outcome {
                        total.add(report);
                    }
                }
                Err(error) => outcome = Err(error),
            }
            if !self.tracker.finish(knowledge_base_id) {
                break;
            }
        }
        self.send_sync_finished(knowledge_base_id);
        outcome
    }

    fn send_sync_finished(&self, knowledge_base_id: &str) {
        match self.knowledge_base_summary(knowledge_base_id) {
            Ok(knowledge_base) => self
                .sink
                .send(KnowledgeEvent::SyncFinished { knowledge_base_id: knowledge_base_id.to_owned(), knowledge_base }),
            // Deleted while syncing: nothing left to report.
            Err(AppError::NotFound(_)) => {}
            Err(error) => log::warn!("could not report the end of a knowledge sync: {error}"),
        }
    }

    fn send_source_updated(&self, source_id: &str, progress_percent: Option<u8>) {
        match records::get_source(&self.db, source_id) {
            Ok(source) => self.sink.send(KnowledgeEvent::SourceUpdated {
                knowledge_base_id: source.knowledge_base_id.clone(),
                source,
                progress_percent,
            }),
            Err(AppError::NotFound(_)) => {}
            Err(error) => log::warn!("could not report knowledge source progress: {error}"),
        }
    }

    async fn sync_once(&self, knowledge_base_id: &str) -> AppResult<SyncReport> {
        let Some(knowledge_base) = records::find_knowledge_base(&self.db, knowledge_base_id)? else {
            return Ok(SyncReport::default());
        };
        self.sink.send(KnowledgeEvent::SyncStarted { knowledge_base_id: knowledge_base_id.to_owned() });
        let sources = records::list_sources(&self.db, knowledge_base_id)?;
        let keys = EmbeddingKeys::load(&self.credentials, [knowledge_base.settings.embedding])?;
        let context = SyncContext {
            knowledge_base: &knowledge_base,
            store: stores::open_store(Path::new(&knowledge_base.store_path))?,
            setup: keys.setup_for(knowledge_base.settings.embedding)?,
        };
        let total = to_u32(sources.len());
        self.tracker.set_progress(knowledge_base_id, SyncProgress { done: 0, total });
        let mut report = SyncReport::default();
        for (index, source) in sources.iter().enumerate() {
            if records::find_knowledge_base(&self.db, knowledge_base_id)?.is_none() {
                return Ok(report);
            }
            report.add(self.sync_source(&context, source).await?);
            self.tracker.set_progress(knowledge_base_id, SyncProgress { done: to_u32(index + 1), total });
        }
        records::set_last_synced(&self.db, knowledge_base_id, &now_rfc3339())?;
        Ok(report)
    }

    async fn sync_source(&self, context: &SyncContext<'_>, source: &KnowledgeSource) -> AppResult<SyncReport> {
        records::set_source_status(&self.db, &source.id, SourceStatus::Reading)?;
        self.send_source_updated(&source.id, Some(0));
        let listed_source = source.clone();
        let listing = tokio::task::spawn_blocking(move || sources::list_entries(&listed_source))
            .await
            .map_err(|error| AppError::Internal(format!("listing stopped unexpectedly: {error}")))?;
        let entries = match listing {
            Ok(entries) => entries,
            Err(error) => {
                let message = match error {
                    AppError::InvalidInput(message) => message,
                    other => other.to_string(),
                };
                return self.finish_unreadable_source(source, message);
            }
        };
        let known: HashMap<String, StoredDocument> = records::list_documents(&self.db, &source.id)?
            .into_iter()
            .map(|document| (document.document_id.clone(), document))
            .collect();
        let mut tally = SourceTally::default();
        for (index, entry) in entries.iter().enumerate() {
            let previous = known.get(&entry.document_id);
            match self.sync_document(context, source, entry, previous).await? {
                DocumentResult::Unchanged { passage_count } => {
                    tally.report.documents_unchanged += 1;
                    tally.document_count += 1;
                    tally.passage_count += passage_count;
                }
                DocumentResult::Indexed { passage_count } => {
                    tally.report.documents_indexed += 1;
                    tally.document_count += 1;
                    tally.passage_count += passage_count;
                }
                DocumentResult::Failed { message } => {
                    tally.report.documents_failed += 1;
                    tally.failures.push(if source.kind == SourceKind::Folder {
                        format!("{}: {message}", entry.display_name)
                    } else {
                        message
                    });
                    if let Some(previous) = previous {
                        tally.document_count += 1;
                        tally.passage_count += previous.passage_count;
                    }
                }
            }
            if entries.len() > 1 {
                self.send_source_updated(&source.id, Some(percent(index + 1, entries.len())));
            }
        }
        let listed: HashSet<&str> = entries.iter().map(|entry| entry.document_id.as_str()).collect();
        for document in known.values().filter(|document| !listed.contains(document.document_id.as_str())) {
            self.remove_document(context, &source.id, &document.document_id).await?;
            tally.report.documents_removed += 1;
        }
        records::finish_source(&self.db, &source.id, &tally.outcome(entries.len()), &now_rfc3339())?;
        self.send_source_updated(&source.id, None);
        Ok(tally.report)
    }

    /// Marks a source whose file or folder cannot be listed (moved, deleted, no access).
    fn finish_unreadable_source(&self, source: &KnowledgeSource, message: String) -> AppResult<SyncReport> {
        let outcome = SourceOutcome {
            status: SourceStatus::Failed,
            status_message: Some(message),
            document_count: source.document_count,
            failed_count: 1,
            passage_count: source.passage_count,
        };
        records::finish_source(&self.db, &source.id, &outcome, &now_rfc3339())?;
        self.send_source_updated(&source.id, None);
        Ok(SyncReport { documents_failed: 1, ..SyncReport::default() })
    }

    async fn remove_document(&self, context: &SyncContext<'_>, source_id: &str, document_id: &str) -> AppResult<()> {
        context
            .store
            .delete_document(&context.knowledge_base.id, document_id)
            .await
            .map_err(|error| AppError::Internal(format!("could not remove passages: {error}")))?;
        records::delete_document(&self.db, source_id, document_id)
    }

    async fn sync_document(
        &self,
        context: &SyncContext<'_>,
        source: &KnowledgeSource,
        entry: &SourceEntry,
        previous: Option<&StoredDocument>,
    ) -> AppResult<DocumentResult> {
        let loaded = match sources::load_entry(entry, &self.web).await {
            Ok(loaded) => loaded,
            Err(message) => return Ok(DocumentResult::Failed { message }),
        };
        let fingerprint = sources::fingerprint(&loaded.bytes);
        if let Some(previous) = previous.filter(|previous| previous.fingerprint == fingerprint) {
            return Ok(DocumentResult::Unchanged { passage_count: previous.passage_count });
        }
        let Some(embedder) = context.setup.embedder.clone() else {
            return Ok(DocumentResult::Failed { message: MISSING_OPENAI_KEY.to_owned() });
        };
        let text = match sources::extract_text(loaded).await {
            Ok(text) if text.trim().is_empty() => {
                return Ok(DocumentResult::Failed { message: "no text found (scanned pages need OCR first)".into() })
            }
            Ok(text) => text,
            Err(message) => return Ok(DocumentResult::Failed { message }),
        };
        let passage_count = match self.index_text(context, source, entry, text, embedder).await {
            Ok(passage_count) => passage_count,
            Err(message) => return Ok(DocumentResult::Failed { message }),
        };
        let document = StoredDocument { document_id: entry.document_id.clone(), fingerprint, passage_count };
        records::upsert_document(&self.db, &source.id, &document)?;
        Ok(DocumentResult::Indexed { passage_count })
    }

    /// Chunks, embeds and stores the text; returns the document's passage count.
    async fn index_text(
        &self,
        context: &SyncContext<'_>,
        source: &KnowledgeSource,
        entry: &SourceEntry,
        text: String,
        embedder: Arc<dyn Embedder>,
    ) -> Result<u64, String> {
        let knowledge_base_id = context.knowledge_base.id.as_str();
        let mut metadata = Metadata::new();
        metadata.insert(METADATA_SOURCE_ID.into(), serde_json::Value::String(source.id.clone()));
        metadata.insert(METADATA_SOURCE_NAME.into(), serde_json::Value::String(entry.display_name.clone()));
        let document = Document::new(knowledge_base_id, entry.document_id.clone(), text)
            .title(entry.display_name.clone())
            .metadata(metadata);
        let store: Arc<dyn VectorStore> = context.store.clone();
        Ingestor::new(store, embedder).ingest(&document).await.map_err(|error| error.to_string())?;
        let chunks = context
            .store
            .document_chunks(knowledge_base_id, &entry.document_id)
            .await
            .map_err(|error| error.to_string())?;
        Ok(u64::try_from(chunks.len()).unwrap_or(u64::MAX))
    }
}
