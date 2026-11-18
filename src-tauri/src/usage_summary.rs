//! Run and model-token totals since a point in time, for the Home "This month" card (09).
//!
//! Token usage is read from each run's event log exactly as [`crate::run_summary::summarize_run`]
//! reads it, so the Home total always equals the sum of the run result screens.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as Json;

use crate::error::{AppError, AppResult};
use crate::run_summary::{summarize_run, TokenUsage};
use crate::storage::Database;

/// Runs started since a moment and the model tokens they used. Keep `src/api/usageSummaryTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    /// The normalised start of the window (RFC 3339, UTC).
    pub from: String,
    /// Runs started at or after `from`, whatever their status.
    pub run_count: u32,
    /// Runs among them where at least one model call reported usage.
    pub runs_with_usage: u32,
    /// Tokens summed over those runs.
    pub usage: TokenUsage,
}

/// Totals for runs started at or after `from` (RFC 3339, any offset).
///
/// # Errors
/// `AppError::InvalidInput` when `from` is not an RFC 3339 timestamp; `AppError::Database`
/// when storage fails.
///
/// # Example
/// ```no_run
/// # fn example(db: &graphrt_lib::storage::Database) -> graphrt_lib::error::AppResult<()> {
/// let month = graphrt_lib::usage_summary::usage_summary_since(db, "2026-11-01T00:00:00+07:00")?;
/// println!("{} runs, {} tokens", month.run_count, month.usage.total_tokens);
/// # Ok(()) }
/// ```
pub fn usage_summary_since(db: &Database, from: &str) -> AppResult<UsageSummary> {
    let normalized_from = normalize_timestamp(from)?;
    let runs = db.list_runs_started_since(&normalized_from, None)?;
    let mut summary =
        UsageSummary { from: normalized_from, run_count: 0, runs_with_usage: 0, usage: TokenUsage::default() };
    for run in &runs {
        let events: Vec<Json> = db.list_run_events(&run.id)?.into_iter().map(|record| record.event).collect();
        summary.run_count = summary.run_count.saturating_add(1);
        if let Some(run_usage) = summarize_run(run, &events).usage {
            summary.runs_with_usage = summary.runs_with_usage.saturating_add(1);
            add_usage(&mut summary.usage, run_usage);
        }
    }
    Ok(summary)
}

/// Converts `from` to the UTC format `started_at` is stored in, so text order is time order.
fn normalize_timestamp(from: &str) -> AppResult<String> {
    DateTime::parse_from_rfc3339(from.trim())
        .map(|parsed| parsed.with_timezone(&Utc).to_rfc3339())
        .map_err(|parse_error| AppError::InvalidInput(format!("\"{from}\" is not an RFC 3339 time: {parse_error}")))
}

fn add_usage(total: &mut TokenUsage, run_usage: TokenUsage) {
    total.prompt_tokens = total.prompt_tokens.saturating_add(run_usage.prompt_tokens);
    total.completion_tokens = total.completion_tokens.saturating_add(run_usage.completion_tokens);
    total.total_tokens = total.total_tokens.saturating_add(run_usage.total_tokens);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, NewAgent, RunStatus, RunTrigger};

    fn llm_events(total_tokens: u64) -> Vec<Json> {
        vec![
            json!({"type": "node_started", "frame": "", "node_id": "draft", "exec_id": "e1", "kind": "llm",
                   "title": "draft", "attempt": 1}),
            json!({"type": "node_succeeded", "frame": "", "node_id": "draft", "exec_id": "e1", "outputs": {},
                   "elapsed_ms": 5,
                   "usage": {"prompt_tokens": total_tokens - 10, "completion_tokens": 10, "total_tokens": total_tokens}}),
        ]
    }

    fn set_started_at(database: &Database, run_id: &str, started_at: &str) {
        database
            .lock()
            .unwrap()
            .execute("UPDATE runs SET started_at = ?1 WHERE id = ?2", rusqlite::params![started_at, run_id])
            .unwrap();
    }

    fn database_with_agent() -> (Database, String) {
        let database = Database::open_in_memory().unwrap();
        let agent = database
            .create_agent(NewAgent {
                name: "Digest".into(),
                kind: AgentKind::Task,
                description: "Summarize email".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        (database, agent.id)
    }

    #[test]
    fn sums_runs_and_tokens_since_the_start_of_the_window() {
        let (database, agent_id) = database_with_agent();
        let october = database.insert_run(&agent_id, 1, RunTrigger::Schedule).unwrap();
        for event in llm_events(500) {
            database.append_run_event(&october.id, &event).unwrap();
        }
        set_started_at(&database, &october.id, "2026-10-31T16:59:00+00:00");

        let first = database.insert_run(&agent_id, 1, RunTrigger::Schedule).unwrap();
        for event in llm_events(120) {
            database.append_run_event(&first.id, &event).unwrap();
        }
        database.finish_run(&first.id, RunStatus::Succeeded, None, None).unwrap();
        set_started_at(&database, &first.id, "2026-10-31T17:00:00+00:00");

        let without_model = database.insert_run(&agent_id, 1, RunTrigger::Manual).unwrap();
        database.finish_run(&without_model.id, RunStatus::Failed, None, Some("offline")).unwrap();
        set_started_at(&database, &without_model.id, "2026-11-05T09:00:00+00:00");

        let second = database.insert_run(&agent_id, 1, RunTrigger::Test).unwrap();
        for event in llm_events(80) {
            database.append_run_event(&second.id, &event).unwrap();
        }
        set_started_at(&database, &second.id, "2026-11-18T09:00:00+00:00");

        // Midnight 1 November in Jakarta is 17:00 UTC on 31 October.
        let summary = usage_summary_since(&database, "2026-11-01T00:00:00+07:00").unwrap();

        assert_eq!(summary.from, "2026-10-31T17:00:00+00:00");
        assert_eq!(summary.run_count, 3);
        assert_eq!(summary.runs_with_usage, 2);
        assert_eq!(summary.usage, TokenUsage { prompt_tokens: 180, completion_tokens: 20, total_tokens: 200 });
    }

    #[test]
    fn no_runs_gives_zero_totals() {
        let (database, _) = database_with_agent();
        let summary = usage_summary_since(&database, "2026-11-01T00:00:00Z").unwrap();
        assert_eq!((summary.run_count, summary.runs_with_usage, summary.usage.total_tokens), (0, 0, 0));
    }

    #[test]
    fn rejects_a_time_that_is_not_rfc_3339() {
        let (database, _) = database_with_agent();
        assert!(matches!(usage_summary_since(&database, "November"), Err(AppError::InvalidInput(_))));
    }
}
