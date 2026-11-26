//! The process-wide skill store every run uses.
//!
//! Engines are built in places without `AppState` (runs, chatbot turns, nested agent
//! calls), so the app's [`super::SkillService`] publishes its store here once at start-up,
//! the way `plugins::active` publishes the plugin snapshot. Without a published store an
//! agent that lists skills fails with graphrt's "missing service" error instead of running
//! without them.

use std::sync::{Arc, RwLock};

use graphrt_core::skill::Skills;
use graphrt_skill::{SkillSet, SkillStore};

static ACTIVE_STORE: RwLock<Option<Arc<SkillStore>>> = RwLock::new(None);

/// Replaces the published store (`None` clears it).
pub(crate) fn publish(store: Option<Arc<SkillStore>>) {
    match ACTIVE_STORE.write() {
        Ok(mut slot) => *slot = store,
        Err(poisoned) => *poisoned.into_inner() = store,
    }
}

/// The skill service for a run's engine, if the app published a store. Opening it reads
/// nothing: the store is read when an agent that lists skills runs.
pub(crate) fn skills_service() -> Option<Skills> {
    let store = match ACTIVE_STORE.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }?;
    Some(SkillSet::new(store).into_service())
}
