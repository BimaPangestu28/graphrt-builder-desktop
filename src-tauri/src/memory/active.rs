//! The process-wide memory store every run reads and writes (see `skills::active` for why).

use std::sync::{Arc, RwLock};

use graphrt_core::memory::Memories;
use graphrt_memory::MemoryStore;

static ACTIVE_STORE: RwLock<Option<Arc<MemoryStore>>> = RwLock::new(None);

/// Replaces the published store (`None` clears it).
pub(crate) fn publish(store: Option<Arc<MemoryStore>>) {
    match ACTIVE_STORE.write() {
        Ok(mut slot) => *slot = store,
        Err(poisoned) => *poisoned.into_inner() = store,
    }
}

/// The memory service for a run's engine, if the app published a store. Agent steps with
/// `long_term_memory` save and recall notes through it (the runtime's write gate decides
/// what is used at once and what waits for the owner).
pub(crate) fn memories_service() -> Option<Memories> {
    let store = match ACTIVE_STORE.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }?;
    Some(MemoryStore::clone(&store).into_service())
}
