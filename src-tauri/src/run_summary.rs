//! Plain-language summaries of runs for the Run result (07) and Home (09) screens.
//!
//! A [`RunSummary`] is derived from one stored run and its graphrt event log:
//! - duration from the run's `started_at` / `finished_at`;
//! - step counts from `node_succeeded` / `node_failed` / `node_skipped` events, ignoring
//!   bookkeeping nodes (`start`, `end`, `iteration-start`, `loop-start`, `loop-end`);
//! - approvals from `human-input` nodes' `node_succeeded` outputs (`action`), plus the
//!   human-input pause reasons still waiting on a paused run;
//! - model token usage summed over `node_succeeded.usage` of non-container nodes
//!   (iteration and loop nodes repeat their body's usage, so they are left out);
//! - the run output convention (see "Run outputs" in `flow/format_guide.md`):
//!   `summary` → headline, `items` → items, numeric top-level outputs → counters.
//!
//! [`agent_run_stats`] gives each agent's last-7-days totals for the Home cards.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as Json;

use crate::error::AppResult;
use crate::storage::models::{Run, RunFilter, RunStatus};
use crate::storage::Database;

/// Node kinds that only mark structure; they are not steps the user would recognise.
const BOOKKEEPING_NODE_KINDS: &[&str] = &["start", "end", "iteration-start", "loop-start", "loop-end"];
/// Container nodes whose `usage` already includes every model call of their body.
const CONTAINER_NODE_KINDS: &[&str] = &["iteration", "loop"];
const HUMAN_INPUT_NODE_KIND: &str = "human-input";
const HUMAN_INPUT_PAUSE_KIND: &str = "human_input";
/// Human-input action ids that mean "no": the step after it does not happen.
const DECLINING_ACTION_IDS: &[&str] =
    &["skip", "reject", "cancel", "decline", "deny", "no", "stop", "ignore", "discard"];
/// The Home cards' "this week".
const STATS_WINDOW_DAYS: i64 = 7;

/// Steps that finished, by outcome.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepCounts {
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
}

/// Answers given to "ask me first" steps.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalCounts {
    pub approved: u32,
    pub skipped: u32,
    /// Questions a paused run is waiting on right now.
    pub waiting: u32,
}

/// Model tokens used by the run (graphrt `Usage`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// A numeric run output such as `messages_sent`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCounter {
    pub name: String,
    pub value: f64,
}

/// What screen 07 shows about one run. Keep `src/api/runSummaryTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub agent_id: String,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// Wall-clock time from start to finish (including time waiting for the user); `None` until finished.
    pub duration_ms: Option<i64>,
    pub steps: StepCounts,
    pub approvals: ApprovalCounts,
    /// `None` when no model call reported usage.
    pub usage: Option<TokenUsage>,
    /// The `summary` output: one plain sentence about what happened.
    pub headline: Option<String>,
    /// The `items` output: one object per thing processed (`name`/`title`, `status`, ...).
    pub items: Vec<Json>,
    /// Numeric top-level outputs, in output order.
    pub counters: Vec<RunCounter>,
    pub error_message: Option<String>,
}

/// One agent's runs over the last 7 days, for its Home card. Keep `src/api/runSummaryTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStats {
    pub agent_id: String,
    pub runs_this_week: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub paused: u32,
    /// The agent's latest run ever, not only this week's.
    pub last_run_status: Option<RunStatus>,
    pub last_run_at: Option<String>,
    /// Counters summed over this week's runs (e.g. `messages_sent`).
    pub counters: Vec<RunCounter>,
}

/// Summary of a stored run.
///
/// # Errors
/// `AppError::NotFound` when the run does not exist; `AppError::Database` when storage fails.
///
/// # Example
/// ```no_run
/// # fn example(db: &graphrt_lib::storage::Database) -> graphrt_lib::error::AppResult<()> {
/// let summary = graphrt_lib::run_summary::get_run_summary(db, "run-id")?;
/// println!("{:?}", summary.headline);
/// # Ok(()) }
/// ```
pub fn get_run_summary(db: &Database, run_id: &str) -> AppResult<RunSummary> {
    let run = db.get_run(run_id)?;
    let events: Vec<Json> = db.list_run_events(run_id)?.into_iter().map(|record| record.event).collect();
    Ok(summarize_run(&run, &events))
}

/// Builds the summary of `run` from its events (graphrt `Event`s as JSON, in order).
pub fn summarize_run(run: &Run, events: &[Json]) -> RunSummary {
    let tally = EventTally::from_events(events);
    let outputs = run.outputs.as_ref().and_then(Json::as_object);
    let approvals = ApprovalCounts { waiting: count_waiting_approvals(run), ..tally.approvals };
    RunSummary {
        run_id: run.id.clone(),
        agent_id: run.agent_id.clone(),
        status: run.status,
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        duration_ms: run.finished_at.as_deref().and_then(|finished_at| duration_ms(&run.started_at, finished_at)),
        steps: tally.steps,
        approvals,
        usage: (tally.usage.total_tokens > 0 || tally.usage.prompt_tokens > 0).then_some(tally.usage),
        headline: outputs.and_then(read_headline),
        items: outputs.map(read_items).unwrap_or_default(),
        counters: outputs.map(read_counters).unwrap_or_default(),
        error_message: run.error_message.clone(),
    }
}

/// Last-7-days stats for one agent, or for every agent when `agent_id` is `None`.
///
/// # Errors
/// `AppError::NotFound` when `agent_id` names no agent; `AppError::Database` when storage fails.
pub fn agent_run_stats(db: &Database, agent_id: Option<&str>) -> AppResult<Vec<AgentRunStats>> {
    agent_run_stats_at(db, agent_id, Utc::now())
}

/// [`agent_run_stats`] for a week ending at `now` (tests pass a fixed time).
fn agent_run_stats_at(db: &Database, agent_id: Option<&str>, now: DateTime<Utc>) -> AppResult<Vec<AgentRunStats>> {
    let agent_ids = match agent_id {
        Some(agent_id) => vec![db.get_agent(agent_id)?.id],
        None => db.list_agents()?.into_iter().map(|agent| agent.id).collect(),
    };
    let since = (now - chrono::Duration::days(STATS_WINDOW_DAYS)).to_rfc3339();
    let week_runs = db.list_runs_started_since(&since, agent_id)?;
    agent_ids
        .into_iter()
        .map(|agent_id| {
            let latest_filter = RunFilter { agent_id: Some(agent_id.clone()), status: None, limit: Some(1) };
            let latest_run = db.list_runs(&latest_filter)?.into_iter().next();
            let agent_week_runs: Vec<&Run> = week_runs.iter().filter(|run| run.agent_id == agent_id).collect();
            Ok(build_agent_stats(agent_id, &agent_week_runs, latest_run.as_ref()))
        })
        .collect()
}

fn build_agent_stats(agent_id: String, week_runs: &[&Run], latest_run: Option<&Run>) -> AgentRunStats {
    let count_status = |status: RunStatus| count_u32(week_runs.iter().filter(|run| run.status == status).count());
    let mut counters: Vec<RunCounter> = Vec::new();
    for outputs in week_runs.iter().filter_map(|run| run.outputs.as_ref().and_then(Json::as_object)) {
        for counter in read_counters(outputs) {
            add_counter(&mut counters, counter);
        }
    }
    AgentRunStats {
        agent_id,
        runs_this_week: count_u32(week_runs.len()),
        succeeded: count_status(RunStatus::Succeeded),
        failed: count_status(RunStatus::Failed),
        paused: count_status(RunStatus::Paused),
        last_run_status: latest_run.map(|run| run.status),
        last_run_at: latest_run.map(|run| run.started_at.clone()),
        counters,
    }
}

fn add_counter(counters: &mut Vec<RunCounter>, counter: RunCounter) {
    match counters.iter_mut().find(|existing| existing.name == counter.name) {
        Some(existing) => existing.value += counter.value,
        None => counters.push(counter),
    }
}

fn count_u32(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// What the event log says about steps, approvals and token usage.
#[derive(Debug, Default)]
struct EventTally {
    steps: StepCounts,
    approvals: ApprovalCounts,
    usage: TokenUsage,
    /// Node kind by `exec_id`, then by `node_id` (for `node_skipped`, which has no exec id).
    kinds_by_exec_id: HashMap<String, String>,
    kinds_by_node_id: HashMap<String, String>,
}

impl EventTally {
    fn from_events(events: &[Json]) -> Self {
        let mut tally = Self::default();
        for event in events {
            tally.record(event);
        }
        tally
    }

    fn record(&mut self, event: &Json) {
        match event_text(event, "type") {
            Some("node_started") => self.record_kind(event),
            Some("node_succeeded") => self.record_success(event),
            Some("node_failed") if !self.is_bookkeeping(event) => self.steps.failed += 1,
            Some("node_skipped") if !self.is_bookkeeping(event) => self.steps.skipped += 1,
            _ => {}
        }
    }

    fn record_kind(&mut self, event: &Json) {
        let Some(kind) = event_text(event, "kind") else { return };
        if let Some(exec_id) = event_text(event, "exec_id") {
            self.kinds_by_exec_id.insert(exec_id.to_owned(), kind.to_owned());
        }
        if let Some(node_id) = event_text(event, "node_id") {
            self.kinds_by_node_id.insert(node_id.to_owned(), kind.to_owned());
        }
    }

    fn record_success(&mut self, event: &Json) {
        let kind = self.kind_of(event).map(str::to_owned);
        let kind = kind.as_deref();
        if kind.is_some_and(|kind| BOOKKEEPING_NODE_KINDS.contains(&kind)) {
            return;
        }
        self.steps.succeeded += 1;
        if kind == Some(HUMAN_INPUT_NODE_KIND) {
            self.record_approval(event);
        }
        if !kind.is_some_and(|kind| CONTAINER_NODE_KINDS.contains(&kind)) {
            self.record_usage(event);
        }
    }

    fn record_approval(&mut self, event: &Json) {
        let action = event.pointer("/outputs/action").and_then(Json::as_str).or_else(|| event_text(event, "branch"));
        match action {
            Some(action) if is_declining_action(action) => self.approvals.skipped += 1,
            Some(_) => self.approvals.approved += 1,
            None => {}
        }
    }

    fn record_usage(&mut self, event: &Json) {
        let Some(usage) = event.get("usage") else { return };
        let read = |field: &str| usage.get(field).and_then(Json::as_u64).unwrap_or(0);
        self.usage.prompt_tokens = self.usage.prompt_tokens.saturating_add(read("prompt_tokens"));
        self.usage.completion_tokens = self.usage.completion_tokens.saturating_add(read("completion_tokens"));
        self.usage.total_tokens = self.usage.total_tokens.saturating_add(read("total_tokens"));
    }

    fn kind_of(&self, event: &Json) -> Option<&str> {
        let by_exec_id = event_text(event, "exec_id").and_then(|exec_id| self.kinds_by_exec_id.get(exec_id));
        by_exec_id
            .or_else(|| event_text(event, "node_id").and_then(|node_id| self.kinds_by_node_id.get(node_id)))
            .map(String::as_str)
    }

    fn is_bookkeeping(&self, event: &Json) -> bool {
        self.kind_of(event).is_some_and(|kind| BOOKKEEPING_NODE_KINDS.contains(&kind))
    }
}

fn event_text<'a>(event: &'a Json, field: &str) -> Option<&'a str> {
    event.get(field).and_then(Json::as_str)
}

fn is_declining_action(action: &str) -> bool {
    let action = action.trim().to_ascii_lowercase();
    DECLINING_ACTION_IDS.iter().any(|declining| action == *declining || action.starts_with(&format!("{declining}_")))
}

fn count_waiting_approvals(run: &Run) -> u32 {
    if run.status != RunStatus::Paused {
        return 0;
    }
    let reasons = run.pause_reasons.as_ref().and_then(Json::as_array);
    count_u32(reasons.map_or(0, |reasons| {
        reasons.iter().filter(|reason| event_text(reason, "kind") == Some(HUMAN_INPUT_PAUSE_KIND)).count()
    }))
}

fn duration_ms(started_at: &str, finished_at: &str) -> Option<i64> {
    let started = DateTime::parse_from_rfc3339(started_at).ok()?;
    let finished = DateTime::parse_from_rfc3339(finished_at).ok()?;
    Some((finished - started).num_milliseconds().max(0))
}

fn read_headline(outputs: &serde_json::Map<String, Json>) -> Option<String> {
    let summary = outputs.get("summary")?.as_str()?.trim();
    (!summary.is_empty()).then(|| summary.to_owned())
}

fn read_items(outputs: &serde_json::Map<String, Json>) -> Vec<Json> {
    let Some(items) = outputs.get("items").and_then(Json::as_array) else { return Vec::new() };
    items.iter().filter(|item| item.is_object()).cloned().collect()
}

fn read_counters(outputs: &serde_json::Map<String, Json>) -> Vec<RunCounter> {
    outputs
        .iter()
        .filter_map(|(name, value)| match value {
            Json::Number(number) => number.as_f64().map(|value| RunCounter { name: name.clone(), value }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::error::AppError;
    use crate::storage::models::{Agent, AgentKind, NewAgent, RunTrigger};

    fn test_database() -> Database {
        Database::open_in_memory().unwrap()
    }

    fn create_agent(database: &Database, name: &str) -> Agent {
        database
            .create_agent(NewAgent {
                name: name.into(),
                kind: AgentKind::Task,
                description: "Send offers".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap()
    }

    fn set_run_times(database: &Database, run_id: &str, started_at: &str, finished_at: Option<&str>) {
        database
            .lock()
            .unwrap()
            .execute(
                "UPDATE runs SET started_at = ?1, finished_at = COALESCE(?2, finished_at) WHERE id = ?3",
                rusqlite::params![started_at, finished_at, run_id],
            )
            .unwrap();
    }

    fn started(node_id: &str, exec_id: &str, kind: &str) -> Json {
        json!({"type": "node_started", "frame": "", "node_id": node_id, "exec_id": exec_id, "kind": kind,
               "title": node_id, "attempt": 1})
    }

    fn succeeded(node_id: &str, exec_id: &str, extra: Json) -> Json {
        let mut event = json!({"type": "node_succeeded", "frame": "", "node_id": node_id, "exec_id": exec_id,
                               "outputs": {}, "elapsed_ms": 5});
        if let (Some(fields), Some(extra_fields)) = (event.as_object_mut(), extra.as_object()) {
            fields.extend(extra_fields.clone());
        }
        event
    }

    /// Events of the cafe flow with two cafes: one approved and sent, one skipped.
    fn cafe_run_events() -> Vec<Json> {
        let usage = json!({"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120});
        vec![
            json!({"type": "run_started", "run_id": "r", "resumed": false}),
            started("start", "e0", "start"),
            succeeded("start", "e0", json!({})),
            started("find_cafes", "e1", "http-request"),
            succeeded("find_cafes", "e1", json!({})),
            started("each_cafe", "e2", "iteration"),
            started("each_cafe_start", "e3", "iteration-start"),
            succeeded("each_cafe_start", "e3", json!({})),
            started("draft_message", "e4", "llm"),
            succeeded("draft_message", "e4", json!({"usage": usage})),
            started("approve_message", "e5", "human-input"),
            json!({"type": "node_paused", "frame": "each_cafe[0]", "node_id": "approve_message", "exec_id": "e5",
                   "reason": {"kind": "human_input"}}),
            json!({"type": "run_paused", "reasons": []}),
            json!({"type": "run_started", "run_id": "r", "resumed": true}),
            started("approve_message", "e5", "human-input"),
            succeeded("approve_message", "e5", json!({"outputs": {"action": "send", "note": null}, "branch": "send"})),
            started("send_message", "e6", "http-request"),
            succeeded("send_message", "e6", json!({})),
            started("draft_message", "e7", "llm"),
            succeeded("draft_message", "e7", json!({"usage": usage})),
            started("approve_message", "e8", "human-input"),
            succeeded("approve_message", "e8", json!({"outputs": {"action": "skip"}, "branch": "skip"})),
            json!({"type": "node_skipped", "frame": "each_cafe[1]", "node_id": "send_message"}),
            // The iteration repeats its body's usage; it must not be counted twice.
            succeeded(
                "each_cafe",
                "e2",
                json!({"usage": {"prompt_tokens": 200, "completion_tokens": 40, "total_tokens": 240}}),
            ),
            started("end", "e9", "end"),
            succeeded("end", "e9", json!({})),
            json!({"type": "run_succeeded", "outputs": {}, "usage": usage, "handled_errors": 0, "elapsed_ms": 9}),
        ]
    }

    #[test]
    fn summary_reads_steps_approvals_usage_and_outputs_from_scripted_events() {
        let database = test_database();
        let agent = create_agent(&database, "Cafe offers");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        for event in cafe_run_events() {
            database.append_run_event(&run.id, &event).unwrap();
        }
        let outputs = json!({
            "summary": "Sent the offer to 1 of 2 cafes in Rajabasa.",
            "items": [{"name": "Kopi Kita", "status": "sent"}, {"name": "Teh Tarik", "status": "skipped"}, "not an object"],
            "places_found": 2,
            "messages_sent": 1,
            "ready": true,
        });
        database.finish_run(&run.id, RunStatus::Succeeded, Some(&outputs), None).unwrap();
        set_run_times(&database, &run.id, "2026-11-18T09:00:00+00:00", Some("2026-11-18T09:01:30.500+00:00"));

        let summary = get_run_summary(&database, &run.id).unwrap();

        assert_eq!(summary.status, RunStatus::Succeeded);
        assert_eq!(summary.duration_ms, Some(90_500));
        // find_cafes, each_cafe, 2 drafts, 2 approvals, 1 send; send skipped once; bookkeeping ignored.
        assert_eq!(summary.steps, StepCounts { succeeded: 7, failed: 0, skipped: 1 });
        assert_eq!(summary.approvals, ApprovalCounts { approved: 1, skipped: 1, waiting: 0 });
        assert_eq!(summary.usage, Some(TokenUsage { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 }));
        assert_eq!(summary.headline.as_deref(), Some("Sent the offer to 1 of 2 cafes in Rajabasa."));
        assert_eq!(summary.items.len(), 2);
        assert_eq!(summary.items[1]["status"], "skipped");
        let counter_names: Vec<&str> = summary.counters.iter().map(|counter| counter.name.as_str()).collect();
        assert_eq!(counter_names.len(), 2);
        assert!(counter_names.contains(&"places_found") && counter_names.contains(&"messages_sent"));
        assert!(summary.error_message.is_none());
    }

    #[test]
    fn paused_run_counts_waiting_approvals_and_has_no_duration() {
        let database = test_database();
        let agent = create_agent(&database, "Cafe offers");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        let reasons = json!([{"frame": "", "node_id": "approve_message", "kind": "human_input", "data": {}}]);
        database.mark_run_paused(&run.id, "{}", &reasons).unwrap();

        let summary = get_run_summary(&database, &run.id).unwrap();

        assert_eq!(summary.approvals.waiting, 1);
        assert!(summary.duration_ms.is_none());
    }

    #[test]
    fn empty_run_has_zero_counts_and_no_outputs() {
        let database = test_database();
        let agent = create_agent(&database, "Quiet");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        database.finish_run(&run.id, RunStatus::Failed, None, Some("model timed out")).unwrap();

        let summary = get_run_summary(&database, &run.id).unwrap();

        assert_eq!(summary.steps, StepCounts::default());
        assert_eq!(summary.approvals, ApprovalCounts::default());
        assert!(summary.usage.is_none());
        assert!(summary.headline.is_none());
        assert!(summary.items.is_empty());
        assert!(summary.counters.is_empty());
        assert_eq!(summary.error_message.as_deref(), Some("model timed out"));
        assert!(summary.duration_ms.is_some());
    }

    #[test]
    fn blank_summary_and_non_list_items_are_ignored() {
        let database = test_database();
        let agent = create_agent(&database, "Odd outputs");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        let outputs = json!({"summary": "   ", "items": {"name": "not a list"}, "count": "3"});
        database.finish_run(&run.id, RunStatus::Succeeded, Some(&outputs), None).unwrap();

        let summary = get_run_summary(&database, &run.id).unwrap();

        assert!(summary.headline.is_none());
        assert!(summary.items.is_empty());
        assert!(summary.counters.is_empty());
    }

    #[test]
    fn failed_steps_count_and_declining_actions_are_recognised() {
        let events = vec![
            started("call", "e1", "http-request"),
            json!({"type": "node_failed", "frame": "", "node_id": "call", "exec_id": "e1", "error": "boom",
                   "error_type": "http", "handled": true, "elapsed_ms": 1}),
            started("ask", "e2", "human-input"),
            succeeded("ask", "e2", json!({"outputs": {"action": "reject_all"}})),
            started("ask_again", "e3", "human-input"),
            succeeded("ask_again", "e3", json!({"branch": "approve"})),
        ];
        let run = Run {
            id: "r".into(),
            agent_id: "a".into(),
            agent_version: 1,
            trigger: RunTrigger::Manual,
            status: RunStatus::Running,
            started_at: "2026-11-18T09:00:00+00:00".into(),
            finished_at: None,
            outputs: None,
            error_message: None,
            pause_reasons: None,
        };

        let summary = summarize_run(&run, &events);

        assert_eq!(summary.steps, StepCounts { succeeded: 2, failed: 1, skipped: 0 });
        assert_eq!(summary.approvals, ApprovalCounts { approved: 1, skipped: 1, waiting: 0 });
    }

    #[test]
    fn missing_run_is_not_found() {
        assert!(matches!(get_run_summary(&test_database(), "ghost"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn stats_cover_the_last_seven_days_and_sum_counters() {
        let database = test_database();
        let agent = create_agent(&database, "Cafe offers");
        let idle_agent = create_agent(&database, "Idle");
        let now: DateTime<Utc> = "2026-11-18T12:00:00Z".parse().unwrap();

        let old_run = database.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        database.finish_run(&old_run.id, RunStatus::Succeeded, Some(&json!({"messages_sent": 40})), None).unwrap();
        set_run_times(&database, &old_run.id, "2026-11-10T09:00:00+00:00", None);

        let monday = database.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        database
            .finish_run(&monday.id, RunStatus::Succeeded, Some(&json!({"messages_sent": 5, "summary": "x"})), None)
            .unwrap();
        set_run_times(&database, &monday.id, "2026-11-16T09:00:00+00:00", None);

        let tuesday = database.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        database.finish_run(&tuesday.id, RunStatus::Failed, None, Some("offline")).unwrap();
        set_run_times(&database, &tuesday.id, "2026-11-17T09:00:00+00:00", None);

        let today = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        database
            .finish_run(&today.id, RunStatus::Succeeded, Some(&json!({"messages_sent": 2, "places_found": 9})), None)
            .unwrap();
        set_run_times(&database, &today.id, "2026-11-18T09:00:00+00:00", None);

        let waiting = database.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        database.mark_run_paused(&waiting.id, "{}", &json!([])).unwrap();
        set_run_times(&database, &waiting.id, "2026-11-18T10:00:00+00:00", None);

        let stats = agent_run_stats_at(&database, None, now).unwrap();
        assert_eq!(stats.len(), 2);
        let cafe = stats.iter().find(|stats| stats.agent_id == agent.id).unwrap();
        assert_eq!(cafe.runs_this_week, 4);
        assert_eq!((cafe.succeeded, cafe.failed, cafe.paused), (2, 1, 1));
        assert_eq!(cafe.last_run_status, Some(RunStatus::Paused));
        assert_eq!(cafe.last_run_at.as_deref(), Some("2026-11-18T10:00:00+00:00"));
        assert_eq!(
            cafe.counters,
            [
                RunCounter { name: "messages_sent".into(), value: 7.0 },
                RunCounter { name: "places_found".into(), value: 9.0 },
            ]
        );

        let idle = stats.iter().find(|stats| stats.agent_id == idle_agent.id).unwrap();
        assert_eq!(idle.runs_this_week, 0);
        assert!(idle.last_run_status.is_none() && idle.last_run_at.is_none() && idle.counters.is_empty());
    }

    #[test]
    fn stats_keep_an_older_last_run_and_filter_by_agent() {
        let database = test_database();
        let agent = create_agent(&database, "Monthly");
        create_agent(&database, "Other");
        let now: DateTime<Utc> = "2026-11-18T12:00:00Z".parse().unwrap();
        let old_run = database.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        database.finish_run(&old_run.id, RunStatus::Succeeded, None, None).unwrap();
        set_run_times(&database, &old_run.id, "2026-10-01T09:00:00+00:00", None);

        let stats = agent_run_stats_at(&database, Some(&agent.id), now).unwrap();

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].runs_this_week, 0);
        assert_eq!(stats[0].last_run_status, Some(RunStatus::Succeeded));
        assert!(matches!(agent_run_stats(&database, Some("ghost")), Err(AppError::NotFound(_))));
    }
}
