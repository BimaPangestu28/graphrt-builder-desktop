//! Cleaning up the files of conversations (`crate::agent_files::cleanup`): which files the
//! stored messages still show, and when the cleanup runs.
//!
//! It runs for one conversation when it is closed, and for everything a minute after the app
//! starts and every six hours after that ([`spawn`]). The rule that matters is in the cleanup
//! itself: a file a message shows is never removed. Here, every read of the database must
//! succeed before anything is removed; a failed read skips the round.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value as Json;

use super::models::ConversationStatus;
use super::ConversationManager;
use crate::agent_files::cleanup::{CleanupReport, ConversationFileUse};
use crate::agent_files::AgentFiles;
use crate::error::AppResult;
use crate::storage::Database;

/// How long after the app started the first cleanup runs (nothing on the first screen waits for it).
const FIRST_ROUND_DELAY: Duration = Duration::from_secs(60);
/// How often the cleanup runs while the app stays open.
const ROUND_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

fn now_ms() -> u64 {
    let since_epoch = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    u64::try_from(since_epoch.as_millis()).unwrap_or(u64::MAX)
}

/// Adds every `workspace:` text anywhere in a message's metadata. Wider than the file cards
/// the app writes on purpose: whatever a message could be showing counts as shown.
fn add_named_files(metadata: &Json, named: &mut Vec<String>) {
    match metadata {
        Json::String(text) if text.starts_with(graphrt_files::REFERENCE_SCHEME) => named.push(text.clone()),
        Json::Array(items) => items.iter().for_each(|item| add_named_files(item, named)),
        Json::Object(fields) => fields.values().for_each(|field| add_named_files(field, named)),
        _ => {}
    }
}

impl Database {
    /// Every conversation by agent, with the files its messages show. Agents without
    /// conversations are not in the map.
    ///
    /// # Errors
    /// `Database` when a read fails, `Serialization` when a message's metadata is not JSON
    /// (the caller then removes nothing, rather than guess what that message shows).
    pub(super) fn conversation_file_use(
        &self,
        only_conversation_id: Option<&str>,
    ) -> AppResult<HashMap<String, Vec<ConversationFileUse>>> {
        let connection = self.lock()?;
        let mut conversations = connection.prepare(
            "SELECT id, agent_id, status FROM conversations WHERE ?1 IS NULL OR id = ?1 ORDER BY created_at, rowid",
        )?;
        let rows = conversations.query_map([only_conversation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;
        let mut by_agent: HashMap<String, Vec<ConversationFileUse>> = HashMap::new();
        let mut agent_of_conversation: HashMap<String, String> = HashMap::new();
        for row in rows {
            let (conversation_id, agent_id, status) = row?;
            agent_of_conversation.insert(conversation_id.clone(), agent_id.clone());
            by_agent.entry(agent_id).or_default().push(ConversationFileUse {
                conversation_id,
                is_closed: ConversationStatus::from_db_text(&status) == Some(ConversationStatus::Closed),
                referenced: Vec::new(),
            });
        }
        let mut messages = connection.prepare(
            "SELECT conversation_id, metadata_json FROM conversation_messages
             WHERE metadata_json LIKE '%workspace:%' AND (?1 IS NULL OR conversation_id = ?1)",
        )?;
        let rows = messages
            .query_map([only_conversation_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (conversation_id, metadata_json) = row?;
            let metadata: Json = serde_json::from_str(&metadata_json)?;
            let file_use = agent_of_conversation
                .get(&conversation_id)
                .and_then(|agent_id| by_agent.get_mut(agent_id))
                .and_then(|uses| uses.iter_mut().find(|file_use| file_use.conversation_id == conversation_id));
            if let Some(file_use) = file_use {
                add_named_files(&metadata, &mut file_use.referenced);
            }
        }
        Ok(by_agent)
    }
}

/// Cleans the files of every agent's conversations and removes the folders of agents and
/// conversations that no longer exist.
///
/// # Errors
/// Whatever reading the database reports; nothing is removed then.
pub(super) async fn clean_everything(db: &Database, agent_files: &AgentFiles) -> AppResult<CleanupReport> {
    let agent_ids: Vec<String> = db.list_agents()?.into_iter().map(|agent| agent.id).collect();
    let mut file_use = db.conversation_file_use(None)?;
    let mut report = agent_files.remove_folders_of_missing_agents(&agent_ids).await;
    let now = now_ms();
    for agent_id in &agent_ids {
        let conversations = file_use.remove(agent_id).unwrap_or_default();
        let cleaned = agent_files.clean_agent(agent_id, &conversations, now).await?;
        report.files += cleaned.files;
        report.conversation_folders += cleaned.conversation_folders;
    }
    Ok(report)
}

/// Cleans the files of one conversation (after it was closed).
///
/// # Errors
/// Whatever reading the database reports; nothing is removed then.
pub(super) async fn clean_one(
    db: &Database,
    agent_files: &AgentFiles,
    conversation_id: &str,
) -> AppResult<CleanupReport> {
    let mut report = CleanupReport::default();
    for (agent_id, conversations) in db.conversation_file_use(Some(conversation_id))? {
        for file_use in &conversations {
            report.files += agent_files.clean_conversation(&agent_id, file_use, now_ms()).await?.files;
        }
    }
    Ok(report)
}

/// Runs the cleanup in the background for as long as the app is open.
pub fn spawn(conversations: Arc<ConversationManager>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_ROUND_DELAY).await;
        loop {
            match conversations.clean_up_files().await {
                Ok(report) if !report.is_empty() => log::info!(
                    "removed {} leftover files, {} conversation folders and {} agent folders",
                    report.files,
                    report.conversation_folders,
                    report.agent_folders
                ),
                Ok(_) => {}
                Err(error) => log::warn!("could not clean up conversation files: {error}"),
            }
            tokio::time::sleep(ROUND_INTERVAL).await;
        }
    });
}
