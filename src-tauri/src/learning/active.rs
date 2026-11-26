//! The process-wide lesson store every run reads from (see `skills::active` for why).

use std::sync::{Arc, RwLock};

use graphrt_core::learning::Lessons;
use graphrt_learn::LessonStore;

static ACTIVE_STORE: RwLock<Option<Arc<LessonStore>>> = RwLock::new(None);

/// Replaces the published store (`None` clears it).
pub(crate) fn publish(store: Option<Arc<LessonStore>>) {
    match ACTIVE_STORE.write() {
        Ok(mut slot) => *slot = store,
        Err(poisoned) => *poisoned.into_inner() = store,
    }
}

/// The lesson service for a run's engine, if the app published a store. A run only reads
/// approved lessons through it; nothing is learned during a run.
pub(crate) fn lessons_service() -> Option<Lessons> {
    let store = match ACTIVE_STORE.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }?;
    Some(store.into_service())
}
