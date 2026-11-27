//! Knowledge metadata in the app database: knowledge bases, their sources and
//! the fingerprint of every indexed document (tables from the knowledge migration).
//!
//! Passages themselves are not here: they live in each knowledge base's
//! graphrt-rag store file (`store_path`).

use rusqlite::{params, OptionalExtension, Row};

use super::models::{EmbeddingChoice, KnowledgeSettings, KnowledgeSource, SourceKind, SourceStatus};
use crate::error::{AppError, AppResult};
use crate::storage::{now_rfc3339, Database};

/// A knowledge base row.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredKnowledgeBase {
    pub id: String,
    pub name: String,
    pub description: String,
    /// The graphrt-rag SQLite file holding this knowledge base's passages.
    pub store_path: String,
    pub settings: KnowledgeSettings,
    pub last_synced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One indexed document (a file, a page, or one file of a folder).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDocument {
    pub document_id: String,
    /// Hash of the raw bytes last indexed; equal bytes are not re-read.
    pub fingerprint: String,
    pub passage_count: u64,
}

/// Result of syncing one source, written in one update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceOutcome {
    pub status: SourceStatus,
    pub status_message: Option<String>,
    pub document_count: u32,
    pub failed_count: u32,
    pub passage_count: u64,
}

const KNOWLEDGE_BASE_COLUMNS: &str = "id, name, description, store_path, embedding, passages_per_answer, \
     min_score, show_sources, last_synced_at, created_at, updated_at";

const SOURCE_COLUMNS: &str = "id, knowledge_base_id, kind, location, name, status, status_message, \
     document_count, failed_count, passage_count, last_synced_at, created_at";

fn to_u32(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

fn to_u64(value: i64) -> u64 {
    u64::try_from(value.max(0)).unwrap_or(u64::MAX)
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// Maps a text column through a fallible parser, reporting bad values as conversion errors.
fn parse_column<T>(row: &Row<'_>, index: usize, parse: fn(&str) -> AppResult<T>) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    parse(&text)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error)))
}

fn knowledge_base_from_row(row: &Row<'_>) -> rusqlite::Result<StoredKnowledgeBase> {
    Ok(StoredKnowledgeBase {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        store_path: row.get(3)?,
        settings: KnowledgeSettings {
            embedding: parse_column(row, 4, EmbeddingChoice::parse)?,
            passages_per_answer: to_u32(row.get(5)?),
            min_score: row.get(6)?,
            show_sources: row.get::<_, i64>(7)? != 0,
        },
        last_synced_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn source_from_row(row: &Row<'_>) -> rusqlite::Result<KnowledgeSource> {
    Ok(KnowledgeSource {
        id: row.get(0)?,
        knowledge_base_id: row.get(1)?,
        kind: parse_column(row, 2, SourceKind::parse)?,
        location: row.get(3)?,
        name: row.get(4)?,
        status: parse_column(row, 5, SourceStatus::parse)?,
        status_message: row.get(6)?,
        document_count: to_u32(row.get(7)?),
        failed_count: to_u32(row.get(8)?),
        passage_count: to_u64(row.get(9)?),
        last_synced_at: row.get(10)?,
        created_at: row.get(11)?,
        connector: None,
    })
}

fn not_found_if_unchanged(changed_rows: usize, what: String) -> AppResult<()> {
    if changed_rows == 0 {
        Err(AppError::NotFound(what))
    } else {
        Ok(())
    }
}

pub fn insert_knowledge_base(db: &Database, knowledge_base: &StoredKnowledgeBase) -> AppResult<()> {
    let settings = &knowledge_base.settings;
    db.lock()?.execute(
        &format!("INSERT INTO knowledge_bases ({KNOWLEDGE_BASE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"),
        params![
            knowledge_base.id,
            knowledge_base.name,
            knowledge_base.description,
            knowledge_base.store_path,
            settings.embedding.as_str(),
            i64::from(settings.passages_per_answer),
            settings.min_score,
            i64::from(settings.show_sources),
            knowledge_base.last_synced_at,
            knowledge_base.created_at,
            knowledge_base.updated_at,
        ],
    )?;
    Ok(())
}

/// # Errors
/// `NotFound` when no knowledge base has this id.
pub fn get_knowledge_base(db: &Database, knowledge_base_id: &str) -> AppResult<StoredKnowledgeBase> {
    find_knowledge_base(db, knowledge_base_id)?
        .ok_or_else(|| AppError::NotFound(format!("knowledge base {knowledge_base_id}")))
}

pub fn find_knowledge_base(db: &Database, knowledge_base_id: &str) -> AppResult<Option<StoredKnowledgeBase>> {
    let connection = db.lock()?;
    Ok(connection
        .query_row(
            &format!("SELECT {KNOWLEDGE_BASE_COLUMNS} FROM knowledge_bases WHERE id = ?1"),
            [knowledge_base_id],
            knowledge_base_from_row,
        )
        .optional()?)
}

/// Every knowledge base, most recently changed first.
pub fn list_knowledge_bases(db: &Database) -> AppResult<Vec<StoredKnowledgeBase>> {
    let connection = db.lock()?;
    let mut statement = connection
        .prepare(&format!("SELECT {KNOWLEDGE_BASE_COLUMNS} FROM knowledge_bases ORDER BY updated_at DESC, id"))?;
    let rows = statement.query_map([], knowledge_base_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn rename_knowledge_base(db: &Database, knowledge_base_id: &str, name: &str) -> AppResult<()> {
    let changed_rows = db.lock()?.execute(
        "UPDATE knowledge_bases SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![knowledge_base_id, name, now_rfc3339()],
    )?;
    not_found_if_unchanged(changed_rows, format!("knowledge base {knowledge_base_id}"))
}

pub fn update_settings(db: &Database, knowledge_base_id: &str, settings: &KnowledgeSettings) -> AppResult<()> {
    let changed_rows = db.lock()?.execute(
        "UPDATE knowledge_bases SET embedding = ?2, passages_per_answer = ?3, min_score = ?4, show_sources = ?5, \
         updated_at = ?6 WHERE id = ?1",
        params![
            knowledge_base_id,
            settings.embedding.as_str(),
            i64::from(settings.passages_per_answer),
            settings.min_score,
            i64::from(settings.show_sources),
            now_rfc3339(),
        ],
    )?;
    not_found_if_unchanged(changed_rows, format!("knowledge base {knowledge_base_id}"))
}

pub fn set_last_synced(db: &Database, knowledge_base_id: &str, synced_at: &str) -> AppResult<()> {
    db.lock()?.execute(
        "UPDATE knowledge_bases SET last_synced_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![knowledge_base_id, synced_at],
    )?;
    Ok(())
}

/// Deletes the knowledge base with its sources and document fingerprints.
pub fn delete_knowledge_base(db: &Database, knowledge_base_id: &str) -> AppResult<()> {
    let changed_rows = db.lock()?.execute("DELETE FROM knowledge_bases WHERE id = ?1", [knowledge_base_id])?;
    not_found_if_unchanged(changed_rows, format!("knowledge base {knowledge_base_id}"))
}

/// # Errors
/// `InvalidInput` when the same location is already a source of this knowledge base.
pub fn insert_source(db: &Database, source: &KnowledgeSource) -> AppResult<()> {
    let connection = db.lock()?;
    let duplicate: Option<String> = connection
        .query_row(
            "SELECT id FROM knowledge_sources WHERE knowledge_base_id = ?1 AND location = ?2",
            params![source.knowledge_base_id, source.location],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some() {
        return Err(AppError::InvalidInput(format!("{} is already in this knowledge base", source.name)));
    }
    connection.execute(
        &format!("INSERT INTO knowledge_sources ({SOURCE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"),
        params![
            source.id,
            source.knowledge_base_id,
            source.kind.as_str(),
            source.location,
            source.name,
            source.status.as_str(),
            source.status_message,
            i64::from(source.document_count),
            i64::from(source.failed_count),
            to_i64(source.passage_count),
            source.last_synced_at,
            source.created_at,
        ],
    )?;
    Ok(())
}

/// # Errors
/// `NotFound` when no source has this id.
pub fn get_source(db: &Database, source_id: &str) -> AppResult<KnowledgeSource> {
    let source = {
        let connection = db.lock()?;
        connection
            .query_row(
                &format!("SELECT {SOURCE_COLUMNS} FROM knowledge_sources WHERE id = ?1"),
                [source_id],
                source_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("knowledge source {source_id}")))?
    };
    let mut sources = [source];
    super::connectors::attach(db, &mut sources)?;
    let [source] = sources;
    Ok(source)
}

/// Sources of one knowledge base, oldest first.
pub fn list_sources(db: &Database, knowledge_base_id: &str) -> AppResult<Vec<KnowledgeSource>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare(&format!(
        "SELECT {SOURCE_COLUMNS} FROM knowledge_sources WHERE knowledge_base_id = ?1 ORDER BY created_at, id"
    ))?;
    let rows = statement.query_map([knowledge_base_id], source_from_row)?;
    let mut sources: Vec<KnowledgeSource> = rows.collect::<Result<_, _>>()?;
    drop(statement);
    drop(connection);
    super::connectors::attach(db, &mut sources)?;
    Ok(sources)
}

pub fn set_source_status(db: &Database, source_id: &str, status: SourceStatus) -> AppResult<()> {
    db.lock()?
        .execute("UPDATE knowledge_sources SET status = ?2 WHERE id = ?1", params![source_id, status.as_str()])?;
    Ok(())
}

/// Marks every source of a knowledge base as waiting for a sync (after the embedding model changes).
pub fn mark_sources_pending(db: &Database, knowledge_base_id: &str) -> AppResult<()> {
    db.lock()?.execute(
        "UPDATE knowledge_sources SET status = 'pending', status_message = NULL, passage_count = 0, document_count = 0 \
         WHERE knowledge_base_id = ?1",
        [knowledge_base_id],
    )?;
    Ok(())
}

pub fn finish_source(db: &Database, source_id: &str, outcome: &SourceOutcome, synced_at: &str) -> AppResult<()> {
    db.lock()?.execute(
        "UPDATE knowledge_sources SET status = ?2, status_message = ?3, document_count = ?4, failed_count = ?5, \
         passage_count = ?6, last_synced_at = ?7 WHERE id = ?1",
        params![
            source_id,
            outcome.status.as_str(),
            outcome.status_message,
            i64::from(outcome.document_count),
            i64::from(outcome.failed_count),
            to_i64(outcome.passage_count),
            synced_at,
        ],
    )?;
    Ok(())
}

pub fn delete_source(db: &Database, source_id: &str) -> AppResult<()> {
    let changed_rows = db.lock()?.execute("DELETE FROM knowledge_sources WHERE id = ?1", [source_id])?;
    not_found_if_unchanged(changed_rows, format!("knowledge source {source_id}"))
}

/// Indexed documents of one source.
pub fn list_documents(db: &Database, source_id: &str) -> AppResult<Vec<StoredDocument>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare(
        "SELECT document_id, fingerprint, passage_count FROM knowledge_documents WHERE source_id = ?1 \
         ORDER BY document_id",
    )?;
    let rows = statement.query_map([source_id], |row| {
        Ok(StoredDocument { document_id: row.get(0)?, fingerprint: row.get(1)?, passage_count: to_u64(row.get(2)?) })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn upsert_document(db: &Database, source_id: &str, document: &StoredDocument) -> AppResult<()> {
    db.lock()?.execute(
        "INSERT INTO knowledge_documents (source_id, document_id, fingerprint, passage_count) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (source_id, document_id) DO UPDATE SET fingerprint = excluded.fingerprint, \
         passage_count = excluded.passage_count",
        params![source_id, document.document_id, document.fingerprint, to_i64(document.passage_count)],
    )?;
    Ok(())
}

pub fn delete_document(db: &Database, source_id: &str, document_id: &str) -> AppResult<()> {
    db.lock()?.execute(
        "DELETE FROM knowledge_documents WHERE source_id = ?1 AND document_id = ?2",
        params![source_id, document_id],
    )?;
    Ok(())
}

/// Forgets every document fingerprint of a knowledge base, so the next sync re-indexes everything.
pub fn clear_documents(db: &Database, knowledge_base_id: &str) -> AppResult<()> {
    db.lock()?.execute(
        "DELETE FROM knowledge_documents WHERE source_id IN \
         (SELECT id FROM knowledge_sources WHERE knowledge_base_id = ?1)",
        [knowledge_base_id],
    )?;
    Ok(())
}
