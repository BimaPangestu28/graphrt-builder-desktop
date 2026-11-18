//! One scheduler tick: find due triggers, start their runs, plan the next fire.
//!
//! The tick is independent of Tauri and of the run engine (runs are started
//! through [`ScheduledRunStarter`]) and takes the clock as a parameter, so it
//! is tested with a fake starter and fixed times.
//!
//! Ordering matters for safety: a due trigger's next fire time is stored
//! *before* its run is started. If starting fails (missing API key, deleted
//! agent) the trigger has already moved on and does not retry every tick, and
//! if storing fails the run is not started, so a trigger can never fire on
//! every tick. Ticks are additionally serialized by a process-wide lock, so a
//! wake-up tick racing the periodic tick cannot start the same trigger twice.

use chrono::{DateTime, Duration, Utc};
use futures::future::BoxFuture;
use tokio::sync::Mutex;

use super::cron_schedule::{format_fire_time, ZonedSchedule};
use super::TICK_SECONDS;
use crate::engine::RunManager;
use crate::error::AppResult;
use crate::storage::models::{MissedRunPolicy, RunTrigger, Trigger};
use crate::storage::Database;

/// A trigger is "missed" (rather than merely due) when its fire time is more
/// than this many ticks in the past: the computer slept or the app was closed.
const MISSED_AFTER_TICKS: i64 = 2;

/// Serializes ticks so two of them never evaluate the same trigger at once.
static TICK_LOCK: Mutex<()> = Mutex::const_new(());

/// Starts a scheduled run for an agent. Implemented by [`RunManager`]; tests use a fake.
pub trait ScheduledRunStarter: Send + Sync {
    /// Starts the agent's current version with `inputs` and returns the new run's id.
    fn start_scheduled_run<'a>(
        &'a self,
        agent_id: &'a str,
        inputs: serde_json::Value,
    ) -> BoxFuture<'a, AppResult<String>>;
}

impl ScheduledRunStarter for RunManager {
    fn start_scheduled_run<'a>(
        &'a self,
        agent_id: &'a str,
        inputs: serde_json::Value,
    ) -> BoxFuture<'a, AppResult<String>> {
        Box::pin(async move { self.start_run(agent_id, RunTrigger::Schedule, inputs).await.map(|run| run.id) })
    }
}

/// What a tick did, by trigger id. Used for logging and tests.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TickReport {
    /// Triggers whose run was started (on time, or once after a missed window).
    pub started: Vec<String>,
    /// Triggers whose run should have started but `start_scheduled_run` failed.
    pub failed_to_start: Vec<String>,
    /// Missed triggers with `MissedRunPolicy::Skip`: not run, only moved on.
    pub skipped_missed: Vec<String>,
    /// Enabled triggers without a usable `next_fire_at` that got one planned.
    pub planned: Vec<String>,
    /// Due triggers not run because `max_concurrent_runs` scheduled runs were
    /// already running (see [`super::rules::ScheduleRules`]); only moved on.
    pub skipped_busy: Vec<String>,
}

impl TickReport {
    pub fn is_empty(&self) -> bool {
        self.started.is_empty()
            && self.failed_to_start.is_empty()
            && self.skipped_missed.is_empty()
            && self.planned.is_empty()
            && self.skipped_busy.is_empty()
    }
}

/// How many more scheduled runs this tick may start.
#[derive(Debug, Clone, Copy)]
struct RunSlots {
    remaining: usize,
}

impl RunSlots {
    /// Free slots: the limit minus the scheduled runs already running.
    ///
    /// @throws AppError::Database - when the rules or the running runs cannot be read
    fn available(db: &Database) -> AppResult<Self> {
        let limit = super::rules::ScheduleRules::load(db)?.max_concurrent_runs as usize;
        let running = db.count_running_runs(RunTrigger::Schedule)?;
        Ok(Self { remaining: limit.saturating_sub(running) })
    }
}

/// How a single enabled trigger relates to `now`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TriggerTiming {
    NotPlanned,
    NotDue,
    Due,
    Missed,
}

/// Runs one scheduler tick at `now`.
///
/// A failure on one trigger is logged and does not stop the others; only
/// failing to list triggers is returned as an error.
///
/// @param db - storage holding the triggers
/// @param starter - starts runs (the `RunManager` in the app)
/// @param now - the current time (a parameter so tests control the clock)
/// @returns what happened to each trigger that needed attention
/// @throws AppError::Database - when the trigger list cannot be read
pub async fn run_due_triggers(
    db: &Database,
    starter: &dyn ScheduledRunStarter,
    now: DateTime<Utc>,
) -> AppResult<TickReport> {
    let _tick_guard = TICK_LOCK.lock().await;
    // "Pause all agents": skip the whole tick. Triggers due meanwhile are late
    // once the pause ends, so their missed-run policy applies (see `pause`).
    if super::pause::paused_until(db, now)?.is_some() {
        return Ok(TickReport::default());
    }
    let enabled_triggers: Vec<Trigger> =
        db.list_triggers(None)?.into_iter().filter(|trigger| trigger.enabled).collect();
    let mut report = TickReport::default();
    let mut slots = RunSlots::available(db)?;
    for trigger in enabled_triggers {
        process_trigger(db, starter, &trigger, now, &mut slots, &mut report).await;
    }
    Ok(report)
}

async fn process_trigger(
    db: &Database,
    starter: &dyn ScheduledRunStarter,
    trigger: &Trigger,
    now: DateTime<Utc>,
    slots: &mut RunSlots,
    report: &mut TickReport,
) {
    match classify_trigger(trigger, now) {
        TriggerTiming::NotDue => {}
        TriggerTiming::NotPlanned => plan_trigger(db, trigger, now, report),
        TriggerTiming::Due => fire_trigger_if_free(db, starter, trigger, now, slots, report).await,
        TriggerTiming::Missed => match trigger.missed_run_policy {
            MissedRunPolicy::RunOnce => {
                log::info!("trigger {} missed its run while the app was not running; running once now", trigger.id);
                fire_trigger_if_free(db, starter, trigger, now, slots, report).await;
            }
            MissedRunPolicy::Skip => skip_missed_trigger(db, trigger, now, report),
        },
    }
}

fn classify_trigger(trigger: &Trigger, now: DateTime<Utc>) -> TriggerTiming {
    let Some(next_fire_text) = trigger.next_fire_at.as_deref() else {
        return TriggerTiming::NotPlanned;
    };
    let Ok(next_fire_at) = DateTime::parse_from_rfc3339(next_fire_text) else {
        log::warn!("trigger {} has an unreadable next fire time {next_fire_text:?}; replanning", trigger.id);
        return TriggerTiming::NotPlanned;
    };
    let next_fire_at = next_fire_at.with_timezone(&Utc);
    if next_fire_at > now {
        return TriggerTiming::NotDue;
    }
    let missed_threshold = Duration::seconds(MISSED_AFTER_TICKS * TICK_SECONDS as i64);
    if now - next_fire_at > missed_threshold {
        TriggerTiming::Missed
    } else {
        TriggerTiming::Due
    }
}

/// Next fire time strictly after `now`, or `None` with a log line if the stored
/// schedule no longer parses (the trigger then stays dormant until edited).
fn plan_next_fire(trigger: &Trigger, now: DateTime<Utc>) -> Option<String> {
    match ZonedSchedule::parse(&trigger.cron_expression, &trigger.timezone) {
        Ok(schedule) => schedule.next_fire_after(now).map(format_fire_time),
        Err(error) => {
            log::warn!("trigger {} has an invalid schedule: {error}", trigger.id);
            None
        }
    }
}

fn plan_trigger(db: &Database, trigger: &Trigger, now: DateTime<Utc>, report: &mut TickReport) {
    let Some(next_fire_at) = plan_next_fire(trigger, now) else {
        return;
    };
    match db.set_trigger_enabled(&trigger.id, true, Some(&next_fire_at)) {
        Ok(_) => report.planned.push(trigger.id.clone()),
        Err(error) => log::error!("could not plan trigger {}: {error}", trigger.id),
    }
}

/// Stores the fire and the next planned time. Returns false if it could not be stored.
fn advance_trigger(db: &Database, trigger: &Trigger, now: DateTime<Utc>) -> bool {
    let next_fire_at = plan_next_fire(trigger, now);
    match db.record_trigger_fired(&trigger.id, &format_fire_time(now), next_fire_at.as_deref()) {
        Ok(()) => true,
        Err(error) => {
            log::error!("could not record fire of trigger {}; not starting its run: {error}", trigger.id);
            false
        }
    }
}

fn skip_missed_trigger(db: &Database, trigger: &Trigger, now: DateTime<Utc>, report: &mut TickReport) {
    log::info!("trigger {} missed its run while the app was not running; skipping it", trigger.id);
    if advance_trigger(db, trigger, now) {
        report.skipped_missed.push(trigger.id.clone());
    }
}

/// Fires the trigger when a run slot is free; otherwise moves it on without a run.
/// A start that fails does not use up a slot.
async fn fire_trigger_if_free(
    db: &Database,
    starter: &dyn ScheduledRunStarter,
    trigger: &Trigger,
    now: DateTime<Utc>,
    slots: &mut RunSlots,
    report: &mut TickReport,
) {
    if slots.remaining == 0 {
        log::info!("trigger {} skipped: the limit of scheduled runs at the same time is reached", trigger.id);
        if advance_trigger(db, trigger, now) {
            report.skipped_busy.push(trigger.id.clone());
        }
        return;
    }
    let started_before = report.started.len();
    fire_trigger(db, starter, trigger, now, report).await;
    if report.started.len() > started_before {
        slots.remaining -= 1;
    }
}

async fn fire_trigger(
    db: &Database,
    starter: &dyn ScheduledRunStarter,
    trigger: &Trigger,
    now: DateTime<Utc>,
    report: &mut TickReport,
) {
    if !advance_trigger(db, trigger, now) {
        return;
    }
    match starter.start_scheduled_run(&trigger.agent_id, trigger.inputs.clone()).await {
        Ok(run_id) => {
            log::info!("trigger {} started run {run_id} for agent {}", trigger.id, trigger.agent_id);
            report.started.push(trigger.id.clone());
        }
        Err(error) => {
            log::error!("trigger {} could not start a run for agent {}: {error}", trigger.id, trigger.agent_id);
            report.failed_to_start.push(trigger.id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;

    use chrono::TimeZone;
    use serde_json::json;

    use super::*;
    use crate::error::AppError;
    use crate::storage::models::{AgentKind, NewAgent, NewTrigger};

    /// Records every start request; optionally fails them all.
    #[derive(Default)]
    struct FakeRunStarter {
        started_runs: StdMutex<Vec<(String, serde_json::Value)>>,
        should_fail: bool,
    }

    impl FakeRunStarter {
        fn failing() -> Self {
            Self { should_fail: true, ..Self::default() }
        }

        fn start_count(&self) -> usize {
            self.started_runs.lock().unwrap().len()
        }
    }

    impl ScheduledRunStarter for FakeRunStarter {
        fn start_scheduled_run<'a>(
            &'a self,
            agent_id: &'a str,
            inputs: serde_json::Value,
        ) -> BoxFuture<'a, AppResult<String>> {
            Box::pin(async move {
                self.started_runs.lock().unwrap().push((agent_id.to_string(), inputs));
                if self.should_fail {
                    return Err(AppError::MissingCredentials("openai".into()));
                }
                Ok(format!("run-{}", self.start_count()))
            })
        }
    }

    /// Thursday 2026-11-19 09:00 in Asia/Jakarta (UTC+7).
    fn scheduled_fire_time() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 19, 2, 0, 0).unwrap()
    }

    fn database_with_trigger(policy: MissedRunPolicy, next_fire_at: Option<DateTime<Utc>>) -> (Database, Trigger) {
        let database = Database::open_in_memory().unwrap();
        let agent = database
            .create_agent(NewAgent {
                name: "Inbox digest".into(),
                kind: AgentKind::Task,
                description: "Summarize my inbox".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        let new_trigger = NewTrigger {
            agent_id: agent.id,
            cron_expression: "0 0 9 * * Mon-Fri".into(),
            timezone: "Asia/Jakarta".into(),
            missed_run_policy: policy,
            inputs: json!({"folder": "inbox"}),
        };
        let stored_next = next_fire_at.map(format_fire_time);
        let trigger = database.create_trigger(new_trigger, stored_next.as_deref()).unwrap();
        (database, trigger)
    }

    fn stored_next_fire(database: &Database, trigger_id: &str) -> Option<String> {
        database.get_trigger(trigger_id).unwrap().next_fire_at
    }

    #[tokio::test]
    async fn due_trigger_starts_once_and_advances() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let now = scheduled_fire_time() + Duration::seconds(5);

        let report = run_due_triggers(&database, &starter, now).await.unwrap();
        assert_eq!(report.started, vec![trigger.id.clone()]);
        let started_runs = starter.started_runs.lock().unwrap().clone();
        assert_eq!(started_runs, [(trigger.agent_id.clone(), json!({"folder": "inbox"}))]);

        let stored = database.get_trigger(&trigger.id).unwrap();
        assert_eq!(stored.next_fire_at.as_deref(), Some("2026-11-20T02:00:00+00:00"));
        assert_eq!(stored.last_fired_at, Some(format_fire_time(now)));

        // The next tick, a few seconds later, does nothing.
        let second_report = run_due_triggers(&database, &starter, now + Duration::seconds(20)).await.unwrap();
        assert!(second_report.is_empty());
        assert_eq!(starter.start_count(), 1);
    }

    #[tokio::test]
    async fn trigger_not_due_does_nothing() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();

        let report = run_due_triggers(&database, &starter, scheduled_fire_time() - Duration::seconds(1)).await.unwrap();
        assert!(report.is_empty());
        assert_eq!(starter.start_count(), 0);
        assert_eq!(stored_next_fire(&database, &trigger.id), Some(format_fire_time(scheduled_fire_time())));
        assert!(database.get_trigger(&trigger.id).unwrap().last_fired_at.is_none());
    }

    #[tokio::test]
    async fn missed_by_hours_with_run_once_runs_exactly_once() {
        // Asleep from Thursday 09:00 until Monday 10:00 Jakarta: three slots were missed.
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let wake_time = Utc.with_ymd_and_hms(2026, 11, 23, 3, 0, 0).unwrap();

        let report = run_due_triggers(&database, &starter, wake_time).await.unwrap();
        assert_eq!(report.started, vec![trigger.id.clone()]);
        assert_eq!(starter.start_count(), 1);
        assert_eq!(stored_next_fire(&database, &trigger.id).as_deref(), Some("2026-11-24T02:00:00+00:00"));

        let next_report = run_due_triggers(&database, &starter, wake_time + Duration::seconds(20)).await.unwrap();
        assert!(next_report.is_empty());
        assert_eq!(starter.start_count(), 1);
    }

    #[tokio::test]
    async fn missed_with_skip_runs_nothing_but_advances() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::Skip, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let wake_time = scheduled_fire_time() + Duration::hours(3);

        let report = run_due_triggers(&database, &starter, wake_time).await.unwrap();
        assert_eq!(report.skipped_missed, vec![trigger.id.clone()]);
        assert!(report.started.is_empty());
        assert_eq!(starter.start_count(), 0);
        let stored = database.get_trigger(&trigger.id).unwrap();
        assert_eq!(stored.next_fire_at.as_deref(), Some("2026-11-20T02:00:00+00:00"));
        assert_eq!(stored.last_fired_at, Some(format_fire_time(wake_time)));
    }

    #[tokio::test]
    async fn skip_policy_still_runs_when_on_time() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::Skip, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let now = scheduled_fire_time() + Duration::seconds(TICK_SECONDS as i64);

        let report = run_due_triggers(&database, &starter, now).await.unwrap();
        assert_eq!(report.started, [trigger.id]);
    }

    #[tokio::test]
    async fn start_failure_advances_without_retry_storm() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::failing();
        let now = scheduled_fire_time() + Duration::seconds(2);

        let report = run_due_triggers(&database, &starter, now).await.unwrap();
        assert_eq!(report.failed_to_start, vec![trigger.id.clone()]);
        assert_eq!(stored_next_fire(&database, &trigger.id).as_deref(), Some("2026-11-20T02:00:00+00:00"));

        for tick_index in 1..=5 {
            let later = now + Duration::seconds(tick_index * TICK_SECONDS as i64);
            assert!(run_due_triggers(&database, &starter, later).await.unwrap().is_empty());
        }
        assert_eq!(starter.start_count(), 1);
    }

    #[tokio::test]
    async fn disabled_triggers_are_ignored() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        database.set_trigger_enabled(&trigger.id, false, Some(&format_fire_time(scheduled_fire_time()))).unwrap();
        let starter = FakeRunStarter::default();

        let report = run_due_triggers(&database, &starter, scheduled_fire_time() + Duration::hours(1)).await.unwrap();
        assert!(report.is_empty());
        assert_eq!(starter.start_count(), 0);
        assert!(database.get_trigger(&trigger.id).unwrap().last_fired_at.is_none());
    }

    #[tokio::test]
    async fn missing_next_fire_time_is_planned_without_running() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, None);
        let starter = FakeRunStarter::default();
        // Thursday 2026-11-19 10:00 Jakarta: today's slot is gone, next is Friday 09:00.
        let now = Utc.with_ymd_and_hms(2026, 11, 19, 3, 0, 0).unwrap();

        let report = run_due_triggers(&database, &starter, now).await.unwrap();
        assert_eq!(report.planned, vec![trigger.id.clone()]);
        assert_eq!(starter.start_count(), 0);
        assert_eq!(stored_next_fire(&database, &trigger.id).as_deref(), Some("2026-11-20T02:00:00+00:00"));
    }

    #[tokio::test]
    async fn paused_scheduler_fires_nothing_and_resumes_after() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let pause_start = scheduled_fire_time() - Duration::minutes(10);
        let pause_end = super::super::pause::pause_scheduler(&database, pause_start, Duration::hours(1)).unwrap();

        let paused_report =
            run_due_triggers(&database, &starter, scheduled_fire_time() + Duration::seconds(5)).await.unwrap();
        assert!(paused_report.is_empty());
        assert_eq!(starter.start_count(), 0);
        assert_eq!(stored_next_fire(&database, &trigger.id), Some(format_fire_time(scheduled_fire_time())));

        // After the pause the late trigger runs once (its policy is RunOnce).
        let resumed_report = run_due_triggers(&database, &starter, pause_end + Duration::seconds(1)).await.unwrap();
        assert_eq!(resumed_report.started, vec![trigger.id.clone()]);
        assert_eq!(starter.start_count(), 1);
    }

    #[tokio::test]
    async fn resuming_early_fires_due_triggers_again() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        super::super::pause::pause_scheduler(&database, scheduled_fire_time(), Duration::hours(1)).unwrap();
        super::super::pause::resume_scheduler(&database).unwrap();

        let report = run_due_triggers(&database, &starter, scheduled_fire_time() + Duration::seconds(5)).await.unwrap();
        assert_eq!(report.started, vec![trigger.id]);
    }

    fn add_trigger(database: &Database, agent_id: &str, next_fire_at: DateTime<Utc>) -> Trigger {
        let new_trigger = NewTrigger {
            agent_id: agent_id.to_owned(),
            cron_expression: "0 0 9 * * Mon-Fri".into(),
            timezone: "Asia/Jakarta".into(),
            missed_run_policy: MissedRunPolicy::RunOnce,
            inputs: json!({}),
        };
        database.create_trigger(new_trigger, Some(&format_fire_time(next_fire_at))).unwrap()
    }

    #[tokio::test]
    async fn concurrency_limit_skips_runs_beyond_it() {
        let (database, first) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let second = add_trigger(&database, &first.agent_id, scheduled_fire_time());
        let third = add_trigger(&database, &first.agent_id, scheduled_fire_time());
        let starter = FakeRunStarter::default();
        let now = scheduled_fire_time() + Duration::seconds(5);

        let report = run_due_triggers(&database, &starter, now).await.unwrap();
        assert_eq!(report.started.len(), 2, "the default limit is 2");
        assert_eq!(report.skipped_busy.len(), 1);
        assert_eq!(starter.start_count(), 2);
        let mut handled: Vec<String> = report.started.iter().chain(&report.skipped_busy).cloned().collect();
        handled.sort();
        let mut expected = vec![first.id, second.id, third.id.clone()];
        expected.sort();
        assert_eq!(handled, expected);
        // The skipped trigger moved on: it does not fire on the next tick.
        let skipped_id = &report.skipped_busy[0];
        assert_eq!(stored_next_fire(&database, skipped_id).as_deref(), Some("2026-11-20T02:00:00+00:00"));
    }

    #[tokio::test]
    async fn running_scheduled_runs_count_against_the_limit() {
        let (database, trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        super::super::rules::ScheduleRules { max_concurrent_runs: 1 }.save(&database).unwrap();
        database.insert_run(&trigger.agent_id, 1, RunTrigger::Schedule).unwrap();
        // A manual run does not count.
        database.insert_run(&trigger.agent_id, 1, RunTrigger::Manual).unwrap();
        let starter = FakeRunStarter::default();

        let report = run_due_triggers(&database, &starter, scheduled_fire_time() + Duration::seconds(5)).await.unwrap();
        assert_eq!(report.skipped_busy, vec![trigger.id]);
        assert_eq!(starter.start_count(), 0);
    }

    #[tokio::test]
    async fn failed_starts_do_not_use_up_the_limit() {
        let (database, first) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        add_trigger(&database, &first.agent_id, scheduled_fire_time());
        add_trigger(&database, &first.agent_id, scheduled_fire_time());
        let starter = FakeRunStarter::failing();

        let report = run_due_triggers(&database, &starter, scheduled_fire_time() + Duration::seconds(5)).await.unwrap();
        assert_eq!(report.failed_to_start.len(), 3);
        assert!(report.skipped_busy.is_empty());
    }

    #[tokio::test]
    async fn concurrent_ticks_fire_a_trigger_once() {
        let (database, _trigger) = database_with_trigger(MissedRunPolicy::RunOnce, Some(scheduled_fire_time()));
        let starter = FakeRunStarter::default();
        let now = scheduled_fire_time() + Duration::seconds(1);

        let (first, second) =
            tokio::join!(run_due_triggers(&database, &starter, now), run_due_triggers(&database, &starter, now));
        first.unwrap();
        second.unwrap();
        assert_eq!(starter.start_count(), 1);
    }
}
