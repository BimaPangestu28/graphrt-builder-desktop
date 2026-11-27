//! Files and pictures for agents: what a person attaches in a chat, and the files an agent
//! makes and hands back.
//!
//! Off unless the agent's steps ask for it. An agent gets this only when its workflow uses
//! the `files`, `documents` or `image` tools, or looks at pictures (`vision`); see
//! [`abilities`]. An agent that does not costs one text scan of its workflow per run: no
//! folder is created, no tool is registered and no image code runs.
//!
//! Layout:
//! - [`AgentFiles`] (this file): one workspace per agent, kept in the app data folder.
//! - [`abilities`]: what an agent's workflow can do with files, read from its steps.
//! - `wiring`: the graphrt tools, file resolver and image gate of one run.
//! - `intake`: copying a file the person chose into the workspace, after checking it.
//! - [`cards`]: what the screens show about a file (name, size, kind).
//! - `delivery`: the small picture shown on a card, and saving a file to disk.
//! - [`run_files`]: the files a run made, for the Run result screen.
//! - [`cleanup`]: removing attachments that were never sent and leftovers of closed conversations.
//!
//! # What is kept apart
//! - Every agent has its own folder ([`AgentFiles::agent_workspace`]). Its name is a hash
//!   of the agent id, so no id can name a path.
//! - Inside a chatbot's folder every conversation has its own part
//!   ([`FileScope::conversation_id`]): one customer's files are out of reach in another
//!   customer's chat, whatever the model is talked into.
//! - graphrt's workspace refuses paths that leave the folder, links, hidden names, programs
//!   and scripts, and enforces the size limits ([`workspace_limits`]).
//!
//! # What the webview may do
//! The webview never names a path on this computer. Attaching opens the system file dialog
//! from Rust, and a dropped file is taken only when the window itself reported that drop
//! ([`AgentFiles::remember_dropped`]). Saving opens the system save dialog from Rust. What
//! the webview sends back is a file's `reference` (`workspace:...`), which is looked up
//! inside one agent's workspace and nowhere else.
//!
//! # What is shown
//! A card shows a name, a size and a kind. Only pictures graphrt-image can decode (PNG,
//! JPEG, GIF, WebP) get a preview, and that preview is a small copy encoded again here.
//! HTML, SVG, PDF and everything else is offered as a download and never rendered.

pub mod abilities;
pub mod cards;
pub mod cleanup;
mod delivery;
mod intake;
pub mod run_files;
#[cfg(test)]
mod tests;
mod wiring;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use graphrt_files::{Workspace, WorkspaceLimits};

pub use self::abilities::FileAbilities;
pub use self::cards::FileCard;
pub use self::delivery::FilePreview;
pub use self::intake::{AttachOutcome, AttachProblem, AttachedFile, PathOrigin};
pub(crate) use self::wiring::{image_gate, FileAccess, FileWiring};
use crate::error::{AppError, AppResult};

/// Folder of the agents' workspaces inside the app data folder.
pub const AGENT_FILES_DIR_NAME: &str = "agent-files";
/// Largest file a person can attach.
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
/// Most files attached to one message (graphrt takes at most 16 files per run).
pub const MAX_ATTACHMENTS_PER_MESSAGE: usize = 8;
/// Most file cards one message or one run shows.
pub const MAX_FILE_CARDS: usize = 12;
/// Most dropped paths remembered at once; older ones are forgotten first.
const MAX_REMEMBERED_DROPS: usize = 256;

/// What one agent (or one conversation of a chatbot) may keep.
pub fn workspace_limits() -> WorkspaceLimits {
    WorkspaceLimits {
        max_file_bytes: 32 * 1024 * 1024,
        max_total_bytes: 256 * 1024 * 1024,
        max_files: 2_000,
        read_only: false,
        allow_executables: false,
    }
}

/// Whose files a run works with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileScope {
    pub agent_id: String,
    /// A chatbot conversation: its files live in a part of the agent's workspace that
    /// other conversations cannot reach. `None` for runs of the agent.
    pub conversation_id: Option<String>,
}

impl FileScope {
    /// The files of an agent's own runs.
    pub fn agent(agent_id: &str) -> Self {
        Self { agent_id: agent_id.to_owned(), conversation_id: None }
    }

    /// The files of one conversation of a chatbot.
    pub fn conversation(agent_id: &str, conversation_id: &str) -> Self {
        Self { agent_id: agent_id.to_owned(), conversation_id: Some(conversation_id.to_owned()) }
    }
}

/// The agents' file workspaces. One per app, shared as `Arc<AgentFiles>`.
#[derive(Debug)]
pub struct AgentFiles {
    root: PathBuf,
    /// One workspace object per agent, so every run of an agent shares one quota count.
    workspaces: Mutex<HashMap<String, Workspace>>,
    /// Paths the window reported as dropped onto it, oldest first.
    dropped_paths: Mutex<Vec<PathBuf>>,
}

impl AgentFiles {
    /// Workspaces below `<app data>/agent-files`. Nothing is created until an agent needs it.
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            root: app_data_dir.join(AGENT_FILES_DIR_NAME),
            workspaces: Mutex::new(HashMap::new()),
            dropped_paths: Mutex::new(Vec::new()),
        }
    }

    /// The folder of `agent_id`: 32 hex characters of a hash, never the id itself.
    fn agent_dir(&self, agent_id: &str) -> PathBuf {
        self.root.join(cleanup::folder_name(agent_id))
    }

    /// The whole workspace of an agent (created on first use, readable by the owner only).
    ///
    /// # Errors
    /// `Internal` when the folder cannot be created.
    pub fn agent_workspace(&self, agent_id: &str) -> AppResult<Workspace> {
        let mut workspaces =
            self.workspaces.lock().map_err(|_| AppError::Internal("agent files table lock poisoned".into()))?;
        if let Some(workspace) = workspaces.get(agent_id) {
            return Ok(workspace.clone());
        }
        let workspace = Workspace::dir(self.agent_dir(agent_id), workspace_limits())
            .map_err(|error| AppError::Internal(format!("could not open the agent's files: {error}")))?;
        workspaces.insert(agent_id.to_owned(), workspace.clone());
        Ok(workspace)
    }

    /// The workspace of an agent that has one; `None` when the agent never kept a file.
    /// Unlike [`Self::agent_workspace`] this creates nothing, so looking a file up for an
    /// agent without files leaves no folder behind.
    ///
    /// # Errors
    /// As [`Self::agent_workspace`].
    pub fn existing_agent_workspace(&self, agent_id: &str) -> AppResult<Option<Workspace>> {
        if !self.agent_dir(agent_id).is_dir() {
            return Ok(None);
        }
        self.agent_workspace(agent_id).map(Some)
    }

    /// The part of an agent's workspace that `scope` may use.
    ///
    /// # Errors
    /// As [`Self::agent_workspace`].
    pub fn view(&self, scope: &FileScope) -> AppResult<Workspace> {
        let workspace = self.agent_workspace(&scope.agent_id)?;
        Ok(match &scope.conversation_id {
            Some(conversation_id) => workspace.scoped(conversation_id),
            None => workspace,
        })
    }

    /// Removes everything an agent kept (the agent was deleted). A folder that was never
    /// created is not an error.
    ///
    /// # Errors
    /// `Internal` when the folder exists and cannot be removed.
    pub fn forget_agent(&self, agent_id: &str) -> AppResult<()> {
        if let Ok(mut workspaces) = self.workspaces.lock() {
            workspaces.remove(agent_id);
        }
        match std::fs::remove_dir_all(self.agent_dir(agent_id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Internal(format!("could not remove the agent's files: {error}"))),
        }
    }

    /// Records paths the window reported as dropped onto it. Only these can be attached
    /// by path ([`PathOrigin::Dropped`]); each is used once.
    pub fn remember_dropped(&self, paths: &[PathBuf]) {
        let Ok(mut dropped_paths) = self.dropped_paths.lock() else { return };
        for path in paths {
            if !dropped_paths.contains(path) {
                dropped_paths.push(path.clone());
            }
        }
        let excess = dropped_paths.len().saturating_sub(MAX_REMEMBERED_DROPS);
        dropped_paths.drain(..excess);
    }

    /// Whether `path` was dropped onto the window; forgets it, so it attaches once.
    fn take_dropped(&self, path: &Path) -> bool {
        let Ok(mut dropped_paths) = self.dropped_paths.lock() else { return false };
        match dropped_paths.iter().position(|dropped| dropped == path) {
            Some(index) => {
                dropped_paths.remove(index);
                true
            }
            None => false,
        }
    }
}
