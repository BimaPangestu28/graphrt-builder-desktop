//! What indexing produced: the documents of a source and, per document, its
//! passages in document order, a page at a time (large PDFs have thousands).

use std::path::Path;

use graphrt_rag::{estimate_tokens, StoredChunk, VectorStore, CHAR_END_KEY, CHAR_START_KEY};

use super::models::{
    ChunkingSettings, KnowledgeChunk, KnowledgeChunkPage, KnowledgeDocument, KnowledgeSource, SourceKind,
};
use super::records::{self, StoredDocument};
use super::retrieval::passage_pages;
use super::{stores, KnowledgeService};
use crate::error::{AppError, AppResult};

/// Most passages one page returns.
pub const MAX_CHUNK_PAGE: usize = 100;

fn to_u64(count: usize) -> u64 {
    u64::try_from(count).unwrap_or(u64::MAX)
}

/// Display name of a document: the source's name, or the file's path inside a folder.
fn document_name(source: &KnowledgeSource, document_id: &str) -> String {
    match source.kind {
        SourceKind::Folder => document_id
            .strip_prefix(source.id.as_str())
            .and_then(|rest| rest.strip_prefix('/'))
            .filter(|relative| !relative.is_empty())
            .map_or_else(|| source.name.clone(), str::to_owned),
        SourceKind::File | SourceKind::Url => source.name.clone(),
    }
}

fn to_document(
    source: &KnowledgeSource,
    stored: StoredDocument,
    current_key: &str,
    default_key: &str,
) -> KnowledgeDocument {
    let indexed_with = stored.chunking_key.as_deref().unwrap_or(default_key);
    KnowledgeDocument {
        source_id: source.id.clone(),
        name: document_name(source, &stored.document_id),
        needs_reindex: indexed_with != current_key,
        document_id: stored.document_id,
        passage_count: stored.passage_count,
        indexed_at: stored.indexed_at,
    }
}

fn metadata_u64(chunk: &StoredChunk, key: &str) -> Option<u64> {
    chunk.metadata.get(key).and_then(serde_json::Value::as_u64)
}

fn to_chunk(chunk: StoredChunk) -> KnowledgeChunk {
    let char_count = chunk.text.chars().count();
    KnowledgeChunk {
        index: metadata_u64(&chunk, "chunk_index").unwrap_or(u64::MAX),
        char_count: to_u64(char_count),
        token_count: to_u64(estimate_tokens(&chunk.text)),
        char_start: metadata_u64(&chunk, CHAR_START_KEY),
        char_end: metadata_u64(&chunk, CHAR_END_KEY),
        heading: chunk
            .metadata
            .get("heading")
            .and_then(serde_json::Value::as_str)
            .filter(|heading| !heading.trim().is_empty())
            .map(str::to_owned),
        pages: passage_pages(&chunk.metadata),
        id: chunk.id,
        text: chunk.text,
    }
}

/// Case-insensitive match of every word of `filter` in the passage text or heading.
fn matches_filter(chunk: &KnowledgeChunk, words: &[String]) -> bool {
    if words.is_empty() {
        return true;
    }
    let haystack = format!("{} {}", chunk.heading.as_deref().unwrap_or_default(), chunk.text).to_lowercase();
    words.iter().all(|word| haystack.contains(word.as_str()))
}

/// The page of `chunks` (already in document order) at `offset`, filtered.
pub(super) fn page_of(
    document: KnowledgeDocument,
    chunks: Vec<StoredChunk>,
    filter: &str,
    offset: usize,
    limit: usize,
) -> KnowledgeChunkPage {
    let words: Vec<String> = filter.split_whitespace().map(str::to_lowercase).collect();
    let total = chunks.len();
    let (mut total_chars, mut total_tokens) = (0u64, 0u64);
    let mut matching = 0usize;
    let mut page = Vec::new();
    let limit = limit.clamp(1, MAX_CHUNK_PAGE);
    for chunk in chunks.into_iter().map(to_chunk) {
        total_chars = total_chars.saturating_add(chunk.char_count);
        total_tokens = total_tokens.saturating_add(chunk.token_count);
        if !matches_filter(&chunk, &words) {
            continue;
        }
        if matching >= offset && page.len() < limit {
            page.push(chunk);
        }
        matching += 1;
    }
    KnowledgeChunkPage {
        document,
        total: to_u64(total),
        matching: to_u64(matching),
        offset: to_u64(offset.min(matching)),
        chunks: page,
        total_chars,
        total_tokens,
    }
}

impl KnowledgeService {
    /// The indexed documents of a source, by name.
    ///
    /// # Errors
    /// `NotFound` for an unknown source.
    pub fn list_source_documents(&self, source_id: &str) -> AppResult<Vec<KnowledgeDocument>> {
        let source = records::get_source(&self.db, source_id)?;
        let knowledge_base = records::get_knowledge_base(&self.db, &source.knowledge_base_id)?;
        let current_key = knowledge_base.settings.chunking.key()?;
        let default_key = ChunkingSettings::default().key()?;
        let mut documents: Vec<KnowledgeDocument> = records::list_documents(&self.db, source_id)?
            .into_iter()
            .map(|stored| to_document(&source, stored, &current_key, &default_key))
            .collect();
        documents.sort_by_key(|document| document.name.to_lowercase());
        Ok(documents)
    }

    /// One page of a document's passages, in document order, optionally only
    /// those containing every word of `filter`.
    ///
    /// # Errors
    /// `NotFound` for an unknown source or document, `Internal` when the store cannot be read.
    pub async fn list_document_chunks(
        &self,
        source_id: &str,
        document_id: &str,
        filter: &str,
        offset: usize,
        limit: usize,
    ) -> AppResult<KnowledgeChunkPage> {
        let document = self
            .list_source_documents(source_id)?
            .into_iter()
            .find(|document| document.document_id == document_id)
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let source = records::get_source(&self.db, source_id)?;
        let knowledge_base = records::get_knowledge_base(&self.db, &source.knowledge_base_id)?;
        let store = stores::open_store(Path::new(&knowledge_base.store_path))?;
        let mut chunks = store
            .document_chunks(&knowledge_base.id, document_id)
            .await
            .map_err(|error| AppError::Internal(format!("could not read the passages: {error}")))?;
        chunks.sort_by_key(|chunk| metadata_u64(chunk, "chunk_index").unwrap_or(u64::MAX));
        Ok(page_of(document, chunks, filter, offset, limit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_chunk(index: usize, text: &str) -> StoredChunk {
        let mut metadata = graphrt_rag::Metadata::new();
        metadata.insert("chunk_index".into(), serde_json::Value::from(index));
        metadata.insert(CHAR_START_KEY.into(), serde_json::Value::from(index * 10));
        metadata.insert(CHAR_END_KEY.into(), serde_json::Value::from(index * 10 + text.chars().count()));
        metadata.insert(graphrt_rag::PAGE_KEY.into(), serde_json::Value::from(index + 1));
        StoredChunk {
            id: format!("kb:doc:{index}"),
            dataset_id: "kb".into(),
            document_id: "doc".into(),
            title: "doc".into(),
            text: text.into(),
            metadata,
            content_hash: String::new(),
            vector: Vec::new(),
        }
    }

    fn document() -> KnowledgeDocument {
        KnowledgeDocument {
            source_id: "src".into(),
            document_id: "doc".into(),
            name: "menu.pdf".into(),
            passage_count: 5,
            indexed_at: None,
            needs_reindex: false,
        }
    }

    #[test]
    fn pages_through_chunks_and_counts_the_whole_document() {
        let chunks: Vec<StoredChunk> = (0..5).map(|index| stored_chunk(index, "abcdefgh")).collect();
        let page = page_of(document(), chunks, "", 2, 2);
        assert_eq!((page.total, page.matching, page.offset), (5, 5, 2));
        assert_eq!(page.chunks.iter().map(|chunk| chunk.index).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!((page.total_chars, page.total_tokens), (40, 10));
        let chunk = &page.chunks[0];
        assert_eq!((chunk.char_start, chunk.char_end, chunk.token_count), (Some(20), Some(28), 2));
        assert_eq!(chunk.pages, vec![3]);
    }

    #[test]
    fn filter_matches_every_word_ignoring_case() {
        let chunks = vec![
            stored_chunk(0, "Delivery is free above 50 boxes"),
            stored_chunk(1, "Opening hours"),
            stored_chunk(2, "Free DELIVERY on Sundays"),
        ];
        let page = page_of(document(), chunks, "  free delivery ", 0, 10);
        assert_eq!((page.total, page.matching), (3, 2));
        assert_eq!(page.chunks.iter().map(|chunk| chunk.index).collect::<Vec<_>>(), vec![0, 2]);
    }

    #[test]
    fn offset_past_the_end_returns_an_empty_page() {
        let page = page_of(document(), vec![stored_chunk(0, "one")], "", 10, 500);
        assert!(page.chunks.is_empty());
        assert_eq!(page.offset, 1);
    }

    #[test]
    fn folder_documents_are_named_by_their_path() {
        let source = KnowledgeSource {
            id: "src_1".into(),
            knowledge_base_id: "kb".into(),
            kind: SourceKind::Folder,
            location: "/docs".into(),
            name: "docs".into(),
            status: super::super::models::SourceStatus::Indexed,
            status_message: None,
            document_count: 1,
            failed_count: 0,
            passage_count: 1,
            last_synced_at: None,
            created_at: String::new(),
            connector: None,
        };
        assert_eq!(document_name(&source, "src_1/menu/price.pdf"), "menu/price.pdf");
        assert_eq!(document_name(&source, "src_1"), "docs");
    }
}
