//! Which agents the builder is changing right now (a chat revision in flight).
//!
//! While the builder works on an agent, the Nodes view is read-only and
//! `agent_graph::save_agent_graph` refuses edits with `AppError::BuilderBusy`,
//! so a hand edit never races a chat change. A revision holds a
//! [`BuilderEditGuard`] for as long as it runs; dropping it (also on error or
//! panic) releases the agent. A listener set once at start-up (the app emits
//! the `agent-edit-state` event from it) hears every change.
//!
//! Process-wide, like `plugins::active`: revisions run from places that have no
//! `AppState`, and the state is only meaningful for this running app.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Called with `(agent_id, builder_busy)` whenever an agent's state changes.
pub type EditStateListener = Box<dyn Fn(&str, bool) + Send + Sync>;

/// Revisions in flight per agent (a count: two windows may revise the same agent).
static BUSY_AGENTS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);
static LISTENER: OnceLock<EditStateListener> = OnceLock::new();

/// Marks `agent_id` as being changed by the builder until the guard is dropped.
pub fn begin_builder_edit(agent_id: &str) -> BuilderEditGuard {
    let became_busy = update_count(agent_id, |count| *count += 1) == 1;
    if became_busy {
        notify(agent_id, true);
    }
    BuilderEditGuard { agent_id: agent_id.to_owned() }
}

/// True while a builder revision of `agent_id` is running.
pub fn is_builder_editing(agent_id: &str) -> bool {
    with_busy_agents(|busy| busy.get(agent_id).is_some_and(|count| *count > 0))
}

/// Sets the listener told about every busy / idle change. Only the first call wins
/// (the app sets it once at start-up); later calls are ignored and return `false`.
pub fn set_edit_state_listener(listener: EditStateListener) -> bool {
    LISTENER.set(listener).is_ok()
}

/// Holds an agent busy; see [`begin_builder_edit`].
#[derive(Debug)]
#[must_use = "the agent is released as soon as the guard is dropped"]
pub struct BuilderEditGuard {
    agent_id: String,
}

impl Drop for BuilderEditGuard {
    fn drop(&mut self) {
        let remaining = update_count(&self.agent_id, |count| *count = count.saturating_sub(1));
        if remaining == 0 {
            with_busy_agents(|busy| busy.remove(&self.agent_id));
            notify(&self.agent_id, false);
        }
    }
}

/// Applies `change` to the agent's count and returns the new count.
fn update_count(agent_id: &str, change: impl FnOnce(&mut usize)) -> usize {
    with_busy_agents(|busy| {
        let count = busy.entry(agent_id.to_owned()).or_insert(0);
        change(count);
        *count
    })
}

fn with_busy_agents<T>(read: impl FnOnce(&mut HashMap<String, usize>) -> T) -> T {
    // A poisoned lock only means a panic elsewhere; the map itself stays consistent.
    let mut slot = BUSY_AGENTS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    read(slot.get_or_insert_with(HashMap::new))
}

fn notify(agent_id: &str, builder_busy: bool) {
    if let Some(listener) = LISTENER.get() {
        listener(agent_id, builder_busy);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_is_busy_while_any_guard_lives() {
        let agent_id = uuid::Uuid::new_v4().to_string();
        assert!(!is_builder_editing(&agent_id));
        let first = begin_builder_edit(&agent_id);
        let second = begin_builder_edit(&agent_id);
        assert!(is_builder_editing(&agent_id));
        drop(first);
        assert!(is_builder_editing(&agent_id), "the second revision still runs");
        drop(second);
        assert!(!is_builder_editing(&agent_id));
    }

    #[test]
    fn other_agents_are_not_affected() {
        let busy_agent = uuid::Uuid::new_v4().to_string();
        let _guard = begin_builder_edit(&busy_agent);
        assert!(!is_builder_editing("another-agent"));
    }
}
