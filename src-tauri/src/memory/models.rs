//! What the memory tab of "What this agent learned" reads (camelCase on the wire).
//!
//! Views over `graphrt_memory`'s notes. Enum values keep the runtime's snake_case names,
//! so the UI words them itself in the person's language.

use graphrt_core::memory::{MemoryKind, MemoryRecord, MemoryStatus, MemoryTrust};
use serde::{Deserialize, Serialize};

/// Who a person in the memory list is, so the UI can label them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryPersonKind {
    /// Someone who wrote to a chatbot of the agent (the handle of their conversation).
    Customer,
    /// The owner, in runs started in the app (Test, Run now).
    You,
    /// The agent's tests and release checks.
    Checks,
    /// Found in the memory folder only (for example after their conversation was deleted).
    Other,
}

/// One person the agent keeps notes about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPerson {
    /// The user id runs use (`sys.user_id`): a customer handle, or the app's own id.
    pub user: String,
    /// The customer's name from their latest conversation; `None` when there is none.
    pub name: Option<String>,
    pub kind: MemoryPersonKind,
    /// Notes in use.
    pub note_count: usize,
    /// Notes waiting for the owner.
    pub waiting_count: usize,
}

/// One note of long term memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNoteView {
    pub id: String,
    pub text: String,
    pub kind: MemoryKind,
    /// `pending` waits for the owner and is never recalled before it is approved.
    pub status: MemoryStatus,
    /// Where the words came from: `owner`, `user_stated`, `model_inferred`,
    /// `model_after_tools` or `tool_derived`.
    pub origin: MemoryTrust,
    /// RFC 3339.
    pub saved_at: Option<String>,
    pub updated_at: Option<String>,
    /// When it lapses (notes of kind `event` and `note`); `None` keeps it.
    pub expires_at: Option<String>,
    /// How often a run recalled it.
    pub uses: u64,
}

impl From<&MemoryRecord> for MemoryNoteView {
    fn from(record: &MemoryRecord) -> Self {
        Self {
            id: record.id.clone(),
            text: record.text.clone(),
            kind: record.kind,
            status: record.status,
            origin: record.trust,
            saved_at: rfc3339(record.created_ms),
            updated_at: rfc3339(record.updated_ms),
            expires_at: record.expires_ms.and_then(rfc3339),
            uses: record.uses,
        }
    }
}

/// The memory tab: the people the agent remembers and its own notes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemory {
    pub agent_id: String,
    /// People with at least one note, customers first (most recently active first).
    pub people: Vec<MemoryPerson>,
    /// Notes of the agent as a whole: what runs without a person proposed, and what the owner added.
    pub agent_notes: Vec<MemoryNoteView>,
}

/// A fact of the memory graph, as the owner reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFactView {
    pub id: String,
    /// The sentence the fact was read from, e.g. "Dana works at Acme".
    pub text: String,
    pub source: String,
    pub relation: String,
    pub target: String,
    /// RFC 3339: when it was true in the world, as the note said.
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    /// A newer fact replaced it (it is kept for "what was true then").
    pub is_closed: bool,
    pub status: MemoryStatus,
}

/// What the agent's memory graph holds about one person (or about the agent as a whole).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGraphView {
    /// Names of the people, places, organizations and products it knows.
    pub entities: Vec<String>,
    pub facts: Vec<MemoryFactView>,
    /// The graph file could not be read (the notes are fine).
    pub unreadable: bool,
}

/// What forgetting a person removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgottenPerson {
    pub notes: usize,
    pub lessons: usize,
}

pub(crate) fn rfc3339(milliseconds: u64) -> Option<String> {
    let milliseconds = i64::try_from(milliseconds).ok()?;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(milliseconds).map(|time| time.to_rfc3339())
}
