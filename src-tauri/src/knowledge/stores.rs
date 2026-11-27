//! graphrt-rag stores and embedders for knowledge bases.
//!
//! Each knowledge base keeps its passages in its own graphrt-rag
//! [`SqliteStore`] file (`<app data>/knowledge/<id>.sqlite`), with the
//! knowledge base id as the graphrt dataset id. One file per knowledge base
//! keeps deleting simple (remove the file) and means only the knowledge bases
//! actually searched are loaded into memory (`SqliteStore` mirrors its file in
//! an in-process index).
//!
//! Opening a store loads every passage, so open stores are cached for the
//! whole process and shared by the knowledge commands and agent runs.
//! `SqliteStore` reloads its index when another connection commits, so a
//! cached store never serves stale passages.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use graphrt_rag::{Embedder, HashEmbedder, HybridWeights, OpenAiEmbedder, OpenAiEmbedderConfig, Secret, SqliteStore};

use super::models::EmbeddingChoice;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::error::{AppError, AppResult};

/// Dimensions of the offline hashing embedder.
pub(super) const LOCAL_EMBEDDING_DIMENSIONS: usize = 512;
/// OpenAI embedding model used when a knowledge base chooses OpenAI.
pub const OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-small";
pub(super) const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

/// Process-wide cache of open stores, keyed by file path.
fn open_stores() -> &'static Mutex<HashMap<PathBuf, Arc<SqliteStore>>> {
    static OPEN_STORES: OnceLock<Mutex<HashMap<PathBuf, Arc<SqliteStore>>>> = OnceLock::new();
    OPEN_STORES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_open_stores() -> AppResult<std::sync::MutexGuard<'static, HashMap<PathBuf, Arc<SqliteStore>>>> {
    open_stores().lock().map_err(|_| AppError::Internal("knowledge store cache lock poisoned".into()))
}

/// The store at `store_path`, opened (and created) on first use.
///
/// # Errors
/// `Internal` when the file cannot be opened or was written by an unsupported version.
pub fn open_store(store_path: &Path) -> AppResult<Arc<SqliteStore>> {
    let mut stores = lock_open_stores()?;
    if let Some(store) = stores.get(store_path) {
        return Ok(store.clone());
    }
    if let Some(parent) = store_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::Internal(format!("could not create the knowledge folder: {error}")))?;
    }
    let store = Arc::new(
        SqliteStore::open(store_path)
            .map_err(|error| AppError::Internal(format!("could not open the knowledge store: {error}")))?,
    );
    stores.insert(store_path.to_path_buf(), store.clone());
    Ok(store)
}

/// Closes the store (if open) and deletes its file and SQLite side files.
///
/// # Errors
/// `Internal` when a file exists but cannot be removed.
pub fn delete_store(store_path: &Path) -> AppResult<()> {
    lock_open_stores()?.remove(store_path);
    let mut side_files = vec![store_path.to_path_buf()];
    for suffix in ["-wal", "-shm"] {
        let mut name = store_path.as_os_str().to_owned();
        name.push(suffix);
        side_files.push(PathBuf::from(name));
    }
    for file in side_files {
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AppError::Internal(format!("could not delete the knowledge store: {error}"))),
        }
    }
    Ok(())
}

/// Bytes used on disk by the store and its write-ahead log.
pub fn store_size_bytes(store_path: &Path) -> u64 {
    let mut wal_name = store_path.as_os_str().to_owned();
    wal_name.push("-wal");
    [store_path.to_path_buf(), PathBuf::from(wal_name)]
        .iter()
        .filter_map(|file| std::fs::metadata(file).ok())
        .map(|metadata| metadata.len())
        .sum()
}

/// How a knowledge base is embedded and searched for one sync or run.
#[derive(Debug, Clone)]
pub struct EmbeddingSetup {
    /// `None` when the chosen provider has no key: indexing new text is then
    /// impossible and search falls back to keyword (BM25) only.
    pub embedder: Option<Arc<dyn Embedder>>,
    /// Blend of vector and keyword scores used when the request does not choose one.
    pub default_weights: HybridWeights,
}

impl EmbeddingSetup {
    /// Weights to search with: keyword only when there is no embedder.
    pub fn effective_weights(&self, requested: HybridWeights) -> HybridWeights {
        if self.embedder.is_none() {
            return HybridWeights { vector: 0.0, keyword: 1.0 };
        }
        if requested == HybridWeights::default() {
            self.default_weights
        } else {
            requested
        }
    }

    /// The embedder, or a placeholder for keyword-only search (never called then).
    pub fn embedder_or_placeholder(&self) -> Arc<dyn Embedder> {
        self.embedder.clone().unwrap_or_else(|| Arc::new(HashEmbedder::new(LOCAL_EMBEDDING_DIMENSIONS)))
    }
}

/// The OpenAI key, read once per sync, search or run.
#[derive(Clone, Default)]
pub struct EmbeddingKeys {
    openai_api_key: Option<Secret>,
}

impl std::fmt::Debug for EmbeddingKeys {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("EmbeddingKeys").field("openai_configured", &self.openai_api_key.is_some()).finish()
    }
}

impl EmbeddingKeys {
    /// Reads the OpenAI key only when one of `choices` needs it.
    ///
    /// # Errors
    /// `Credentials` when the keychain cannot be read.
    pub fn load(credentials: &CredentialStore, choices: impl IntoIterator<Item = EmbeddingChoice>) -> AppResult<Self> {
        let needs_openai = choices.into_iter().any(|choice| choice == EmbeddingChoice::Openai);
        if !needs_openai {
            return Ok(Self::default());
        }
        let openai_api_key = credentials.read_api_key(ModelProvider::Openai)?.map(Secret::new);
        Ok(Self { openai_api_key })
    }

    /// Whether an OpenAI key is available.
    pub fn has_openai(&self) -> bool {
        self.openai_api_key.is_some()
    }

    /// Embedder and weights for a knowledge base using `choice`.
    ///
    /// # Errors
    /// `Internal` when the OpenAI client cannot be built.
    pub fn setup_for(&self, choice: EmbeddingChoice) -> AppResult<EmbeddingSetup> {
        match choice {
            EmbeddingChoice::Local => Ok(EmbeddingSetup {
                embedder: Some(Arc::new(HashEmbedder::new(LOCAL_EMBEDDING_DIMENSIONS))),
                // Hashed vectors are lexical too; BM25 ranks exact terms best.
                default_weights: HybridWeights { vector: 0.4, keyword: 0.6 },
            }),
            EmbeddingChoice::Openai => {
                let embedder: Option<Arc<dyn Embedder>> = match &self.openai_api_key {
                    Some(api_key) => {
                        let mut config = OpenAiEmbedderConfig::new(OPENAI_BASE_URL, OPENAI_EMBEDDING_MODEL);
                        config.http.api_key = api_key.clone();
                        let embedder = OpenAiEmbedder::new(config).map_err(|error| {
                            AppError::Internal(format!("could not set up OpenAI embeddings: {error}"))
                        })?;
                        Some(Arc::new(embedder))
                    }
                    None => None,
                };
                Ok(EmbeddingSetup { embedder, default_weights: HybridWeights { vector: 0.7, keyword: 0.3 } })
            }
        }
    }
}

/// Embedding used for a new knowledge base: OpenAI when its key is set, else local.
pub fn default_embedding(credentials: &CredentialStore) -> EmbeddingChoice {
    match credentials.read_api_key(ModelProvider::Openai) {
        Ok(Some(_)) => EmbeddingChoice::Openai,
        Ok(None) => EmbeddingChoice::Local,
        Err(error) => {
            log::warn!("could not check for an OpenAI key, using local embeddings: {error}");
            EmbeddingChoice::Local
        }
    }
}
