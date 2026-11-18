//! Sync progress sent to the UI as the Tauri event [`KNOWLEDGE_EVENT`].

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::models::{KnowledgeBase, KnowledgeSource};

/// Name of the Tauri event carrying [`KnowledgeEvent`].
pub const KNOWLEDGE_EVENT: &str = "knowledge-event";

/// What changed while a knowledge base syncs. Serialized as
/// `{ "type": "source_updated", "knowledgeBaseId": "...", ... }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum KnowledgeEvent {
    /// A sync began; sources are processed one after another.
    SyncStarted { knowledge_base_id: String },
    /// A source changed state (reading -> indexed / failed). `progress_percent`
    /// is set while a folder is being read.
    SourceUpdated { knowledge_base_id: String, source: KnowledgeSource, progress_percent: Option<u8> },
    /// The sync ended; the knowledge base carries the new totals.
    SyncFinished { knowledge_base_id: String, knowledge_base: KnowledgeBase },
}

/// Delivers knowledge events. The app emits Tauri events; tests collect them.
pub trait KnowledgeEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, event: KnowledgeEvent);
}

/// Emits [`KNOWLEDGE_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriKnowledgeEventSink {
    app_handle: AppHandle,
}

impl TauriKnowledgeEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl KnowledgeEventSink for TauriKnowledgeEventSink {
    fn send(&self, event: KnowledgeEvent) {
        if let Err(error) = self.app_handle.emit(KNOWLEDGE_EVENT, event) {
            log::warn!("could not emit knowledge event: {error}");
        }
    }
}

/// Drops every event (for code paths without a UI).
#[derive(Debug, Default)]
pub struct DiscardKnowledgeEvents;

impl KnowledgeEventSink for DiscardKnowledgeEvents {
    fn send(&self, _event: KnowledgeEvent) {}
}
