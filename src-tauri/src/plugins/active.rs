//! The process-wide plugin snapshot every run, compile and builder prompt uses.
//!
//! `flow::node_registry()` and the tool registry of every run are built in many
//! places that have no access to `AppState`, so the app's [`super::PluginService`]
//! publishes its current snapshot here (on start-up and after every install,
//! update, removal, trust or setting change). Readers take an `Arc` clone, so
//! a run keeps the plugins it compiled with even if they change meanwhile.

use std::sync::{Arc, RwLock};

use graphrt_core::tool::ToolRegistry;

use super::host::{PluginSnapshot, SharedSnapshot};

static ACTIVE_SNAPSHOT: RwLock<Option<SharedSnapshot>> = RwLock::new(None);

/// Replaces the published snapshot (`None` clears it).
pub(crate) fn publish(snapshot: Option<SharedSnapshot>) {
    match ACTIVE_SNAPSHOT.write() {
        Ok(mut slot) => *slot = snapshot,
        Err(poisoned) => *poisoned.into_inner() = snapshot,
    }
}

/// The published snapshot, if the app published one.
pub(crate) fn current() -> Option<Arc<PluginSnapshot>> {
    match ACTIVE_SNAPSHOT.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// Adds the installed plugins' node kinds to `registry` (called by `flow::node_registry`).
pub fn register_plugin_nodes(registry: &mut graphrt_core::Registry) {
    if let Some(snapshot) = current() {
        snapshot.register_nodes(registry);
    }
}

/// Adds the installed plugins' tool providers to a run's tool registry
/// (next to the `agents` provider).
pub fn add_plugin_tools(tools: &mut ToolRegistry) {
    if let Some(snapshot) = current() {
        snapshot.add_tools(tools);
    }
}
