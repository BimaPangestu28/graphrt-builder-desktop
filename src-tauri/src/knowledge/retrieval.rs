//! Searching knowledge bases through graphrt-rag, for the app's search box and
//! for the `knowledge-retrieval` node in agent runs.
//!
//! Every knowledge base becomes one graphrt dataset (id = knowledge base id,
//! also reachable by its exact name) served by [`KnowledgeBaseRetriever`]: the
//! built-in store pipeline with the knowledge base's own embedder and hybrid
//! weights, and a keyword-only (BM25) fallback when its embedding provider
//! has no key or cannot be reached.

use std::path::PathBuf;
use std::sync::Arc;

use futures::future::BoxFuture;
use graphrt_rag::{DatasetInfo, Hit, HybridWeights, RagError, RetrievalRequest, Retriever, StoreRetriever};

use super::models::KnowledgePassage;
use super::records::{self, StoredKnowledgeBase};
use super::stores::{open_store, EmbeddingKeys, EmbeddingSetup};
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::storage::Database;

/// graphrt node kind that searches knowledge bases.
pub const KNOWLEDGE_RETRIEVAL_KIND: &str = graphrt_rag::KIND;

/// Chunk metadata keys written at ingestion.
pub(super) const METADATA_SOURCE_ID: &str = "source_id";
pub(super) const METADATA_SOURCE_NAME: &str = "source_name";

/// One knowledge base as a graphrt [`Retriever`].
#[derive(Debug)]
pub struct KnowledgeBaseRetriever {
    /// The knowledge base id, which is the graphrt dataset id in its store
    /// (requests may arrive under the name alias).
    knowledge_base_id: String,
    store_path: PathBuf,
    setup: EmbeddingSetup,
    /// Drops hits below the knowledge base's "Ignore matches below" setting
    /// (agent runs). The app's own search keeps them to show weak matches.
    min_score: Option<f32>,
}

impl KnowledgeBaseRetriever {
    async fn retrieve_with(&self, request: &RetrievalRequest, weights: HybridWeights) -> Result<Vec<Hit>, RagError> {
        let store = open_store(&self.store_path).map_err(|error| RagError::Store(error.to_string()))?;
        let pipeline = StoreRetriever::new(store, self.setup.embedder_or_placeholder());
        // These datasets have no reranker; graphrt rejects reranking requests for them.
        let request = RetrievalRequest {
            datasets: vec![self.knowledge_base_id.clone()],
            weights,
            rerank: false,
            ..request.clone()
        };
        pipeline.retrieve(&request).await
    }
}

/// Failures of the embedding provider, after which keyword search still works.
fn is_embedding_unavailable(error: &RagError) -> bool {
    matches!(error, RagError::Auth(_) | RagError::Network(_) | RagError::RateLimit { .. } | RagError::Http { .. })
}

impl Retriever for KnowledgeBaseRetriever {
    fn retrieve<'a>(&'a self, request: &'a RetrievalRequest) -> BoxFuture<'a, Result<Vec<Hit>, RagError>> {
        Box::pin(async move {
            let weights = self.setup.effective_weights(request.weights);
            let mut hits = match self.retrieve_with(request, weights).await {
                Err(error) if weights.vector > 0.0 && is_embedding_unavailable(&error) => {
                    log::warn!("knowledge search fell back to keywords only: {error}");
                    self.retrieve_with(request, HybridWeights { vector: 0.0, keyword: 1.0 }).await?
                }
                other => other?,
            };
            if let Some(min_score) = self.min_score {
                hits.retain(|hit| hit.score >= min_score);
            }
            Ok(hits)
        })
    }
}

/// Builds the graphrt knowledge service over `knowledge_bases`.
///
/// # Errors
/// `Internal` when an embedder cannot be built.
pub fn build_knowledge_service(
    knowledge_bases: &[StoredKnowledgeBase],
    keys: &EmbeddingKeys,
    apply_min_score: bool,
) -> AppResult<graphrt_rag::KnowledgeBase> {
    let mut service = graphrt_rag::KnowledgeBase::new();
    for knowledge_base in knowledge_bases {
        let min_score = knowledge_base.settings.min_score;
        let retriever: Arc<dyn Retriever> = Arc::new(KnowledgeBaseRetriever {
            knowledge_base_id: knowledge_base.id.clone(),
            store_path: PathBuf::from(&knowledge_base.store_path),
            setup: keys.setup_for(knowledge_base.settings.embedding)?,
            // Scores are f32 in graphrt; the setting is stored as f64 (0 to 1).
            min_score: (apply_min_score && min_score > 0.0).then_some(min_score as f32),
        });
        let info = DatasetInfo {
            id: knowledge_base.id.clone(),
            name: knowledge_base.name.clone(),
            description: knowledge_base.description.clone(),
        };
        service.add_retriever(info.clone(), retriever.clone());
        // Let workflows written by hand name the knowledge base instead of its id.
        if !service.contains(&knowledge_base.name) {
            service.add_retriever(DatasetInfo { id: knowledge_base.name.clone(), ..info }, retriever);
        }
    }
    Ok(service)
}

/// The knowledge service registered for agent runs: every knowledge base,
/// with "Ignore matches below" applied. Stores open on first search, so runs
/// that never retrieve cost one small database query.
///
/// # Errors
/// `Database` when the knowledge bases cannot be listed.
pub fn knowledge_service_for_runs(
    db: &Database,
    credentials: &CredentialStore,
) -> AppResult<graphrt_rag::KnowledgeBase> {
    let knowledge_bases = records::list_knowledge_bases(db)?;
    let keys = match EmbeddingKeys::load(credentials, knowledge_bases.iter().map(|base| base.settings.embedding)) {
        Ok(keys) => keys,
        Err(error) => {
            log::warn!("could not read the embedding key, knowledge search will use keywords only: {error}");
            EmbeddingKeys::default()
        }
    };
    build_knowledge_service(&knowledge_bases, &keys, true)
}

/// PDF pages a passage comes from (graphrt-rag `page` / `pages` metadata),
/// ascending; empty for other files and passages indexed before page numbers.
pub fn passage_pages(metadata: &serde_json::Map<String, serde_json::Value>) -> Vec<u32> {
    let as_page = |value: &serde_json::Value| value.as_u64().and_then(|page| u32::try_from(page).ok());
    let mut pages: Vec<u32> = match metadata.get(graphrt_rag::PAGES_KEY).and_then(serde_json::Value::as_array) {
        Some(pages) => pages.iter().filter_map(as_page).collect(),
        None => metadata.get(graphrt_rag::PAGE_KEY).and_then(as_page).into_iter().collect(),
    };
    pages.sort_unstable();
    pages.dedup();
    pages
}

/// A source as people read it: `menu.pdf · p3, p12`, or just the name without pages.
pub fn source_label(source_name: &str, pages: &[u32]) -> String {
    if pages.is_empty() {
        return source_name.to_owned();
    }
    let pages: Vec<String> = pages.iter().map(|page| format!("p{page}")).collect();
    format!("{source_name} · {}", pages.join(", "))
}

fn metadata_text(hit: &Hit, key: &str) -> Option<String> {
    hit.metadata.get(key).and_then(serde_json::Value::as_str).map(str::to_owned)
}

/// Where the passage is in its file: section heading and PDF pages
/// (`Delivery · Page 3, 4`), either one alone, or its position when neither is known.
fn passage_location(hit: &Hit) -> Option<String> {
    let heading = metadata_text(hit, "heading").filter(|heading| !heading.trim().is_empty());
    let pages = passage_pages(&hit.metadata);
    let pages = (!pages.is_empty())
        .then(|| format!("Page {}", pages.iter().map(u32::to_string).collect::<Vec<_>>().join(", ")));
    match (heading, pages) {
        (Some(heading), Some(pages)) => Some(format!("{heading} · {pages}")),
        (Some(heading), None) => Some(heading),
        (None, Some(pages)) => Some(pages),
        (None, None) => hit
            .metadata
            .get("chunk_index")
            .and_then(serde_json::Value::as_u64)
            .map(|index| format!("Passage {}", index + 1)),
    }
}

/// Converts a graphrt hit into the UI's passage.
pub fn passage_from_hit(hit: Hit, knowledge_bases: &[StoredKnowledgeBase]) -> KnowledgePassage {
    let knowledge_base_name = knowledge_bases
        .iter()
        .find(|knowledge_base| knowledge_base.id == hit.dataset_id)
        .map(|knowledge_base| knowledge_base.name.clone())
        .unwrap_or_default();
    KnowledgePassage {
        location: passage_location(&hit),
        source_id: metadata_text(&hit, METADATA_SOURCE_ID),
        source_name: metadata_text(&hit, METADATA_SOURCE_NAME).unwrap_or_else(|| hit.title.clone()),
        knowledge_base_name,
        knowledge_base_id: hit.dataset_id,
        id: hit.id,
        text: hit.content,
        score: hit.score,
    }
}
