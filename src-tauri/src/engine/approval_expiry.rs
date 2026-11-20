//! Expires approvals that waited past their deadline (see `approval_pauses`).
//!
//! A background task checks the paused runs every [`CHECK_INTERVAL`] (and once
//! right at start-up, so approvals that expired while the app was closed are
//! handled first). For every expired question it stores an
//! `approval_timed_out` event in the run log, then applies the step's timeout
//! action:
//! - `stop`: the run ends as `aborted` with [`TIMED_OUT_STOP_MESSAGE`]. When
//!   several questions expire at once and any of them says stop, the run stops.
//! - `answer`: the run resumes with that button and the fields' defaults (one
//!   resume answering every expired question). Questions that have not expired
//!   stay waiting with their own deadlines. When the resume itself cannot
//!   start (a missing key, a deleted version...) the run fails, so it is not
//!   retried on every check.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::{Map, Value as Json};

use super::approval_pauses::{find_expired_approvals, ExpiredApproval, TimeoutAction};
use super::{RunEventPayload, RunManager};
use crate::storage::models::{Run, RunFilter, RunStatus};

/// How often paused runs are checked for expired approvals.
const CHECK_INTERVAL: Duration = Duration::from_secs(15);
/// Paused runs looked at per check.
const PAUSED_RUNS_LIMIT: i64 = 1_000;
/// Error message of a run stopped because nobody answered in time.
pub(crate) const TIMED_OUT_STOP_MESSAGE: &str = "No answer before the time limit, so the run was stopped";

/// Starts the background task that expires approvals.
pub(crate) fn spawn_approval_expiry(runs: Arc<RunManager>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(CHECK_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            let expired_count = runs.expire_due_approvals(Utc::now()).await;
            if expired_count > 0 {
                log::info!("{expired_count} approvals timed out");
            }
        }
    });
}

impl RunManager {
    /// Applies the timeout action of every approval whose deadline is at or before `now`.
    /// Failures are logged per run; returns how many questions expired.
    pub async fn expire_due_approvals(&self, now: DateTime<Utc>) -> usize {
        let filter = RunFilter { agent_id: None, status: Some(RunStatus::Paused), limit: Some(PAUSED_RUNS_LIMIT) };
        let paused_runs = match self.db.list_runs(&filter) {
            Ok(paused_runs) => paused_runs,
            Err(error) => {
                log::warn!("could not list paused runs to expire approvals: {error}");
                return 0;
            }
        };
        let mut expired_count = 0;
        for run in paused_runs {
            let expired = find_expired_approvals(run.pause_reasons.as_ref(), now);
            if expired.is_empty() {
                continue;
            }
            expired_count += expired.len();
            self.apply_timeouts(&run, &expired).await;
        }
        expired_count
    }

    async fn apply_timeouts(&self, run: &Run, expired: &[ExpiredApproval]) {
        for approval in expired {
            self.record_timeout_event(run, approval);
        }
        let stops = expired.iter().any(|approval| approval.on_timeout == TimeoutAction::Stop);
        if stops {
            if let Err(error) = self.db.finish_run(&run.id, RunStatus::Aborted, None, Some(TIMED_OUT_STOP_MESSAGE)) {
                log::warn!("could not stop run {} after its approval timed out: {error}", run.id);
                return;
            }
            self.driver_for(run).send_status(&run.id, RunStatus::Aborted);
            return;
        }
        let answers: Map<String, Json> = expired
            .iter()
            .map(|approval| {
                (crate::run_review::resume_key(&approval.frame, &approval.node_id), approval.answer.clone())
            })
            .collect();
        if let Err(error) = self.resume_run(&run.id, Json::Object(answers)).await {
            let still_paused = self.db.get_run(&run.id).is_ok_and(|current| current.status == RunStatus::Paused);
            if still_paused {
                log::warn!("could not continue run {} after its approval timed out: {error}", run.id);
                let message = format!("An approval timed out, but the run could not continue: {error}");
                self.driver_for(run).fail_run(&run.id, &message);
            }
        }
    }

    /// Stores `approval_timed_out` in the run log and sends it to the UI.
    fn record_timeout_event(&self, run: &Run, approval: &ExpiredApproval) {
        let event = approval.to_event();
        match self.db.append_run_event(&run.id, &event) {
            Ok(seq) => self.sink.send(RunEventPayload {
                run_id: run.id.clone(),
                agent_id: run.agent_id.clone(),
                seq,
                status: RunStatus::Paused,
                event,
            }),
            Err(error) => log::warn!("could not store the timeout of run {}: {error}", run.id),
        }
    }
}
