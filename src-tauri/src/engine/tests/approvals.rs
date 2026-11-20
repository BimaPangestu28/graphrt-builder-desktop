//! Tool approvals of "Run an agent" steps, approval time limits and the run
//! limits from Settings, against real graphrt runs and mock models.

use super::*;
use crate::desktop::app_settings::AppSettings;
use crate::desktop::run_limits::RunLimitsSettings;
use crate::engine::approval_expiry::TIMED_OUT_STOP_MESSAGE;
use crate::run_review::{get_run_review, latest_pending_review, PendingApprovalKind};

/// Summarizes `text` with one model call; used as a tool by the coordinator.
const SUMMARIZER_FLOW: &str = r#"
version: "1"
name: summarizer
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: text, type: paragraph, required: true }
    - id: summarize
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Summarize: {{#start.text#}}" }
    - id: end
      type: end
      outputs:
        - { variable: summary, value_selector: [summarize, text] }
  edges:
    - { source: start, target: summarize }
    - { source: summarize, target: end }
"#;

/// An agent step whose every tool asks first.
fn coordinator_flow(member_id: &str) -> String {
    format!(
        r#"
version: "1"
name: coordinator
graph:
  nodes:
    - {{ id: start, type: start }}
    - id: coordinator
      type: agent
      title: Find and contact leads
      model: {{ provider: openai, name: gpt-4o-mini }}
      instruction: "Hand the text to your member."
      query: "Go"
      tools: ["agents/{member_id}"]
      require_approval: ["*"]
    - id: end
      type: end
      outputs:
        - {{ variable: text, value_selector: [coordinator, text] }}
  edges:
    - {{ source: start, target: coordinator }}
    - {{ source: coordinator, target: end }}
"#
    )
}

/// `DRAFT_AND_APPROVE` with a 2 hour time limit and `on_timeout` as given (YAML, may be empty).
fn timed_approval_flow(on_timeout: &str) -> String {
    DRAFT_AND_APPROVE.replace(
        "      prompt: \"Send this?",
        &format!("      timeout_ms: 7200000\n{on_timeout}      prompt: \"Send this?"),
    )
}

#[tokio::test]
async fn a_tool_call_waiting_for_approval_is_listed_and_allowed() {
    let model = Arc::new(MockModel::new(Vec::new()));
    let harness = harness_with_model(model.clone());
    let member = create_agent(&harness.db, SUMMARIZER_FLOW);
    let arguments = json!({"text": "Report", "api_key": "sk-live-123"}).to_string();
    model.push(MockModel::tool_calls(&[("call_1", member.id.as_str(), arguments.as_str())]));
    model.push(MockModel::text("Member summary"));
    model.push(MockModel::text("The team is done"));
    let coordinator = create_agent(&harness.db, &coordinator_flow(&member.id));

    let run = harness.runs.start_run(&coordinator.id, RunTrigger::Manual, json!({})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let review = get_run_review(&harness.db, &run.id).unwrap();
    assert!(review.other_pause_kinds.is_empty(), "{:?}", review.other_pause_kinds);
    let [question] = review.pending.as_slice() else { panic!("one question expected: {:?}", review.pending) };
    assert_eq!(question.kind, PendingApprovalKind::ToolCall);
    assert_eq!(question.resume_key, "coordinator");
    assert_eq!(question.id, "coordinator#call_1");
    assert_eq!(question.step_title.as_deref(), Some("Find and contact leads"));
    let tool_call = question.tool_call.as_ref().unwrap();
    assert_eq!(tool_call.call_id, "call_1");
    assert_eq!((tool_call.provider.as_deref(), tool_call.tool.as_deref()), (Some("agents"), Some(member.id.as_str())));
    assert_eq!(tool_call.arguments, json!({"text": "Report", "api_key": "[hidden]"}));
    assert_eq!(tool_call.reason, None);
    let stored = harness.db.get_run(&run.id).unwrap().pause_reasons.unwrap().to_string();
    assert!(!stored.contains("sk-live-123"), "secrets are not stored in the pause reasons");
    assert_eq!(latest_pending_review(&harness.db).unwrap().map(|review| review.run_id), Some(run.id.clone()));

    harness.runs.resume_run(&run.id, json!({"coordinator": {"approvals": {"call_1": true}}})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    let finished = harness.db.get_run(&run.id).unwrap();
    assert_eq!(finished.outputs.unwrap()["text"], json!("The team is done"));
    // The member really ran, with the real (unredacted) arguments.
    assert_eq!(model.requests()[1].messages[0].text(), "Summarize: Report");
}

#[tokio::test]
async fn a_declined_tool_call_never_runs_and_the_agent_hears_why() {
    let model = Arc::new(MockModel::new(Vec::new()));
    let harness = harness_with_model(model.clone());
    let member = create_agent(&harness.db, SUMMARIZER_FLOW);
    model.push(MockModel::tool_calls(&[("call_1", member.id.as_str(), r#"{"text":"Report"}"#)]));
    model.push(MockModel::text("Fine, I will not"));
    let coordinator = create_agent(&harness.db, &coordinator_flow(&member.id));

    let run = harness.runs.start_run(&coordinator.id, RunTrigger::Manual, json!({})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;
    harness.runs.resume_run(&run.id, json!({"coordinator": {"approvals": {"call_1": false}}})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let requests = model.requests();
    assert_eq!(requests.len(), 2, "the member agent never ran");
    assert!(serde_json::to_string(&requests[1].messages).unwrap().contains("did not approve"));
    assert!(stored_event_types(&harness.db, &run.id).iter().any(|event_type| event_type == "node_progress"));
}

#[tokio::test]
async fn an_approval_without_time_limit_never_expires() {
    let harness = harness_with_answers(&["Hello"]);
    let agent = create_agent(&harness.db, DRAFT_AND_APPROVE);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let review = get_run_review(&harness.db, &run.id).unwrap();
    assert_eq!(review.pending[0].expires_at, None);
    let far_future = chrono::Utc::now() + chrono::Duration::days(365);
    assert_eq!(harness.runs.expire_due_approvals(far_future).await, 0);
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Paused);
}

#[tokio::test]
async fn an_expired_approval_answers_with_the_chosen_button() {
    let harness = harness_with_answers(&["Hello"]);
    let agent = create_agent(&harness.db, &timed_approval_flow("      on_timeout: { action: approve }\n"));
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let question = get_run_review(&harness.db, &run.id).unwrap().pending.remove(0);
    let expires_at = chrono::DateTime::parse_from_rfc3339(question.expires_at.as_deref().unwrap()).unwrap();
    let time_left = expires_at.with_timezone(&chrono::Utc) - chrono::Utc::now();
    assert!(time_left > chrono::Duration::minutes(119) && time_left <= chrono::Duration::hours(2), "{time_left}");
    assert_eq!(question.on_timeout, Some(approval_pauses::TimeoutAction::Answer { action: "approve".into() }));

    assert_eq!(harness.runs.expire_due_approvals(chrono::Utc::now()).await, 0, "not expired yet");
    let after_deadline = expires_at.with_timezone(&chrono::Utc) + chrono::Duration::seconds(1);
    assert_eq!(harness.runs.expire_due_approvals(after_deadline).await, 1);
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let finished = harness.db.get_run(&run.id).unwrap();
    assert_eq!(finished.outputs.unwrap()["decision"], json!("approve"));
    let timed_out = harness
        .db
        .list_run_events(&run.id)
        .unwrap()
        .into_iter()
        .find(|record| record.event["type"] == "approval_timed_out")
        .expect("the timeout is in the run log");
    assert_eq!(timed_out.event["outcome"], json!("answer"));
    assert_eq!(timed_out.event["action_title"], json!("Approve"));
    assert_eq!(timed_out.event["node_id"], json!("approve_message"));
}

#[tokio::test]
async fn an_expired_approval_stops_the_run_by_default() {
    for on_timeout in ["", "      on_timeout: stop\n"] {
        let harness = harness_with_answers(&["Hello"]);
        let agent = create_agent(&harness.db, &timed_approval_flow(on_timeout));
        let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
        wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

        let in_three_hours = chrono::Utc::now() + chrono::Duration::hours(3);
        assert_eq!(harness.runs.expire_due_approvals(in_three_hours).await, 1);
        wait_for_status(&harness.sink, &run.id, RunStatus::Aborted).await;

        let stopped = harness.db.get_run(&run.id).unwrap();
        assert_eq!(stopped.error_message.as_deref(), Some(TIMED_OUT_STOP_MESSAGE));
        assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("approval_timed_out"));
        assert_eq!(harness.runs.expire_due_approvals(in_three_hours).await, 0, "a stopped run is not checked again");
    }
}

#[test]
fn run_limits_come_from_the_settings_within_their_bounds() {
    let db = Database::open_in_memory().unwrap();
    assert_eq!(preparation::run_limits(&db), RunLimitsSettings::default().to_engine_limits());

    let run_limits =
        RunLimitsSettings { step_timeout_seconds: 600, max_parallel_steps: 4, ..RunLimitsSettings::default() };
    AppSettings { run_limits, ..AppSettings::default() }.save(&db).unwrap();
    let limits = preparation::run_limits(&db);
    assert_eq!(limits.default_node_timeout_ms, Some(600_000));
    assert_eq!(limits.max_concurrency, 4);
    assert_eq!(limits.max_duration_ms, Some(30 * 60 * 1000));

    let unsafe_limits = RunLimitsSettings { max_step_attempts: 0, ..RunLimitsSettings::default() };
    assert!(AppSettings { run_limits: unsafe_limits, ..AppSettings::default() }.save(&db).is_err());
    assert_eq!(preparation::run_limits(&db).max_steps, 10_000, "a refused save changes nothing");
}

#[tokio::test]
async fn a_run_uses_the_step_attempt_limit_from_the_settings() {
    let harness = harness_with_answers(&["Rust is a systems language."]);
    let run_limits = RunLimitsSettings { max_step_attempts: 100, ..RunLimitsSettings::default() };
    AppSettings { run_limits, ..AppSettings::default() }.save(&harness.db).unwrap();
    // 101 rounds of a loop need more than 100 step attempts.
    let agent = create_agent(&harness.db, LONG_LOOP_FLOW);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Failed).await;
    let failed = harness.db.get_run(&run.id).unwrap();
    assert_eq!(failed.error_message.as_deref(), Some("step limit of 100 exceeded"));
}

/// A loop of 101 rounds with one assigner step each (no model calls).
const LONG_LOOP_FLOW: &str = r#"
version: "1"
name: long-loop
graph:
  nodes:
    - { id: start, type: start }
    - id: repeat
      type: loop
      loop_count: 101
      loop_variables: [{ label: counter, var_type: string, value_type: constant, value: "" }]
    - { id: repeat_start, type: loop-start, parent: repeat }
    - id: format
      type: template-transform
      parent: repeat
      template: "round"
      variables: []
    - { id: end, type: end }
  edges:
    - { source: start, target: repeat }
    - { source: repeat_start, target: format }
    - { source: repeat, target: end }
"#;
