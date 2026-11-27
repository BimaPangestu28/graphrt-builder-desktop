//! Notifications to paired phones when a run on this computer fails or waits for a person:
//! graphrt's Web Push notifier, fed with the same notice `graphrt serve` sends
//! ([`graphrt_cli::notify::notice_for`]).
//!
//! [`PhonePushSink`] sits in the chain of run event sinks. It never delays or fails a run:
//! the notice is sent from its own task, and what goes wrong is logged. Test runs of the
//! builder say nothing, as on the desktop. Nothing is sent while Phone access is off or no
//! phone turned notifications on.

use std::sync::Arc;

use graphrt_cli::notify::{notice_for, Notifier};

use super::{wire, PhoneAccess};
use crate::engine::{RunEventPayload, RunEventSink};
use crate::storage::models::{RunStatus, RunTrigger};

/// Passes every event on, and notifies phones about runs that need a person.
#[derive(Debug)]
pub struct PhonePushSink {
    inner: Arc<dyn RunEventSink>,
    access: Arc<PhoneAccess>,
}

impl PhonePushSink {
    pub fn new(inner: Arc<dyn RunEventSink>, access: Arc<PhoneAccess>) -> Self {
        Self { inner, access }
    }

    fn notify(&self, payload: &RunEventPayload) {
        if !is_attention_status_change(payload) {
            return;
        }
        let Some(push) = self.access.notifier() else { return };
        let database = self.access.database();
        let run = match database.get_run(&payload.run_id) {
            Ok(run) => run,
            Err(error) => {
                log::warn!("phone access: not notifying about run {}: {error}", payload.run_id);
                return;
            }
        };
        if run.trigger == RunTrigger::Test {
            return;
        }
        let agent_name =
            database.get_agent(&run.agent_id).map(|agent| agent.name).unwrap_or_else(|_| "Agent".to_owned());
        let record = wire::run_record(&run, &agent_name, 0, None);
        let Some(notice) = notice_for(&record) else { return };
        tauri::async_runtime::spawn(async move {
            if let Err(error) = push.notify(&notice).await {
                log::warn!("phone access: run {}: notification failed: {error}", notice.run_id);
            }
        });
    }
}

impl RunEventSink for PhonePushSink {
    fn send(&self, payload: RunEventPayload) {
        self.notify(&payload);
        self.inner.send(payload);
    }
}

/// The one `status_changed` event of a run reaching `Paused` or `Failed`.
fn is_attention_status_change(payload: &RunEventPayload) -> bool {
    let is_status_change = payload.event.get("type").and_then(serde_json::Value::as_str) == Some("status_changed");
    is_status_change && matches!(payload.status, RunStatus::Paused | RunStatus::Failed)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn payload(kind: &str, status: RunStatus) -> RunEventPayload {
        RunEventPayload { run_id: "run-1".into(), agent_id: "a".into(), seq: 3, status, event: json!({"type": kind}) }
    }

    #[test]
    fn only_a_pause_or_a_failure_is_worth_a_notification() {
        assert!(is_attention_status_change(&payload("status_changed", RunStatus::Paused)));
        assert!(is_attention_status_change(&payload("status_changed", RunStatus::Failed)));
        assert!(!is_attention_status_change(&payload("status_changed", RunStatus::Succeeded)));
        assert!(!is_attention_status_change(&payload("run_paused", RunStatus::Paused)));
    }
}
