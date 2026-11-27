//! Knowledge types shared by storage, the sync engine, search and the Tauri
//! commands. Serialized camelCase for the frontend (`src/api/knowledgeTypes.ts`).

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Where a knowledge source comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// One local file (PDF, Word, Excel, CSV, Markdown, text...).
    File,
    /// Every supported file inside a local folder, recursively.
    Folder,
    /// One web page or document reachable over http(s).
    Url,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
            Self::Url => "url",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "file" => Ok(Self::File),
            "folder" => Ok(Self::Folder),
            "url" => Ok(Self::Url),
            other => Err(AppError::Internal(format!("unknown knowledge source kind `{other}`"))),
        }
    }
}

/// Indexing state of one source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    /// Added, waiting for the next sync.
    Pending,
    /// Being read and indexed right now.
    Reading,
    /// Searchable. `status_message` may still report files that failed.
    Indexed,
    /// Nothing could be indexed; `status_message` says why.
    Failed,
}

impl SourceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Reading => "reading",
            Self::Indexed => "indexed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "reading" => Ok(Self::Reading),
            "indexed" => Ok(Self::Indexed),
            "failed" => Ok(Self::Failed),
            other => Err(AppError::Internal(format!("unknown knowledge source status `{other}`"))),
        }
    }
}

/// How passages are turned into vectors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingChoice {
    /// graphrt-rag's offline hashing embedder plus BM25 keyword search: free,
    /// private, no key needed, but lexical (no synonyms or translation).
    Local,
    /// OpenAI `text-embedding-3-small` with the key from Settings, blended with
    /// BM25. Falls back to keyword-only search when the key is removed.
    Openai,
}

impl EmbeddingChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Openai => "openai",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "local" => Ok(Self::Local),
            "openai" => Ok(Self::Openai),
            other => Err(AppError::Internal(format!("unknown embedding choice `{other}`"))),
        }
    }
}

/// Retrieval settings of a knowledge base.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSettings {
    pub embedding: EmbeddingChoice,
    /// Default number of passages an agent receives (1 to 20).
    pub passages_per_answer: u32,
    /// Passages scoring below this (0 to 1) are not given to agents.
    pub min_score: f64,
    /// Whether agents should cite the source in their answers.
    pub show_sources: bool,
}

/// Highest `passages_per_answer` accepted.
pub const MAX_PASSAGES_PER_ANSWER: u32 = 20;

impl KnowledgeSettings {
    /// Defaults for a new knowledge base using `embedding`.
    pub fn with_embedding(embedding: EmbeddingChoice) -> Self {
        Self { embedding, passages_per_answer: 4, min_score: 0.0, show_sources: true }
    }

    /// # Errors
    /// `InvalidInput` when a value is out of range.
    pub fn validate(&self) -> AppResult<()> {
        if !(1..=MAX_PASSAGES_PER_ANSWER).contains(&self.passages_per_answer) {
            return Err(AppError::InvalidInput(format!(
                "passages per answer must be between 1 and {MAX_PASSAGES_PER_ANSWER}"
            )));
        }
        if !self.min_score.is_finite() || !(0.0..=1.0).contains(&self.min_score) {
            return Err(AppError::InvalidInput("the minimum score must be between 0 and 1".into()));
        }
        Ok(())
    }
}

/// Overall state of a knowledge base, derived from its sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeBaseStatus {
    /// No sources yet.
    Empty,
    /// A sync is running.
    Syncing,
    /// Every source is indexed.
    UpToDate,
    /// At least one source (or file in it) failed, or is still pending.
    NeedsAttention,
}

/// Progress of a running sync, in sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub done: u32,
    pub total: u32,
}

/// An agent whose workflow refers to a knowledge base.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeUsage {
    pub agent_id: String,
    pub agent_name: String,
}

/// A knowledge base as listed in the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub description: String,
    pub settings: KnowledgeSettings,
    pub status: KnowledgeBaseStatus,
    pub sync_progress: Option<SyncProgress>,
    pub source_count: u32,
    pub file_count: u32,
    pub website_count: u32,
    pub passage_count: u64,
    /// Size of the passage store on disk.
    pub storage_bytes: u64,
    pub used_by: Vec<KnowledgeUsage>,
    pub last_synced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One source inside a knowledge base.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSource {
    pub id: String,
    pub knowledge_base_id: String,
    pub kind: SourceKind,
    /// Absolute path or URL.
    pub location: String,
    /// Display name (file or folder name, or the page address without scheme).
    pub name: String,
    pub status: SourceStatus,
    /// Why the source failed, or which of its files did.
    pub status_message: Option<String>,
    /// Files (or pages) indexed from this source.
    pub document_count: u32,
    /// Files that could not be read during the last sync.
    pub failed_count: u32,
    pub passage_count: u64,
    pub last_synced_at: Option<String>,
    pub created_at: String,
    /// Set for sources that sync from a web site, an API, Google Drive, Notion
    /// or SharePoint (see `knowledge::connectors`).
    #[serde(default)]
    pub connector: Option<Box<super::connectors::ConnectorView>>,
}

/// A knowledge base with its sources (screen 18).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseDetail {
    pub knowledge_base: KnowledgeBase,
    pub sources: Vec<KnowledgeSource>,
}

/// One search result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePassage {
    pub id: String,
    pub knowledge_base_id: String,
    pub knowledge_base_name: String,
    pub source_id: Option<String>,
    pub source_name: String,
    /// Section heading path or "Passage N" inside the file.
    pub location: Option<String>,
    pub text: String,
    /// Relevance between 0 and 1 (higher is better).
    pub score: f32,
}

/// What a sync did, for logs and tests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncReport {
    /// Files read, extracted and (re-)indexed.
    pub documents_indexed: u32,
    /// Files whose content had not changed since the last sync (not re-read).
    pub documents_unchanged: u32,
    /// Files no longer in their source, removed from the index.
    pub documents_removed: u32,
    pub documents_failed: u32,
}

impl SyncReport {
    pub fn add(&mut self, other: SyncReport) {
        self.documents_indexed += other.documents_indexed;
        self.documents_unchanged += other.documents_unchanged;
        self.documents_removed += other.documents_removed;
        self.documents_failed += other.documents_failed;
    }
}
