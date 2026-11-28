//! Long term memory: what an agent remembers about the people it serves, and the owner's
//! view of it (the memory tab of "What this agent learned").
//!
//! Notes, the write gate and the memory graph are `graphrt_memory`'s. Runs reach the store
//! through the published service ([`memories_service`]): an agent step with
//! `long_term_memory` saves notes per person (`sys.user_id`), and notes that came from
//! outside content (a tool result, a web page) wait for the owner. This module is the
//! owner's side, the same operations `graphrt serve` offers on `/v1/memory`:
//!
//! - [`MemoryService::overview`]: the people the agent keeps notes about and its own notes;
//! - [`MemoryService::notes`] and [`MemoryService::graph`] of one person;
//! - [`MemoryService::delete_note`], [`MemoryService::decide`] (a note that waits) and
//!   [`MemoryService::erase_person`] (every note and the graph of one person).
//!
//! Who a person is:
//! - a chatbot's customers are their conversation handles (`conversations` table);
//! - runs started in the app (Test, Run now) run as [`APP_USER`], the owner;
//! - tests and release checks run as `quality::target`'s check conversation id;
//! - anyone else found in the store's folder (a customer whose conversation was deleted)
//!   is listed too, so nobody kept in memory is out of the owner's reach.

mod active;
pub mod models;
#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use graphrt_core::memory::{ForgetTarget, MemoryBank, MemoryError, MemoryScope, MemorySource, MemoryStatus};
use graphrt_memory::{ListFilter, MemoryStore};
use serde::Deserialize;

pub(crate) use self::active::{erase_now, memories_service};

/// Clears the store runs use (tests that published one).
#[cfg(test)]
pub(crate) fn unpublish_for_tests() {
    active::publish(None);
}
use self::models::{
    rfc3339, AgentMemory, MemoryFactView, MemoryGraphView, MemoryNoteView, MemoryPerson, MemoryPersonKind,
};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Folder of the memory store inside the app data folder.
pub const MEMORY_DIR_NAME: &str = "memory";
/// `sys.user_id` of runs started in the app (Test, Run now): the person at this computer.
pub const APP_USER: &str = "desktop-owner";
/// Start of the `sys.user_id` of the agent's tests and release checks (`quality::target`):
/// each case is its own person, erased when the case is done.
pub const CHECKS_USER: &str = crate::quality::target::CHECK_USER_ID;
/// Who acts when the owner removes or approves a note (kept in the store's audit log).
const OWNER_ACTOR: &str = "owner:desktop";
/// Most people listed; the store keeps at most 10 000 per agent.
const MAX_PEOPLE: usize = 10_000;

/// The memory tab's backend.
#[derive(Debug)]
pub struct MemoryService {
    store: Arc<MemoryStore>,
    db: Arc<Database>,
}

impl MemoryService {
    /// A service over the store in `<app data>/memory`. Nothing is read or created yet.
    pub fn new(app_data_dir: &Path, db: Arc<Database>) -> Self {
        Self { store: Arc::new(MemoryStore::open(app_data_dir.join(MEMORY_DIR_NAME))), db }
    }

    /// Makes this service's store the one runs save and recall notes in (the app's service only).
    pub fn activate(&self) {
        active::publish(Some(self.store.clone()));
    }

    /// The people the agent keeps notes about, and its own notes.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `Internal` when the store cannot be read.
    pub async fn overview(&self, agent_id: &str) -> AppResult<AgentMemory> {
        self.db.get_agent(agent_id)?;
        let mut people = Vec::new();
        let (candidates, incomplete) = self.candidates(agent_id)?;
        for candidate in candidates {
            let notes = self.list(&user_scope(agent_id, &candidate.user), None).await?;
            if notes.is_empty() {
                continue;
            }
            let waiting_count = notes.iter().filter(|note| note.status == MemoryStatus::Pending).count();
            people.push(MemoryPerson {
                user: candidate.user,
                name: candidate.name,
                kind: candidate.kind,
                note_count: notes.len() - waiting_count,
                waiting_count,
            });
        }
        let agent_notes = self.list(&MemoryScope::agent(None, agent_id), None).await?;
        Ok(AgentMemory {
            agent_id: agent_id.to_owned(),
            people,
            agent_notes: agent_notes.iter().map(MemoryNoteView::from).collect(),
            incomplete,
        })
    }

    /// The notes about `user` (`None`: the agent's own notes), newest first.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` for a user id the store refuses.
    pub async fn notes(&self, agent_id: &str, user: Option<&str>) -> AppResult<Vec<MemoryNoteView>> {
        self.db.get_agent(agent_id)?;
        let notes = self.list(&scope_of(agent_id, user), None).await?;
        Ok(notes.iter().map(MemoryNoteView::from).collect())
    }

    /// What the memory graph holds about `user` (`None`: the agent as a whole).
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` for a user id the store refuses.
    pub async fn graph(&self, agent_id: &str, user: Option<&str>) -> AppResult<MemoryGraphView> {
        self.db.get_agent(agent_id)?;
        let export = self.store.export_user(&scope_of(agent_id, user)).await.map_err(memory_error)?;
        Ok(graph_view(&export))
    }

    /// Removes one note (in use or waiting).
    ///
    /// # Errors
    /// `NotFound` for an unknown agent or note.
    pub async fn delete_note(&self, agent_id: &str, user: Option<&str>, note_id: &str) -> AppResult<()> {
        self.db.get_agent(agent_id)?;
        let scope = scope_of(agent_id, user);
        let target = ForgetTarget::Id(note_id.to_owned());
        let removed = self.store.forget(&scope, &target, &owner_source()).await.map_err(memory_error)?;
        match removed {
            0 => Err(AppError::NotFound("this note".into())),
            _ => Ok(()),
        }
    }

    /// Uses (`approve`) or removes a note that waits for the owner. Only this click approves one.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent or note; `InvalidInput` for a note that does not wait.
    pub async fn decide(
        &self,
        agent_id: &str,
        user: Option<&str>,
        note_id: &str,
        approve: bool,
    ) -> AppResult<Option<MemoryNoteView>> {
        self.db.get_agent(agent_id)?;
        let decided = self
            .store
            .decide(&scope_of(agent_id, user), note_id, approve, &owner_source())
            .await
            .map_err(memory_error)?
            .ok_or_else(|| AppError::NotFound("this note".into()))?;
        Ok(approve.then(|| MemoryNoteView::from(&decided)))
    }

    /// Removes everything the memory keeps for a deleted agent (its folder in the store).
    ///
    /// # Errors
    /// `Internal` when the folder cannot be removed.
    pub fn forget_agent(&self, agent_id: &str) -> AppResult<()> {
        graphrt_memory::check_name("agent", agent_id).map_err(memory_error)?;
        let agent_dir = self.store.root().join("_").join(agent_id);
        match std::fs::remove_dir_all(&agent_dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => {
                log::error!("could not remove the memory of deleted agent {agent_id}: {error}");
                Err(AppError::Internal("what the deleted agent remembered could not be removed".into()))
            }
        }
    }

    /// Erases everything the memory keeps about `user`: their notes and their graph.
    /// Returns how many notes there were. (Lessons about them are `LearningService`'s.)
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` for a user id the store refuses.
    pub async fn erase_person(&self, agent_id: &str, user: &str) -> AppResult<usize> {
        self.db.get_agent(agent_id)?;
        self.store.erase_user(&user_scope(agent_id, user), &owner_source()).await.map_err(memory_error)
    }

    async fn list(
        &self,
        scope: &MemoryScope,
        status: Option<MemoryStatus>,
    ) -> AppResult<Vec<graphrt_core::memory::MemoryRecord>> {
        let filter = ListFilter { status, query: None };
        self.store.list(scope, &filter).await.map_err(memory_error)
    }

    /// Everyone who may have notes: customers, the owner, the checks, then the store's folder.
    fn candidates(&self, agent_id: &str) -> AppResult<(Vec<Candidate>, bool)> {
        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        let mut add = |user: String, name: Option<String>, kind: MemoryPersonKind| {
            if candidates.len() < MAX_PEOPLE && graphrt_memory::check_user(&user).is_ok() && seen.insert(user.clone()) {
                candidates.push(Candidate { user, name, kind });
            }
        };
        for (channel, handle, name) in self.db.conversation_customers(agent_id)? {
            // The same rule runs use: a customer known only by a display name has no notes.
            if !crate::conversations::bot::is_memory_person(&channel, &handle) {
                continue;
            }
            let name = Some(name).filter(|name| !name.trim().is_empty());
            add(handle, name, MemoryPersonKind::Customer);
        }
        add(APP_USER.to_owned(), None, MemoryPersonKind::You);
        let scan = stored_users(&self.store.root().join("_").join(agent_id));
        for user in scan.users {
            let kind = if user.starts_with(CHECKS_USER) { MemoryPersonKind::Checks } else { MemoryPersonKind::Other };
            add(user, None, kind);
        }
        let incomplete = scan.incomplete || candidates.len() >= MAX_PEOPLE;
        Ok((candidates, incomplete))
    }
}

#[derive(Debug)]
struct Candidate {
    user: String,
    name: Option<String>,
    kind: MemoryPersonKind,
}

fn user_scope(agent_id: &str, user: &str) -> MemoryScope {
    MemoryScope::user(None, agent_id, user)
}

fn scope_of(agent_id: &str, user: Option<&str>) -> MemoryScope {
    match user {
        Some(user) => user_scope(agent_id, user),
        None => MemoryScope::agent(None, agent_id),
    }
}

fn owner_source() -> MemorySource {
    MemorySource { actor: OWNER_ACTOR.to_owned(), ..MemorySource::default() }
}

/// The user ids kept in the store's folder of one agent (`users/<hash>/notes.json` holds
/// the id itself). The folder layout is graphrt-memory's: a folder it cannot read is
/// skipped with a warning, and the other sources of people still apply.
fn stored_users(agent_dir: &Path) -> StoredUsers {
    #[derive(Deserialize)]
    struct NotesFile {
        #[serde(default)]
        user: Option<String>,
    }
    let users_dir = agent_dir.join("users");
    let mut found = StoredUsers::default();
    let entries = match std::fs::read_dir(&users_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return found,
        Err(error) => {
            log::warn!("could not list the people in {}: {error}", users_dir.display());
            found.incomplete = true;
            return found;
        }
    };
    for entry in entries {
        if found.users.len() >= MAX_PEOPLE {
            found.incomplete = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!("could not read an entry of {}: {error}", users_dir.display());
                found.incomplete = true;
                continue;
            }
        };
        let notes_path: PathBuf = entry.path().join("notes.json");
        let text = match std::fs::read_to_string(&notes_path) {
            Ok(text) => text,
            // A person whose notes are gone but whose graph is left has nothing to list.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                log::warn!("could not read {}: {error}", notes_path.display());
                found.incomplete = true;
                continue;
            }
        };
        match serde_json::from_str::<NotesFile>(&text) {
            Ok(NotesFile { user: Some(user) }) => found.users.push(user),
            Ok(NotesFile { user: None }) => {
                log::warn!("{} names no person", notes_path.display());
                found.incomplete = true;
            }
            Err(error) => {
                log::warn!("could not read {}: {error}", notes_path.display());
                found.incomplete = true;
            }
        }
    }
    found
}

/// The people found in the store's folder; `incomplete` when some could not be read.
#[derive(Debug, Default)]
struct StoredUsers {
    users: Vec<String>,
    incomplete: bool,
}

/// The graph part of an export (`{graph: {entities, relations}}` or `graph_error`).
fn graph_view(export: &serde_json::Value) -> MemoryGraphView {
    #[derive(Deserialize)]
    struct Entity {
        id: String,
        name: String,
    }
    #[derive(Deserialize)]
    struct Relation {
        id: String,
        #[serde(default)]
        text: String,
        source: String,
        relation: String,
        target: String,
        #[serde(default)]
        valid_from_ms: Option<u64>,
        #[serde(default)]
        valid_to_ms: Option<u64>,
        #[serde(default)]
        closed_ms: Option<u64>,
        status: MemoryStatus,
    }
    #[derive(Deserialize)]
    struct Graph {
        #[serde(default)]
        entities: Vec<Entity>,
        #[serde(default)]
        relations: Vec<Relation>,
    }
    let unreadable = MemoryGraphView { entities: Vec::new(), facts: Vec::new(), unreadable: true };
    if export.get("graph_error").is_some() {
        return unreadable;
    }
    let Some(graph) = export.get("graph") else {
        return MemoryGraphView { entities: Vec::new(), facts: Vec::new(), unreadable: false };
    };
    let graph: Graph = match serde_json::from_value(graph.clone()) {
        Ok(graph) => graph,
        Err(error) => {
            log::warn!("could not read a memory graph: {error}");
            return unreadable;
        }
    };
    // Relations name their entities by id.
    let name_of = |id: &str| {
        graph.entities.iter().find(|entity| entity.id == id).map_or_else(|| id.to_owned(), |entity| entity.name.clone())
    };
    let facts = graph
        .relations
        .iter()
        .map(|relation| {
            let (source, target) = (name_of(&relation.source), name_of(&relation.target));
            (relation, source, target)
        })
        .map(|(relation, source, target)| MemoryFactView {
            text: match relation.text.trim() {
                "" => format!("{source} {} {target}", relation.relation.replace('_', " ")),
                text => text.to_owned(),
            },
            id: relation.id.clone(),
            source,
            relation: relation.relation.clone(),
            target,
            valid_from: relation.valid_from_ms.and_then(rfc3339),
            valid_to: relation.valid_to_ms.and_then(rfc3339),
            is_closed: relation.closed_ms.is_some(),
            status: relation.status,
        })
        .collect();
    let entities = graph.entities.iter().map(|entity| entity.name.clone()).collect();
    MemoryGraphView { entities, facts, unreadable: false }
}

fn memory_error(error: MemoryError) -> AppError {
    match error.kind {
        "memory_scope" | "memory_invalid" | "memory_limit" | "memory_full" => AppError::InvalidInput(error.message),
        _ => {
            log::error!("memory store ({}): {}", error.kind, error.message);
            AppError::Internal("what this agent remembers could not be read or changed".into())
        }
    }
}
