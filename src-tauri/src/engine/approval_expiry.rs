//! Expires approvals that waited past their deadline (see `approval_pauses`).
//!
//! A background task checks the paused runs once right at start-up (so
//! approvals that expired while the app was closed are handled first), then
//! sleeps until the earliest deadline of any waiting question, at most
//! [`MAX_CHECK_DELAY`]. A run that pauses wakes it early
//! ([`RunManager::approval_wakeup`]), so a new, shorter deadline is never
//! missed. With nothing waiting, it only wakes every [`MAX_CHECK_DELAY`]. For
//! every expired question it stores an `approval_timed_out` event in the run
//! log, then applies the step's timeout action:
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

use super::approval_pauses::{earliest_deadline, find_expired_approvals, ExpiredApproval, TimeoutAction};
use super::{RunEventPayload, RunManager};
use crate::storage::models::{Run, RunStatus};

/// Longest sleep between two checks (also the check interval while nothing waits).
const MAX_CHECK_DELAY: Duration = Duration::from_secs(60);
/// Shortest sleep between two checks, so a deadline that cannot be applied (e.g. the
/// database refuses the change) is retried calmly instead of in a busy loop.
const MIN_CHECK_DELAY: Duration = Duration::from_secs(1);
/// Error message of a run stopped because nobody answered in time.
pub(crate) const TIMED_OUT_STOP_MESSAGE: &str = "No answer before the time limit, so the run was stopped";

/// Starts the background task that expires approvals.
pub(crate) fn spawn_approval_expiry(runs: Arc<RunManager>) {
    tauri::async_runtime::spawn(async move {
        let wakeup = runs.approval_wakeup.clone();
        loop {
            let expired_count = runs.expire_due_approvals(Utc::now()).await;
            if expired_count > 0 {
                log::info!("{expired_count} approvals timed out");
            }
            let delay = runs.next_approval_check_delay(Utc::now());
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                () = wakeup.notified() => {}
            }
        }
    });
}

/// How long to sleep from `now` until `deadline` (the earliest waiting deadline),
/// within [`MIN_CHECK_DELAY`] and [`MAX_CHECK_DELAY`].
fn check_delay(deadline: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Duration {
    let Some(deadline) = deadline else { return MAX_CHECK_DELAY };
    // A deadline in the past (`to_std` fails on negative) is checked again soon.
    let until_deadline = (deadline - now).to_std().unwrap_or(Duration::ZERO);
    until_deadline.clamp(MIN_CHECK_DELAY, MAX_CHECK_DELAY)
}

impl RunManager {
    /// Applies the timeout action of every approval whose deadline is at or before `now`.
    /// Failures are logged per run; returns how many questions expired.
    pub async fn expire_due_approvals(&self, now: DateTime<Utc>) -> usize {
        let Some(paused_runs) = self.paused_runs() else { return 0 };
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

    /// How long the expiry task may sleep from `now`: until the earliest deadline of any
    /// paused run's question, within [`MIN_CHECK_DELAY`] and [`MAX_CHECK_DELAY`].
    pub(crate) fn next_approval_check_delay(&self, now: DateTime<Utc>) -> Duration {
        let earliest = self
            .paused_runs()
            .unwrap_or_default()
            .iter()
            .filter_map(|run| earliest_deadline(run.pause_reasons.as_ref()))
            .min();
        check_delay(earliest, now)
    }

    /// Every paused run, or `None` (logged) when they cannot be read.
    fn paused_runs(&self) -> Option<Vec<Run>> {
        match self.db.list_paused_runs() {
            Ok(paused_runs) => Some(paused_runs),
            Err(error) => {
                log::warn!("could not list paused runs to expire approvals: {error}");
                None
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seconds_from_epoch: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds_from_epoch, 0).unwrap()
    }

    #[test]
    fn sleeps_until_the_earliest_deadline() {
        assert_eq!(check_delay(Some(at(1_030)), at(1_000)), Duration::from_secs(30));
    }

    #[test]
    fn never_sleeps_longer_than_the_cap() {
        assert_eq!(check_delay(Some(at(10_000)), at(1_000)), MAX_CHECK_DELAY);
        assert_eq!(check_delay(None, at(1_000)), MAX_CHECK_DELAY);
    }

    #[test]
    fn a_passed_deadline_is_checked_again_after_the_shortest_delay() {
        assert_eq!(check_delay(Some(at(900)), at(1_000)), MIN_CHECK_DELAY);
        assert_eq!(check_delay(Some(at(1_000)), at(1_000)), MIN_CHECK_DELAY);
    }
}
