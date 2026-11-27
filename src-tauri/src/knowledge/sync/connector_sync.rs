//! Syncing a connector source (web site, API, Google Drive, Notion,
//! SharePoint) through the app's own indexing.
//!
//! The connector lists the items with a version (ETag, revision, modified
//! time, sitemap `lastmod`); an item listed with the version it was indexed
//! with is not even downloaded. Without a version the content hash decides.
//! New and changed items go through the same extraction, chunking and
//! embedding as files ([`KnowledgeService::index_text`]). Items gone from a
//! complete listing are removed; an incomplete listing removes nothing.
//!
//! While a source syncs, its lock in the sync state file next to the
//! knowledge store (`<store>.sync`, graphrt-connect's `SqliteSyncState`) is
//! held, so `graphrt serve` on the same knowledge base never syncs it at the
//! same time.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use futures::StreamExt;
use graphrt_connect::{Connector, ItemContent, RemoteItem, SqliteSyncState, SyncState};

use super::super::connectors::{self, find_connector, set_last_error_kind};
use super::super::models::{KnowledgeSource, SourceStatus, SyncProgress, SyncReport};
use super::super::records::{self, StoredDocument};
use super::super::sources::{self, EntryOrigin, LoadedDocument, SourceEntry};
use super::super::stores::EmbeddingKeys;
use super::{SourceTally, SyncContext, MISSING_OPENAI_KEY};
use crate::error::{AppError, AppResult};
use crate::knowledge::events::KnowledgeEvent;
use crate::knowledge::KnowledgeService;
use crate::storage::now_rfc3339;

/// Items fetched at the same time.
const FETCH_CONCURRENCY: usize = 4;
/// How long the lock holds without a renewal.
const LOCK_SECONDS: i64 = 600;

/// The document id of an item inside the knowledge base.
fn document_id(source_id: &str, item: &RemoteItem) -> String {
    graphrt_connect::document_id(source_id, &item.id)
}

/// What decides whether an item changed: its version, else its content.
fn version_fingerprint(item: &RemoteItem) -> Option<String> {
    item.version.as_ref().map(|version| format!("v:{version}"))
}

fn loaded_document(item: &RemoteItem, content: ItemContent) -> LoadedDocument {
    match content {
        ItemContent::Text(text) => LoadedDocument {
            bytes: text.into_bytes(),
            mime_type: Some("text/markdown".into()),
            file_name: "item.md".into(),
        },
        ItemContent::File { bytes, mime_type, file_name } => LoadedDocument {
            bytes,
            mime_type,
            file_name: if file_name.is_empty() { item.title.clone() } else { file_name },
        },
    }
}

/// Holds the source's lock in the shared sync state and releases it when dropped.
struct SourceLock {
    state: SqliteSyncState,
    source_id: String,
    holder: String,
}

impl SourceLock {
    fn take(store_path: &str, source_id: &str) -> AppResult<Option<Self>> {
        let path = SqliteSyncState::path_beside(Path::new(store_path));
        let state = SqliteSyncState::open(&path).map_err(|error| AppError::Internal(error.to_string()))?;
        let holder = format!("graphrt-desktop:{}", std::process::id());
        let now = chrono::Utc::now().timestamp();
        let taken = state
            .try_lock(source_id, &holder, now, now + LOCK_SECONDS)
            .map_err(|error| AppError::Internal(error.to_string()))?;
        Ok(taken.then(|| Self { state, source_id: source_id.to_owned(), holder }))
    }

    fn renew(&self) {
        let now = chrono::Utc::now().timestamp();
        let _renewed = self.state.try_lock(&self.source_id, &self.holder, now, now + LOCK_SECONDS);
    }
}

impl Drop for SourceLock {
    fn drop(&mut self) {
        let _released = self.state.unlock(&self.source_id, &self.holder);
    }
}

impl KnowledgeService {
    /// Syncs some sources of a knowledge base (the scheduler's due sources, or
    /// "Sync now" on one source). When the knowledge base is already syncing,
    /// that sync runs once more instead (covering every source).
    ///
    /// # Errors
    /// `NotFound` for an unknown knowledge base; database and store failures.
    pub async fn sync_sources(&self, knowledge_base_id: &str, source_ids: &[String]) -> AppResult<SyncReport> {
        records::get_knowledge_base(&self.db, knowledge_base_id)?;
        if !self.tracker.begin(knowledge_base_id)? {
            return Ok(SyncReport::default());
        }
        let only: HashSet<&str> = source_ids.iter().map(String::as_str).collect();
        let mut outcome = self.sync_selected_once(knowledge_base_id, &only).await;
        while self.tracker.finish(knowledge_base_id) {
            // Someone asked for a full sync meanwhile.
            outcome = self.sync_once(knowledge_base_id).await;
        }
        self.send_sync_finished(knowledge_base_id);
        outcome
    }

    async fn sync_selected_once(&self, knowledge_base_id: &str, only: &HashSet<&str>) -> AppResult<SyncReport> {
        let Some(knowledge_base) = records::find_knowledge_base(&self.db, knowledge_base_id)? else {
            return Ok(SyncReport::default());
        };
        self.sink.send(KnowledgeEvent::SyncStarted { knowledge_base_id: knowledge_base_id.to_owned() });
        let sources: Vec<KnowledgeSource> = records::list_sources(&self.db, knowledge_base_id)?
            .into_iter()
            .filter(|source| only.contains(source.id.as_str()))
            .collect();
        let keys = EmbeddingKeys::load(&self.credentials, [knowledge_base.settings.embedding])?;
        let context = SyncContext::new(&knowledge_base, &keys)?;
        let total = u32::try_from(sources.len()).unwrap_or(u32::MAX);
        self.tracker.set_progress(knowledge_base_id, SyncProgress { done: 0, total });
        let mut report = SyncReport::default();
        for (index, source) in sources.iter().enumerate() {
            report.add(self.sync_source(&context, source).await?);
            self.tracker.set_progress(
                knowledge_base_id,
                SyncProgress { done: u32::try_from(index + 1).unwrap_or(u32::MAX), total },
            );
        }
        Ok(report)
    }

    /// Syncs one connector source (called by `sync_source` for sources with a connector).
    pub(super) async fn sync_connector_source(
        &self,
        context: &SyncContext<'_>,
        source: &KnowledgeSource,
    ) -> AppResult<SyncReport> {
        let Some(stored) = find_connector(&self.db, &source.id)? else {
            return self.finish_unreadable_source(source, "the connector settings are missing".into());
        };
        records::set_source_status(&self.db, &source.id, SourceStatus::Reading)?;
        self.send_source_updated(&source.id, Some(0));
        let Some(lock) = SourceLock::take(&context.knowledge_base.store_path, &source.id)? else {
            // Another process (graphrt serve on this knowledge base) is syncing it right now.
            records::set_source_status(&self.db, &source.id, source.status)?;
            set_last_error_kind(&self.db, &source.id, Some("busy"))?;
            self.send_source_updated(&source.id, None);
            return Ok(SyncReport::default());
        };
        let connector = match connectors::build_connector(&self.credentials, &source.id, &stored) {
            Ok(connector) => connector,
            Err(error) => return self.connector_failed(source, &error),
        };
        let listing = match connector.list().await {
            Ok(listing) => listing,
            Err(error) => return self.connector_failed(source, &error),
        };
        lock.renew();
        let report = self.index_listing(context, source, connector.as_ref(), listing, &lock).await?;
        drop(lock);
        Ok(report)
    }

    fn connector_failed(
        &self,
        source: &KnowledgeSource,
        error: &graphrt_connect::ConnectError,
    ) -> AppResult<SyncReport> {
        set_last_error_kind(&self.db, &source.id, Some(error.kind()))?;
        self.finish_unreadable_source(source, error.to_string())
    }

    async fn index_listing(
        &self,
        context: &SyncContext<'_>,
        source: &KnowledgeSource,
        connector: &dyn Connector,
        listing: graphrt_connect::Listing,
        lock: &SourceLock,
    ) -> AppResult<SyncReport> {
        let known: HashMap<String, StoredDocument> = records::list_documents(&self.db, &source.id)?
            .into_iter()
            .map(|document| (document.document_id.clone(), document))
            .collect();
        let mut tally = SourceTally::default();
        let mut listed: HashSet<String> = HashSet::new();
        let mut to_fetch: Vec<&RemoteItem> = Vec::new();
        for item in &listing.items {
            let id = document_id(&source.id, item);
            if !listed.insert(id.clone()) {
                continue;
            }
            match (known.get(&id), version_fingerprint(item)) {
                (Some(previous), Some(fingerprint)) if context.is_unchanged(previous, &fingerprint) => {
                    tally.report.documents_unchanged += 1;
                    tally.document_count += 1;
                    tally.passage_count += previous.passage_count;
                }
                _ => to_fetch.push(item),
            }
        }
        let total = to_fetch.len();
        // Downloads run a few at a time; indexing (embedding) one at a time, in order.
        type Fetched<'a> = (&'a RemoteItem, Result<ItemContent, graphrt_connect::ConnectError>);
        // Boxed so the stream's type carries no closure lifetimes (keeps the sync future `Send`).
        let downloads: Vec<futures::future::BoxFuture<'_, Fetched<'_>>> = to_fetch
            .into_iter()
            .map(|item| -> futures::future::BoxFuture<'_, Fetched<'_>> {
                Box::pin(async move {
                    let content = match &item.content {
                        Some(content) => Ok(content.clone()),
                        None => connector.fetch(item).await,
                    };
                    (item, content)
                })
            })
            .collect();
        let mut fetched = futures::stream::iter(downloads).buffered(FETCH_CONCURRENCY);
        let mut done = 0usize;
        while let Some((item, content)) = fetched.next().await {
            done += 1;
            let id = document_id(&source.id, item);
            let previous = known.get(&id);
            match content {
                Ok(content) => match self.index_item(context, source, item, &id, previous, content).await? {
                    Ok(passages) => {
                        if passages.1 {
                            tally.report.documents_indexed += 1;
                        } else {
                            tally.report.documents_unchanged += 1;
                        }
                        tally.document_count += 1;
                        tally.passage_count += passages.0;
                    }
                    Err(message) => self.count_failure(&mut tally, item, previous, message),
                },
                Err(error) => self.count_failure(&mut tally, item, previous, error.to_string()),
            }
            lock.renew();
            if total > 1 {
                self.send_source_updated(&source.id, Some(super::percent(done, total)));
            }
        }
        drop(fetched);
        if listing.complete {
            for document in known.values().filter(|document| !listed.contains(&document.document_id)) {
                self.remove_document(context, &source.id, &document.document_id).await?;
                tally.report.documents_removed += 1;
            }
        }
        let mut outcome = tally.outcome(listing.items.len());
        if listing.items.is_empty() {
            outcome.status = SourceStatus::Indexed;
            outcome.status_message = Some("nothing to index was found at this source".into());
        }
        if outcome.status_message.is_none() {
            outcome.status_message = listing.warnings.first().cloned();
        }
        records::finish_source(&self.db, &source.id, &outcome, &now_rfc3339())?;
        let error_kind = (outcome.status == SourceStatus::Failed).then_some("items_failed");
        set_last_error_kind(&self.db, &source.id, error_kind)?;
        self.send_source_updated(&source.id, None);
        Ok(tally.report)
    }

    fn count_failure(
        &self,
        tally: &mut SourceTally,
        item: &RemoteItem,
        previous: Option<&StoredDocument>,
        message: String,
    ) {
        tally.report.documents_failed += 1;
        tally.failures.push(format!("{}: {message}", item.title));
        if let Some(previous) = previous {
            // The previous version stays searchable.
            tally.document_count += 1;
            tally.passage_count += previous.passage_count;
        }
    }

    /// Indexes one fetched item. `Ok(Err(message))` for a problem with the
    /// item itself, `Ok(Ok((passages, indexed)))` otherwise.
    async fn index_item(
        &self,
        context: &SyncContext<'_>,
        source: &KnowledgeSource,
        item: &RemoteItem,
        document_id: &str,
        previous: Option<&StoredDocument>,
        content: ItemContent,
    ) -> AppResult<Result<(u64, bool), String>> {
        let fingerprint =
            version_fingerprint(item).unwrap_or_else(|| format!("h:{}", graphrt_connect::content_hash(&content)));
        let hash_fingerprint = format!("h:{}", graphrt_connect::content_hash(&content));
        let same_content = |p: &&StoredDocument| p.fingerprint == fingerprint || p.fingerprint == hash_fingerprint;
        if let Some(previous) = previous.filter(same_content).filter(|p| context.same_chunking(p)) {
            records::upsert_document(&self.db, &source.id, &StoredDocument { fingerprint, ..previous.clone() })?;
            return Ok(Ok((previous.passage_count, false)));
        }
        let Some(embedder) = context.setup.embedder.clone() else {
            return Ok(Err(MISSING_OPENAI_KEY.to_owned()));
        };
        let text = match sources::extract_text(loaded_document(item, content)).await {
            Ok(text) if text.trim().is_empty() => return Ok(Err("no text found".into())),
            Ok(text) => text,
            Err(message) => return Ok(Err(message)),
        };
        let entry = SourceEntry {
            document_id: document_id.to_owned(),
            display_name: item.title.clone(),
            origin: EntryOrigin::Url(item.url.clone().unwrap_or_else(|| item.id.clone())),
        };
        let passage_count = match self.index_text(context, source, &entry, text, Arc::clone(&embedder)).await {
            Ok(count) => count,
            Err(message) => return Ok(Err(message)),
        };
        records::upsert_document(
            &self.db,
            &source.id,
            &context.indexed_document(document_id, fingerprint, passage_count),
        )?;
        Ok(Ok((passage_count, true)))
    }
}
