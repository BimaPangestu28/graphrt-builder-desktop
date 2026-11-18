//! Emits conversation events to every window as the Tauri event [`super::CONVERSATION_EVENT`].

use tauri::{AppHandle, Emitter};

use super::{ConversationEventPayload, ConversationEventSink, CONVERSATION_EVENT};

#[derive(Debug)]
pub struct TauriConversationEventSink {
    app_handle: AppHandle,
}

impl TauriConversationEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl ConversationEventSink for TauriConversationEventSink {
    fn send(&self, payload: ConversationEventPayload) {
        if let Err(error) = self.app_handle.emit(CONVERSATION_EVENT, payload) {
            log::warn!("could not emit conversation event: {error}");
        }
    }
}
