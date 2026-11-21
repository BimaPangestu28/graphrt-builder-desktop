//! "Stop the builder": cancels chat revisions that are still running.
//!
//! Every chat revision registers a [`RevisionStopSignal`] for its agent while it
//! runs. [`stop_revisions`] fires the signals of an agent; the revision then drops
//! its future (which aborts the model call in flight and drops the
//! `edit_lock::BuilderEditGuard`, so the Nodes view can edit again) and ends with
//! `AppError::Stopped`. Nothing of a stopped revision is saved except the chat note.
//!
//! Process-wide like `edit_lock`: the Nodes view's Stop button and the chat may live
//! in different windows than the revision.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::error::{AppError, AppResult};

/// Running revisions per agent: registration id and its signal.
type RunningRevisions = HashMap<String, Vec<(u64, Arc<Notify>)>>;

static RUNNING_REVISIONS: Mutex<Option<RunningRevisions>> = Mutex::new(None);
static NEXT_REGISTRATION_ID: AtomicU64 = AtomicU64::new(1);

/// Registers a running revision of `agent_id`; it stays stoppable until the signal is dropped.
pub fn watch_for_stop(agent_id: &str) -> RevisionStopSignal {
    let registration_id = NEXT_REGISTRATION_ID.fetch_add(1, Ordering::Relaxed);
    let notify = Arc::new(Notify::new());
    with_running(|running| running.entry(agent_id.to_owned()).or_default().push((registration_id, notify.clone())));
    RevisionStopSignal { agent_id: agent_id.to_owned(), registration_id, notify }
}

/// Stops every running revision of `agent_id`. Returns true when at least one was
/// running (and is now stopping).
pub fn stop_revisions(agent_id: &str) -> bool {
    with_running(|running| {
        let Some(signals) = running.get(agent_id) else { return false };
        // `notify_one` keeps a permit, so a revision that is not waiting yet still stops.
        signals.iter().for_each(|(_, notify)| notify.notify_one());
        !signals.is_empty()
    })
}

/// Runs `revision` until it finishes or the user stops it (`AppError::Stopped`).
/// Stopping drops `revision`, so everything it holds (model stream, edit lock) is released.
pub async fn run_stoppable<T>(agent_id: &str, revision: impl Future<Output = AppResult<T>>) -> AppResult<T> {
    let signal = watch_for_stop(agent_id);
    tokio::select! {
        outcome = revision => outcome,
        () = signal.stopped() => {
            log::info!("the builder change of agent {agent_id} was stopped by the user");
            Err(AppError::Stopped)
        }
    }
}

/// A running revision's stop signal; dropping it unregisters the revision.
#[derive(Debug)]
pub struct RevisionStopSignal {
    agent_id: String,
    registration_id: u64,
    notify: Arc<Notify>,
}

impl RevisionStopSignal {
    /// Resolves once [`stop_revisions`] was called for this agent.
    pub async fn stopped(&self) {
        self.notify.notified().await;
    }
}

impl Drop for RevisionStopSignal {
    fn drop(&mut self) {
        with_running(|running| {
            if let Some(signals) = running.get_mut(&self.agent_id) {
                signals.retain(|(registration_id, _)| *registration_id != self.registration_id);
                if signals.is_empty() {
                    running.remove(&self.agent_id);
                }
            }
        });
    }
}

fn with_running<T>(read: impl FnOnce(&mut RunningRevisions) -> T) -> T {
    // A poisoned lock only means a panic elsewhere; the map itself stays consistent.
    let mut slot = RUNNING_REVISIONS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    read(slot.get_or_insert_with(HashMap::new))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_an_idle_agent_reports_nothing_was_running() {
        assert!(!stop_revisions(&uuid::Uuid::new_v4().to_string()));
    }

    #[tokio::test]
    async fn a_stopped_revision_ends_with_stopped_and_unregisters() {
        let agent_id = uuid::Uuid::new_v4().to_string();
        let never_finishes = std::future::pending::<AppResult<()>>();
        let stopping = async {
            tokio::task::yield_now().await;
            assert!(stop_revisions(&agent_id), "the revision is registered while it runs");
        };
        let (outcome, ()) = tokio::join!(run_stoppable(&agent_id, never_finishes), stopping);
        assert!(matches!(outcome, Err(AppError::Stopped)));
        assert!(!stop_revisions(&agent_id), "a finished revision is no longer stoppable");
    }

    #[tokio::test]
    async fn a_finished_revision_returns_its_outcome() {
        let agent_id = uuid::Uuid::new_v4().to_string();
        let outcome = run_stoppable(&agent_id, async { Ok(7) }).await;
        assert_eq!(outcome.unwrap(), 7);
        assert!(!stop_revisions(&agent_id));
    }
}
