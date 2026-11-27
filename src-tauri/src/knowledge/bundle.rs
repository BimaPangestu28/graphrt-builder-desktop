//! Knowledge inside an exported `.grt` bundle, so `graphrt serve` / `graphrt run`
//! search the same passages and cut new documents the same way as this app.
//!
//! Every knowledge base the agent uses becomes one dataset of the bundle's
//! knowledge config (id = knowledge base id, the same id its workflow names),
//! with a snapshot of its passage store and its chunking settings. Keys are
//! never inside: OpenAI embeddings read `OPENAI_API_KEY` on the server.

use std::path::Path;

use serde_json::{json, Map, Value};

use super::models::EmbeddingChoice;
use super::records::{self, StoredKnowledgeBase};
use super::stores::OPENAI_EMBEDDING_MODEL;
use crate::error::{AppError, AppResult};
use crate::storage::models::Agent;
use crate::storage::Database;

/// Environment variable the server reads the OpenAI key from.
pub const OPENAI_KEY_ENV: &str = "OPENAI_API_KEY";
const LOCAL_EMBEDDER: &str = "local";
const OPENAI_EMBEDDER: &str = "openai";

/// A knowledge config and the folder holding the store snapshots it names
/// (deleted when this value is dropped).
#[derive(Debug)]
pub struct KnowledgeBundle {
    /// JSON for `graphrt_bundle::BundleBuilder::knowledge`, store paths relative to `directory`.
    pub config_json: String,
    pub directory: tempfile::TempDir,
}

/// Copies the store into `target` as one self-contained file (committed
/// write-ahead-log pages included), safe while the app keeps the store open.
fn snapshot_store(store_path: &Path, target: &Path) -> AppResult<()> {
    let connection = rusqlite::Connection::open_with_flags(store_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| AppError::Internal(format!("could not open the knowledge store to copy it: {error}")))?;
    let target_text =
        target.to_str().ok_or_else(|| AppError::Internal("the temporary folder path is not valid text".into()))?;
    connection
        .execute("VACUUM INTO ?1", [target_text])
        .map_err(|error| AppError::Internal(format!("could not copy the knowledge store: {error}")))?;
    Ok(())
}

fn embedder_name(choice: EmbeddingChoice) -> &'static str {
    match choice {
        EmbeddingChoice::Local => LOCAL_EMBEDDER,
        EmbeddingChoice::Openai => OPENAI_EMBEDDER,
    }
}

fn embedder_config(choice: EmbeddingChoice) -> Value {
    match choice {
        // Must match `stores::LOCAL_EMBEDDING_DIMENSIONS`, or stored vectors cannot be compared.
        EmbeddingChoice::Local => json!({ "type": "hash", "dimensions": super::stores::LOCAL_EMBEDDING_DIMENSIONS }),
        EmbeddingChoice::Openai => json!({
            "type": "openai",
            "base_url": super::stores::OPENAI_BASE_URL,
            "model": OPENAI_EMBEDDING_MODEL,
            "api_key_env": OPENAI_KEY_ENV,
        }),
    }
}

/// The knowledge config for `knowledge_bases`, writing their store snapshots into `directory`.
fn build_config(knowledge_bases: &[StoredKnowledgeBase], directory: &Path) -> AppResult<Value> {
    let mut embedders = Map::new();
    let mut stores = Map::new();
    let mut datasets = Vec::new();
    for knowledge_base in knowledge_bases {
        let embedding = knowledge_base.settings.embedding;
        embedders.insert(embedder_name(embedding).to_owned(), embedder_config(embedding));
        let file_name = format!("{}.sqlite", knowledge_base.id);
        let store_path = Path::new(&knowledge_base.store_path);
        if store_path.is_file() {
            snapshot_store(store_path, &directory.join(&file_name))?;
        }
        stores.insert(knowledge_base.id.clone(), json!({ "type": "sqlite", "path": file_name }));
        let chunking = serde_json::to_value(knowledge_base.settings.chunking.to_chunker_config())
            .map_err(|error| AppError::Internal(format!("could not write the chunking settings: {error}")))?;
        datasets.push(json!({
            "id": knowledge_base.id,
            "name": knowledge_base.name,
            "description": knowledge_base.description,
            "store": knowledge_base.id,
            "embedder": embedder_name(embedding),
            "chunking": chunking,
        }));
    }
    Ok(json!({ "embedders": embedders, "stores": stores, "datasets": datasets }))
}

/// Knowledge bases the agent uses (by its workflow or, for a chatbot, its saved setup).
fn used_knowledge_bases(db: &Database, agent: &Agent) -> AppResult<Vec<StoredKnowledgeBase>> {
    let agents = std::slice::from_ref(agent);
    Ok(records::list_knowledge_bases(db)?
        .into_iter()
        .filter(|knowledge_base| !super::usages_of(knowledge_base, agents, db).is_empty())
        .collect())
}

/// Whether the agent uses any knowledge base, so its packages must carry knowledge.
///
/// # Errors
/// `Database` when the knowledge bases cannot be read.
pub fn uses_knowledge(db: &Database, agent: &Agent) -> AppResult<bool> {
    Ok(!used_knowledge_bases(db, agent)?.is_empty())
}

/// The knowledge the agent uses, ready for a bundle; `None` when it uses none.
///
/// # Errors
/// `Database` when the knowledge bases cannot be read, `Internal` when a store cannot be copied.
pub fn knowledge_for_bundle(db: &Database, agent: &Agent) -> AppResult<Option<KnowledgeBundle>> {
    let used = used_knowledge_bases(db, agent)?;
    if used.is_empty() {
        return Ok(None);
    }
    let directory = tempfile::tempdir()
        .map_err(|error| AppError::Internal(format!("could not create a temporary folder: {error}")))?;
    let config = build_config(&used, directory.path())?;
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|error| AppError::Internal(format!("could not write the knowledge config: {error}")))?;
    Ok(Some(KnowledgeBundle { config_json, directory }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge::models::{ChunkingSettings, KnowledgeSettings};

    fn knowledge_base(id: &str, embedding: EmbeddingChoice, chunking: ChunkingSettings) -> StoredKnowledgeBase {
        StoredKnowledgeBase {
            id: id.into(),
            name: format!("Name of {id}"),
            description: String::new(),
            store_path: "/nonexistent/store.sqlite".into(),
            settings: KnowledgeSettings { chunking, ..KnowledgeSettings::with_embedding(embedding) },
            last_synced_at: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn config_names_each_knowledge_base_with_its_chunking_and_no_secret() {
        let directory = tempfile::tempdir().unwrap();
        let small = ChunkingSettings { max_tokens: 100, split_pages: true, ..ChunkingSettings::default() };
        let config = build_config(
            &[
                knowledge_base("kb_a", EmbeddingChoice::Local, ChunkingSettings::default()),
                knowledge_base("kb_b", EmbeddingChoice::Openai, small),
            ],
            directory.path(),
        )
        .unwrap();
        assert_eq!(config["datasets"][0]["id"], "kb_a");
        assert_eq!(config["datasets"][0]["embedder"], "local");
        assert_eq!(config["datasets"][0]["chunking"]["max_chars"], 1000);
        assert_eq!(config["datasets"][1]["chunking"]["max_chars"], 400);
        assert_eq!(config["datasets"][1]["chunking"]["split_pages"], true);
        assert_eq!(config["embedders"]["openai"]["api_key_env"], OPENAI_KEY_ENV);
        assert_eq!(config["stores"]["kb_b"]["path"], "kb_b.sqlite");
        // graphrt accepts it as a knowledge config (the OpenAI key comes from the environment).
        let parsed = graphrt_rag::KnowledgeConfig::from_json(&config.to_string());
        let mut parsed = parsed.unwrap();
        for (name, store) in parsed.stores.iter_mut() {
            store["path"] = Value::String(directory.path().join(format!("{name}.sqlite")).display().to_string());
        }
        let built = parsed.build_with_env(&|name| (name == OPENAI_KEY_ENV).then(|| "sk-test".to_owned())).unwrap();
        assert_eq!(built.chunking("kb_b").map(|chunking| chunking.max_chars), Some(400));
    }
}
