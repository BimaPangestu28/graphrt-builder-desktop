//! The runs of this computer in the shapes `graphrt serve` answers with (graphrt
//! `docs/monitoring.md`), so the monitoring page and `@graphrt/client` read them unchanged.
//!
//! A Desktop run becomes a graphrt [`RunRecord`]: the agent's name is the `workflow`, the
//! run's id stays its id. The approvals inbox is graphrt's own [`requests_of`] over that
//! record, with the deadline Desktop computed (`expires_at`, which survives a resume) in
//! place of graphrt's estimate.
//!
//! Everything a phone receives passes [`redact`]: values under secret-looking names and
//! token-looking strings are hidden, as they are in Desktop's own approval cards. Token
//! counts (`usage`) stay numbers.

use chrono::DateTime;
use graphrt_cli::approvals::requests_of;
use graphrt_core::store::{RunRecord, RunStatus as GraphrtStatus};
use serde_json::{json, Map, Value as Json};

use crate::engine::approval_pauses::{is_secret_name, is_secret_value, EXPIRES_AT_KEY, REDACTED};
use crate::storage::models::{Run, RunStatus};

/// Output names that hold the answer when a run has several texts, in order of preference
/// (the same list as the run result screen, `src/pages/agent-run/runAnswer.ts`).
const ANSWER_OUTPUT_NAMES: &[&str] = &["answer", "reply", "message", "result", "response", "text", "output"];
/// Text outputs shown elsewhere, never as the answer.
const OTHER_TEXT_OUTPUTS: &[&str] = &["summary"];

/// RFC 3339 → Unix milliseconds (0 when unreadable).
pub fn millis(rfc3339: &str) -> u64 {
    DateTime::parse_from_rfc3339(rfc3339)
        .ok()
        .and_then(|time| u64::try_from(time.timestamp_millis()).ok())
        .unwrap_or_default()
}

pub fn graphrt_status(status: RunStatus) -> GraphrtStatus {
    match status {
        RunStatus::Running => GraphrtStatus::Running,
        RunStatus::Paused => GraphrtStatus::Paused,
        RunStatus::Succeeded => GraphrtStatus::Succeeded,
        RunStatus::Failed => GraphrtStatus::Failed,
        RunStatus::Aborted => GraphrtStatus::Aborted,
    }
}

/// What the agent answered, read from its outputs (empty when it gave no text).
pub fn answer_of(outputs: Option<&Json>) -> String {
    let Some(Json::Object(outputs)) = outputs else { return String::new() };
    let texts: Vec<(&str, &str)> = outputs
        .iter()
        .filter(|(name, _)| !OTHER_TEXT_OUTPUTS.contains(&name.as_str()))
        .filter_map(|(name, value)| Some((name.as_str(), value.as_str()?.trim())))
        .filter(|(_, text)| !text.is_empty())
        .collect();
    let named = ANSWER_OUTPUT_NAMES.iter().find_map(|wanted| texts.iter().find(|(name, _)| name == wanted));
    match named {
        Some((_, text)) => (*text).to_owned(),
        None => texts.iter().map(|(_, text)| *text).collect::<Vec<_>>().join("\n\n"),
    }
}

/// `run` as a graphrt record.
///
/// - `workflow`: the agent's name.
/// - `event_count`: how many events the run stored.
/// - `last_event_ms`: when its latest event was stored (when a paused run paused).
pub fn run_record(run: &Run, workflow: &str, event_count: u64, last_event_ms: Option<u64>) -> RunRecord {
    let created_ms = millis(&run.started_at);
    let mut record = RunRecord::running(run.id.clone(), workflow, "", created_ms);
    record.status = graphrt_status(run.status);
    record.updated_ms = run.finished_at.as_deref().map(millis).or(last_event_ms).unwrap_or(created_ms).max(created_ms);
    if run.status == RunStatus::Paused {
        record.pause_reasons = run
            .pause_reasons
            .as_ref()
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
            .filter_map(|reason| serde_json::from_value(reason.clone()).ok())
            .collect();
    }
    if let Some(outputs) = run.outputs.as_ref().and_then(|outputs| serde_json::from_value(outputs.clone()).ok()) {
        record.outputs = outputs;
    }
    record.answer = answer_of(run.outputs.as_ref());
    record.error = run.error_message.clone();
    record.event_count = event_count;
    record
}

/// The record as `GET /v1/runs/{id}` answers: with `active` and, for a paused run, the
/// input each waiting node expects (`resume_inputs`).
pub fn record_json(record: &RunRecord) -> Json {
    let mut value = serde_json::to_value(record).unwrap_or(Json::Null);
    if let Some(fields) = value.as_object_mut() {
        fields.insert("active".into(), Json::Bool(record.status == GraphrtStatus::Running));
        if record.status == GraphrtStatus::Paused {
            let expected: Vec<Json> = requests_of(record)
                .into_iter()
                .map(|request| json!({"key": request.key, "node_id": request.node_id, "kind": request.kind, "data": request.data}))
                .collect();
            fields.insert("resume_inputs".into(), Json::Array(expected));
        }
    }
    redact(&value)
}

/// One entry of `GET /v1/approvals`; `None` when nothing waits for a person.
///
/// `desktop_reasons` are the run's stored pause reasons, whose `expires_at` is the deadline
/// Desktop carries out (`engine::approval_expiry`).
pub fn approval_json(record: &RunRecord, desktop_reasons: Option<&Json>) -> Option<Json> {
    let requests = requests_of(record);
    if requests.is_empty() {
        return None;
    }
    let deadlines: Map<String, Json> = desktop_reasons
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(|reason| {
            let node_id = reason.get("node_id")?.as_str()?;
            let frame = reason.get("frame").and_then(Json::as_str).unwrap_or_default();
            let key = if frame.is_empty() { node_id.to_owned() } else { format!("{frame}/{node_id}") };
            let expires_ms = millis(reason.get(EXPIRES_AT_KEY)?.as_str()?);
            (expires_ms > 0).then(|| (key, Json::from(expires_ms)))
        })
        .collect();
    let requests: Vec<Json> = requests
        .into_iter()
        .map(|request| {
            let expires_ms = deadlines.get(&request.key).cloned().or_else(|| request.expires_ms.map(Json::from));
            json!({
                "key": request.key,
                "node_id": request.node_id,
                "kind": request.kind,
                "data": request.data,
                "expires_ms": expires_ms.unwrap_or(Json::Null),
            })
        })
        .collect();
    Some(redact(&json!({
        "run_id": record.run_id,
        "workflow": record.workflow,
        "paused_ms": record.updated_ms,
        "user_id": null,
        "session_id": null,
        "requests": requests,
    })))
}

/// The keys a resolve may answer under (`<frame>/<node_id>` or the node id).
pub fn request_keys(record: &RunRecord) -> Vec<String> {
    requests_of(record).into_iter().map(|request| request.key).collect()
}

/// `value` without secrets: values under secret-looking names and token-looking strings
/// become [`REDACTED`]. `usage` objects (token counts) are kept as they are.
pub fn redact(value: &Json) -> Json {
    match value {
        Json::Object(fields) => Json::Object(
            fields
                .iter()
                .map(|(name, field)| {
                    let shown = if name == "usage" && is_token_counts(field) {
                        field.clone()
                    } else if is_secret_name(name) && !field.is_null() {
                        Json::String(REDACTED.to_owned())
                    } else {
                        redact(field)
                    };
                    (name.clone(), shown)
                })
                .collect(),
        ),
        Json::Array(items) => Json::Array(items.iter().map(redact).collect()),
        Json::String(text) if is_secret_value(text) => Json::String(REDACTED.to_owned()),
        other => other.clone(),
    }
}

fn is_token_counts(value: &Json) -> bool {
    value.as_object().is_some_and(|fields| fields.values().all(|count| count.is_number() || count.is_null()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::RunTrigger;

    fn run(status: RunStatus) -> Run {
        Run {
            id: "run-1".into(),
            agent_id: "agent-1".into(),
            agent_version: 1,
            trigger: RunTrigger::Manual,
            status,
            started_at: "2026-11-27T10:00:00+00:00".into(),
            finished_at: None,
            outputs: None,
            error_message: None,
            pause_reasons: None,
        }
    }

    fn paused_for_approval() -> Run {
        let mut paused = run(RunStatus::Paused);
        paused.pause_reasons = Some(json!([
            {
                "frame": "",
                "node_id": "ask",
                "kind": "human_input",
                "data": {"prompt": "Send the offer?", "timeout_ms": 3_600_000, "actions": [{"id": "approve", "title": "Approve"}]},
                "expires_at": "2026-11-27T12:00:00+00:00",
                "on_timeout": {"kind": "stop"}
            },
            {
                "frame": "",
                "node_id": "agent",
                "kind": "tool_approval",
                "data": {"calls": [{"id": "c1", "tool": "send", "arguments": {"to": "ana@example.com", "api_key": "sk-123"}}]}
            }
        ]));
        paused
    }

    #[test]
    fn a_finished_run_reads_like_a_graphrt_record() {
        let mut finished = run(RunStatus::Succeeded);
        finished.finished_at = Some("2026-11-27T10:00:05+00:00".into());
        finished.outputs = Some(json!({"summary": "1 question", "reply": "We open at 9."}));
        let record = run_record(&finished, "Front desk", 12, None);
        let value = record_json(&record);
        assert_eq!(value["run_id"], "run-1");
        assert_eq!(value["workflow"], "Front desk");
        assert_eq!(value["status"], "succeeded");
        assert_eq!(value["created_ms"], 1_795_773_600_000_u64);
        assert_eq!(value["updated_ms"], 1_795_773_605_000_u64);
        assert_eq!(value["answer"], "We open at 9.");
        assert_eq!(value["event_count"], 12);
        assert_eq!(value["active"], false);
        assert!(value.get("resume_inputs").is_none());
        assert!(value["usage"]["total_tokens"].is_number());
    }

    #[test]
    fn a_paused_run_lists_what_it_waits_for_without_secrets() {
        let paused = paused_for_approval();
        let record = run_record(&paused, "Offers", 4, Some(1_795_773_610_000));
        let value = record_json(&record);
        assert_eq!(value["updated_ms"], 1_795_773_610_000_u64);
        let inputs = value["resume_inputs"].as_array().unwrap();
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0]["key"], "ask");
        assert_eq!(inputs[1]["data"]["calls"][0]["arguments"]["api_key"], REDACTED);
        assert_eq!(inputs[1]["data"]["calls"][0]["arguments"]["to"], "ana@example.com");
    }

    #[test]
    fn the_inbox_uses_the_deadline_desktop_carries_out() {
        let paused = paused_for_approval();
        let record = run_record(&paused, "Offers", 4, Some(1_795_773_610_000));
        let entry = approval_json(&record, paused.pause_reasons.as_ref()).unwrap();
        assert_eq!(entry["workflow"], "Offers");
        assert_eq!(entry["paused_ms"], 1_795_773_610_000_u64);
        assert_eq!(entry["requests"][0]["expires_ms"], 1_795_780_800_000_u64);
        assert_eq!(entry["requests"][1]["expires_ms"], Json::Null);
        assert_eq!(entry["requests"][1]["data"]["calls"][0]["arguments"]["api_key"], REDACTED);
        assert_eq!(request_keys(&record), ["ask", "agent"]);
    }

    #[test]
    fn a_run_that_waits_for_nobody_is_not_in_the_inbox() {
        let record = run_record(&run(RunStatus::Running), "Offers", 1, None);
        assert!(approval_json(&record, None).is_none());
        assert!(request_keys(&record).is_empty());
    }

    #[test]
    fn the_answer_is_the_text_named_like_one() {
        assert_eq!(answer_of(Some(&json!({"result": "Done.", "summary": "x"}))), "Done.");
        assert_eq!(answer_of(Some(&json!({"a": "One", "b": " Two ", "count": 3}))), "One\n\nTwo");
        assert_eq!(answer_of(Some(&json!({"summary": "only"}))), "");
        assert_eq!(answer_of(None), "");
    }

    #[test]
    fn redaction_keeps_token_counts() {
        let value = json!({"usage": {"prompt_tokens": 3}, "headers": {"Authorization": "Bearer x"}, "note": "ghp_abc", "token": null});
        let shown = redact(&value);
        assert_eq!(shown["usage"]["prompt_tokens"], 3);
        assert_eq!(shown["headers"]["Authorization"], REDACTED);
        assert_eq!(shown["note"], REDACTED);
        assert_eq!(shown["token"], Json::Null);
    }
}
