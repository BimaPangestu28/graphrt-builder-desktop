//! Emits run events to every window as the Tauri event [`super::RUN_EVENT`].

use tauri::{AppHandle, Emitter};

use super::{RunEventPayload, RunEventSink, RUN_EVENT};

#[derive(Debug)]
pub struct TauriRunEventSink {
    app_handle: AppHandle,
}

impl TauriRunEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl RunEventSink for TauriRunEventSink {
    fn send(&self, payload: RunEventPayload) {
        if let Err(error) = self.app_handle.emit(RUN_EVENT, payload) {
            log::warn!("could not emit run event: {error}");
        }
    }
}
