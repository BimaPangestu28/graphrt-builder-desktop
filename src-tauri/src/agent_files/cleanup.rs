//! Removing files nobody needs any more, without ever removing one a message still shows.
//!
//! What is removed, and only this:
//! 1. **Attachments that were never sent**: a file below `uploads/` of a conversation that no
//!    message of that conversation names, once it is older than [`UNSENT_GRACE`]. The wait
//!    keeps a file someone attached a moment ago and has not sent yet.
//! 2. **Leftovers of a closed conversation**: any other file of a closed conversation that no
//!    message names (notes the bot kept for itself). An open conversation keeps them, because
//!    its bot may still use them.
//! 3. **Folders of conversations and agents that no longer exist** (their messages are gone,
//!    so nothing can name those files).
//!
//! A file a message names (an attachment that was sent, a file a reply handed back) is never
//! removed here, in an open or a closed conversation: it stays downloadable for as long as
//! the message exists, and goes with its agent.
//!
//! The caller says which files messages name ([`ConversationFileUse`]). When it cannot tell
//! (the database could not be read), it must not call this at all.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use graphrt_files::{Workspace, WorkspacePath};
use sha2::{Digest, Sha256};

use super::intake::UPLOADS_DIR;
use super::{AgentFiles, FileScope};
use crate::error::AppResult;

/// How long an attached file may wait to be sent before it counts as abandoned.
pub const UNSENT_GRACE: Duration = Duration::from_secs(24 * 60 * 60);
/// Directory of a workspace that holds the conversations' parts (graphrt's name for it).
const SCOPES_DIR: &str = "scopes";
/// Length of the folder names graphrt and [`AgentFiles`] derive from ids.
const FOLDER_NAME_LENGTH: usize = 32;

/// Which files the messages of one conversation name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationFileUse {
    pub conversation_id: String,
    pub is_closed: bool,
    /// `reference` of every file a message of the conversation shows.
    pub referenced: Vec<String>,
}

/// What a cleanup removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CleanupReport {
    pub files: usize,
    pub conversation_folders: usize,
    pub agent_folders: usize,
}

impl CleanupReport {
    /// Whether anything was removed.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    fn add(&mut self, other: Self) {
        self.files += other.files;
        self.conversation_folders += other.conversation_folders;
        self.agent_folders += other.agent_folders;
    }
}

/// The folder name graphrt gives the part of a workspace that belongs to `scope`
/// (`Workspace::scoped`): the first 16 bytes of its SHA-256, in hex. The same rule names
/// an agent's folder ([`AgentFiles`]).
pub(super) fn folder_name(scope: &str) -> String {
    let digest = Sha256::digest(scope.as_bytes());
    graphrt_files::hex(digest.get(..16).unwrap_or_default())
}

/// Whether `name` looks like a folder this module made: 32 hex characters.
fn is_folder_name(name: &str) -> bool {
    name.len() == FOLDER_NAME_LENGTH && name.chars().all(|character| character.is_ascii_hexdigit())
}

/// The real folders directly below `parent` whose names look like ours and are not in
/// `kept`. Links and files are never returned, so nothing outside `parent` can be removed.
fn stray_folders(parent: &Path, kept: &HashSet<String>) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(parent) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            is_folder_name(&name) && !kept.contains(&name)
        })
        .map(|entry| entry.path())
        .collect()
}

fn remove_folders(folders: Vec<std::path::PathBuf>) -> usize {
    let mut removed = 0;
    for folder in folders {
        match std::fs::remove_dir_all(&folder) {
            Ok(()) => removed += 1,
            Err(error) => log::warn!("could not remove a leftover files folder: {error}"),
        }
    }
    removed
}

/// Whether the unnamed file at `path` may go (rules 1 and 2 of the module docs).
fn is_removable(path: &WorkspacePath, modified_ms: Option<u64>, is_closed: bool, now_ms: u64) -> bool {
    if path.components().next() != Some(UPLOADS_DIR) {
        return is_closed;
    }
    // A file whose age is unknown is kept: it may have been attached a moment ago.
    let grace_ms = u64::try_from(UNSENT_GRACE.as_millis()).unwrap_or(u64::MAX);
    modified_ms.is_some_and(|modified_ms| now_ms.saturating_sub(modified_ms) >= grace_ms)
}

/// Removes the removable files of one conversation's part of the workspace.
async fn clean_view(view: &Workspace, file_use: &ConversationFileUse, now_ms: u64) -> usize {
    let named: HashSet<WorkspacePath> =
        file_use.referenced.iter().filter_map(|reference| view.path_of_reference(reference)).collect();
    let listing = match view.list(None, view.limits().max_files).await {
        Ok(listing) => listing,
        Err(error) => {
            log::warn!("could not list the files of conversation {}: {error}", file_use.conversation_id);
            return 0;
        }
    };
    let mut removed = 0;
    for entry in listing.entries {
        if named.contains(&entry.path) || !is_removable(&entry.path, entry.modified_ms, file_use.is_closed, now_ms) {
            continue;
        }
        match view.delete(&entry.path).await {
            Ok(()) => removed += 1,
            Err(error) => log::warn!("could not remove a leftover file: {error}"),
        }
    }
    removed
}

impl AgentFiles {
    /// Cleans the files of one conversation (rules 1 and 2). An agent that never kept a
    /// file is left alone, and no folder is created for it.
    ///
    /// # Errors
    /// `Internal` when the agent's folder cannot be opened.
    pub async fn clean_conversation(
        &self,
        agent_id: &str,
        file_use: &ConversationFileUse,
        now_ms: u64,
    ) -> AppResult<CleanupReport> {
        if self.existing_agent_workspace(agent_id)?.is_none() {
            return Ok(CleanupReport::default());
        }
        let view = self.view(&FileScope::conversation(agent_id, &file_use.conversation_id))?;
        Ok(CleanupReport { files: clean_view(&view, file_use, now_ms).await, ..CleanupReport::default() })
    }

    /// Cleans every conversation of an agent, then removes the folders of conversations
    /// that are not in `conversations` (rule 3). `conversations` must list every
    /// conversation the agent still has.
    ///
    /// # Errors
    /// `Internal` when the agent's folder cannot be opened.
    pub async fn clean_agent(
        &self,
        agent_id: &str,
        conversations: &[ConversationFileUse],
        now_ms: u64,
    ) -> AppResult<CleanupReport> {
        let mut report = CleanupReport::default();
        if self.existing_agent_workspace(agent_id)?.is_none() {
            return Ok(report);
        }
        for file_use in conversations {
            report.add(self.clean_conversation(agent_id, file_use, now_ms).await?);
        }
        let kept: HashSet<String> =
            conversations.iter().map(|file_use| folder_name(&file_use.conversation_id)).collect();
        let scopes_dir = self.agent_dir(agent_id).join(SCOPES_DIR);
        let removed = graphrt_files::blocking(move || remove_folders(stray_folders(&scopes_dir, &kept))).await;
        report.conversation_folders += removed.unwrap_or(0);
        Ok(report)
    }

    /// Removes the folders of agents that are not in `agent_ids` (rule 3). `agent_ids`
    /// must list every agent that still exists.
    pub async fn remove_folders_of_missing_agents(&self, agent_ids: &[String]) -> CleanupReport {
        let kept: HashSet<String> = agent_ids.iter().map(|agent_id| folder_name(agent_id)).collect();
        let root = self.root.clone();
        let removed = graphrt_files::blocking(move || remove_folders(stray_folders(&root, &kept))).await;
        CleanupReport { agent_folders: removed.unwrap_or(0), ..CleanupReport::default() }
    }
}
