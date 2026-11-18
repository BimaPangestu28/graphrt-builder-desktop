//! Install progress and load errors sent to the UI as the Tauri event [`PLUGIN_EVENT`].

use tauri::{AppHandle, Emitter};

use super::models::PluginEvent;

/// Name of the Tauri event carrying [`PluginEvent`].
pub const PLUGIN_EVENT: &str = "plugin-event";

/// Delivers plugin events. The app emits Tauri events; tests collect them.
pub trait PluginEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, event: PluginEvent);
}

/// Emits [`PLUGIN_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriPluginEventSink {
    app_handle: AppHandle,
}

impl TauriPluginEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl PluginEventSink for TauriPluginEventSink {
    fn send(&self, event: PluginEvent) {
        if let Err(error) = self.app_handle.emit(PLUGIN_EVENT, event) {
            log::warn!("could not emit plugin event: {error}");
        }
    }
}

/// Drops every event.
#[derive(Debug, Default)]
pub struct DiscardPluginEvents;

impl PluginEventSink for DiscardPluginEvents {
    fn send(&self, _event: PluginEvent) {}
}
