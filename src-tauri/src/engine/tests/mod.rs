mod event_storage;
mod review_flow;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;
use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ChatRequest, ChatStream, LlmError, ModelRegistry};
use serde_json::json;

use super::*;
use crate::credentials::ModelProvider;
use crate::storage::models::{Agent, AgentKind, AgentStatus, NewAgent, RunFilter};

const SIMPLE_ANSWER: &str = include_str!("../../../fixtures/flows/simple_answer.yaml");

/// llm + human-input: the approval part of `approval_loop.yaml` without HTTP nodes.
const DRAFT_AND_APPROVE: &str = r#"
version: "1"
name: draft-and-approve
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: topic, type: text-input, required: true }
    - id: draft_message
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Write about {{#start.topic#}}" }
    - id: approve_message
      type: human-input
      prompt: "Send this?\n\n{{#draft_message.text#}}"
      form:
        fields:
          - { name: note, label: Note, type: text, required: false }
      actions:
        - { id: approve, title: Approve }
        - { id: reject, title: Reject }
    - id: end
      type: end
      outputs:
        - { variable: message, value_selector: [draft_message, text] }
        - { variable: decision, value_selector: [approve_message, action] }
  edges:
    - { source: start, target: draft_message }
    - { source: draft_message, target: approve_message }
    - { source: approve_message, target: end, handle: approve }
"#;

const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Default)]
struct CollectingSink {
    payloads: Mutex<Vec<RunEventPayload>>,
}

impl CollectingSink {
    fn payloads_for(&self, run_id: &str) -> Vec<RunEventPayload> {
        self.payloads.lock().unwrap().iter().filter(|payload| payload.run_id == run_id).cloned().collect()
    }
}

impl RunEventSink for CollectingSink {
    fn send(&self, payload: RunEventPayload) {
        self.payloads.lock().unwrap().push(payload);
    }
}

/// Serves the same chat model as `openai` for every run.
#[derive(Debug)]
struct FixedModelSource {
    model: Arc<dyn ChatModel>,
}

impl ModelRegistrySource for FixedModelSource {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.model.clone()))
    }
}

/// A model that never answers, to keep a run in `Running`.
#[derive(Debug)]
struct HangingModel;

impl ChatModel for HangingModel {
    fn chat(&self, _request: ChatRequest) -> BoxFuture<'_, Result<ChatStream, LlmError>> {
        Box::pin(futures::future::pending())
    }
}

struct Harness {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    sink: Arc<CollectingSink>,
    runs: RunManager,
}

fn harness_with_model(model: Arc<dyn ChatModel>) -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let sink = Arc::new(CollectingSink::default());
    let runs = RunManager::new(db.clone(), credentials.clone(), sink.clone())
        .with_model_registry_source(Arc::new(FixedModelSource { model }));
    Harness { db, credentials, sink, runs }
}

fn harness_with_answers(answers: &[&str]) -> Harness {
    harness_with_model(Arc::new(MockModel::new(answers.iter().map(|answer| MockModel::text(answer)).collect())))
}

fn create_agent(db: &Database, flow_yaml: &str) -> Agent {
    db.create_agent(NewAgent {
        name: "Test agent".into(),
        kind: AgentKind::Task,
        description: "test".into(),
        flow_yaml: flow_yaml.into(),
    })
    .unwrap()
}

/// Waits until the sink got `status_changed` with `status` for the run
/// (sent after the database update, so the run row is settled too).
async fn wait_for_status(sink: &CollectingSink, run_id: &str, status: RunStatus) {
    wait_for_status_count(sink, run_id, status, 1).await;
}

async fn wait_for_status_count(sink: &CollectingSink, run_id: &str, status: RunStatus, count: usize) {
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    loop {
        let seen = sink
            .payloads_for(run_id)
            .iter()
            .filter(|payload| payload.event["type"] == "status_changed" && payload.status == status)
            .count();
        if seen >= count {
            return;
        }
        assert!(tokio::time::Instant::now() < deadline, "run {run_id} never reached {status:?}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn wait_for_event(db: &Database, run_id: &str, event_type: &str) {
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    while !db.list_run_events(run_id).unwrap().iter().any(|record| record.event["type"] == event_type) {
        assert!(tokio::time::Instant::now() < deadline, "run {run_id} never emitted {event_type}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn stored_event_types(db: &Database, run_id: &str) -> Vec<String> {
    db.list_run_events(run_id).unwrap().iter().map(|record| record.event["type"].as_str().unwrap().to_owned()).collect()
}

#[tokio::test]
async fn simple_answer_succeeds_with_events_stored_and_sent_in_order() {
    let harness = harness_with_answers(&["Rust is a systems language."]);
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let run =
        harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "What is Rust?"})).await.unwrap();
    assert_eq!(run.status, RunStatus::Running);
    assert_eq!(run.agent_version, agent.current_version);
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let finished = harness.db.get_run(&run.id).unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    let records = harness.db.list_run_events(&run.id).unwrap();
    // Outputs are graphrt's `run_succeeded` outputs verbatim: the `answer` node's
    // streamed reply plus the end node's `result`, each holding the text once.
    let succeeded_event = &records.last().unwrap().event;
    assert_eq!(finished.outputs.as_ref(), Some(&succeeded_event["outputs"]));
    let outputs = finished.outputs.unwrap();
    assert_eq!(outputs["result"], json!("Rust is a systems language."));
    assert_eq!(outputs["answer"], json!("Rust is a systems language."));

    let seqs: Vec<i64> = records.iter().map(|record| record.seq).collect();
    assert_eq!(seqs, (1..=records.len() as i64).collect::<Vec<_>>());
    let types = stored_event_types(&harness.db, &run.id);
    assert_eq!(types.first().map(String::as_str), Some("run_started"));
    assert_eq!(types.last().map(String::as_str), Some("run_succeeded"));
    assert!(types.iter().any(|event_type| event_type == "node_succeeded"));

    // The sink got every stored event, in order, plus status changes.
    let payloads = harness.sink.payloads_for(&run.id);
    let sent_events: Vec<(i64, serde_json::Value)> = payloads
        .iter()
        .filter(|payload| payload.event["type"] != "status_changed")
        .map(|payload| (payload.seq, payload.event.clone()))
        .collect();
    let stored_events: Vec<(i64, serde_json::Value)> =
        records.iter().map(|record| (record.seq, record.event.clone())).collect();
    assert_eq!(sent_events, stored_events);
    let statuses: Vec<RunStatus> = payloads
        .iter()
        .filter(|payload| payload.event["type"] == "status_changed")
        .map(|payload| payload.status)
        .collect();
    assert_eq!(statuses, [RunStatus::Running, RunStatus::Succeeded]);
    assert!(payloads.iter().all(|payload| payload.agent_id == agent.id));
    // A manual run does not promote the agent.
    assert_eq!(harness.db.get_agent(&agent.id).unwrap().status, AgentStatus::Draft);
}

#[tokio::test]
async fn approval_pauses_with_reasons_and_resume_succeeds() {
    let harness = harness_with_answers(&["Hello cafe!"]);
    let agent = create_agent(&harness.db, DRAFT_AND_APPROVE);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "coffee"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let paused = harness.db.get_run(&run.id).unwrap();
    assert_eq!(paused.status, RunStatus::Paused);
    let reasons = paused.pause_reasons.unwrap();
    assert_eq!(reasons[0]["kind"], "human_input");
    assert_eq!(reasons[0]["node_id"], "approve_message");
    assert!(harness.db.get_run_snapshot(&run.id).is_ok());
    // The stored pause event leaves the snapshot to the run row.
    let paused_event = harness.db.list_run_events(&run.id).unwrap().pop().unwrap().event;
    assert_eq!(paused_event["type"], "run_paused");
    assert!(paused_event.get("snapshot").is_none());

    let resumed = harness
        .runs
        .resume_run(&run.id, json!({"approve_message": {"action": "approve", "values": {"note": "ok"}}}))
        .await
        .unwrap();
    assert_eq!(resumed.status, RunStatus::Running);
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let finished = harness.db.get_run(&run.id).unwrap();
    assert_eq!(finished.outputs, Some(json!({"message": "Hello cafe!", "decision": "approve"})));
    let types = stored_event_types(&harness.db, &run.id);
    assert_eq!(types.iter().filter(|event_type| *event_type == "run_started").count(), 2);
    assert_eq!(types.last().map(String::as_str), Some("run_succeeded"));
}

#[tokio::test]
async fn resume_uses_the_version_the_run_started_with() {
    let harness = harness_with_answers(&["Draft"]);
    let agent = create_agent(&harness.db, DRAFT_AND_APPROVE);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "tea"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    // Editing the agent while the run waits must not break the resume.
    harness.db.update_agent_flow(&agent.id, SIMPLE_ANSWER, "Changed everything").unwrap();
    harness.runs.resume_run(&run.id, json!({"approve_message": {"action": "approve"}})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    assert_eq!(harness.db.get_run(&run.id).unwrap().agent_version, 1);
}

#[tokio::test]
async fn aborting_a_paused_run_finishes_it() {
    let harness = harness_with_answers(&["Draft"]);
    let agent = create_agent(&harness.db, DRAFT_AND_APPROVE);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"topic": "tea"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    harness.runs.abort_run(&run.id).unwrap();
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Aborted);
    wait_for_status(&harness.sink, &run.id, RunStatus::Aborted).await;

    assert!(matches!(harness.runs.abort_run(&run.id), Err(AppError::InvalidInput(_))));
    assert!(matches!(
        harness.runs.resume_run(&run.id, json!({"approve_message": {"action": "approve"}})).await,
        Err(AppError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn aborting_a_running_run_records_the_abort() {
    let harness = harness_with_model(Arc::new(HangingModel));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "Anyone?"})).await.unwrap();
    wait_for_event(&harness.db, &run.id, "node_started").await;
    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Running);

    harness.runs.abort_run(&run.id).unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Aborted).await;

    assert_eq!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Aborted);
    let types = stored_event_types(&harness.db, &run.id);
    assert_eq!(types.last().map(String::as_str), Some("run_aborted"));
    assert!(!harness.runs.active_runs.is_registered(&run.id));
}

#[tokio::test]
async fn missing_provider_key_is_rejected_before_a_run_is_recorded() {
    let harness = harness_with_answers(&["unused"]);
    harness.credentials.delete_api_key(ModelProvider::Openai).unwrap();
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let result = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "?"})).await;
    match result {
        Err(AppError::MissingCredentials(provider)) => assert_eq!(provider, "openai"),
        other => panic!("expected MissingCredentials, got {other:?}"),
    }
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty());
    assert!(harness.sink.payloads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn successful_test_run_marks_draft_agent_tested() {
    let harness = harness_with_answers(&["Fine."]);
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    assert_eq!(agent.status, AgentStatus::Draft);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Test, json!({"question": "Ok?"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    assert_eq!(harness.db.get_agent(&agent.id).unwrap().status, AgentStatus::Tested);
}

#[tokio::test]
async fn failed_model_call_fails_the_run_and_keeps_agent_draft() {
    let model = MockModel::new(Vec::new());
    model.push_error(LlmError::Config("provider is down".into()));
    let harness = harness_with_model(Arc::new(model));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Test, json!({"question": "Ok?"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Failed).await;

    let failed = harness.db.get_run(&run.id).unwrap();
    assert!(failed.error_message.is_some_and(|message| !message.is_empty()));
    assert_eq!(stored_event_types(&harness.db, &run.id).last().map(String::as_str), Some("run_failed"));
    assert_eq!(harness.db.get_agent(&agent.id).unwrap().status, AgentStatus::Draft);
}

#[tokio::test]
async fn invalid_requests_are_rejected() {
    let harness = harness_with_answers(&["unused"]);
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);

    assert!(matches!(
        harness.runs.start_run(&agent.id, RunTrigger::Manual, json!(["not", "an", "object"])).await,
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(harness.runs.start_run("ghost", RunTrigger::Manual, json!({})).await, Err(AppError::NotFound(_))));
    assert!(matches!(harness.runs.resume_run("ghost", json!({})).await, Err(AppError::NotFound(_))));
    assert!(matches!(harness.runs.abort_run("ghost"), Err(AppError::NotFound(_))));
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty());
}

#[tokio::test]
async fn resuming_a_running_run_is_rejected() {
    let harness = harness_with_model(Arc::new(HangingModel));
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"question": "?"})).await.unwrap();

    assert!(matches!(harness.runs.resume_run(&run.id, json!({})).await, Err(AppError::InvalidInput(_))));
    harness.runs.abort_run(&run.id).unwrap();
    wait_for_status_count(&harness.sink, &run.id, RunStatus::Aborted, 1).await;
}

/// One model call whose prompt reads two env values; `API_TOKEN` is a secret
/// without a default, `SIGNATURE` a plain value and `TONE` has a default.
const ENV_FLOW: &str = r#"
version: "1"
name: env-flow
env:
  - { name: API_TOKEN, type: secret }
  - { name: SIGNATURE, type: string, description: Signature added to every message }
  - { name: TONE, type: string, value: friendly }
graph:
  nodes:
    - { id: start, type: start, variables: [] }
    - id: write
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Write a {{#env.TONE#}} note signed {{#env.SIGNATURE#}}" }
    - id: end
      type: end
      outputs:
        - { variable: note, value_selector: [write, text] }
  edges:
    - { source: start, target: write }
    - { source: write, target: end }
"#;

#[tokio::test]
async fn missing_workflow_secrets_are_listed_and_no_run_is_recorded() {
    let harness = harness_with_answers(&["unused"]);
    let agent = create_agent(&harness.db, ENV_FLOW);

    let error = harness.runs.start_run(&agent.id, RunTrigger::Test, json!({})).await.unwrap_err();

    match error {
        AppError::MissingCredentials(names) => assert_eq!(names, "API_TOKEN, SIGNATURE"),
        other => panic!("expected missing credentials, got {other:?}"),
    }
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty());
}

#[tokio::test]
async fn stored_workflow_secrets_reach_the_flow_and_defaults_fill_the_rest() {
    let model = Arc::new(MockModel::new(vec![MockModel::text("Hello!")]));
    let harness = harness_with_model(model.clone());
    harness.credentials.set_workflow_secret("API_TOKEN", "token-123").unwrap();
    harness.credentials.set_workflow_secret("SIGNATURE", "Bima Catering").unwrap();
    let agent = create_agent(&harness.db, ENV_FLOW);

    let run = harness.runs.start_run(&agent.id, RunTrigger::Test, json!({})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let prompt = model.requests()[0].messages[0].text();
    assert_eq!(prompt, "Write a friendly note signed Bima Catering");
    let stored_events = serde_json::to_string(&harness.db.list_run_events(&run.id).unwrap()).unwrap();
    assert!(!stored_events.contains("token-123"), "secret leaked into stored events");
}

#[tokio::test]
async fn an_agent_using_plugins_that_are_not_installed_does_not_run() {
    let harness = harness_with_answers(&["unused"]);
    let flow = r#"
version: "1"
name: mail-offer
graph:
  nodes:
    - id: start
      type: start
    - id: send_offer
      type: fixture-mail.send_mail
      title: Send the offer
      to: someone@shop.test
      body: hi
    - id: page
      type: fixture-browser.scrape
      url: https://shop.test
    - id: end
      type: end
  edges:
    - { source: start, target: send_offer }
    - { source: send_offer, target: page }
    - { source: page, target: end }
"#;
    let agent = create_agent(&harness.db, flow);

    let result = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({})).await;

    match result {
        Err(error @ AppError::MissingPlugins(_)) => {
            assert_eq!(error.code(), "missing_plugins");
            assert!(error.to_string().contains("Fixture Browser, Fixture Mail"), "{error}");
        }
        other => panic!("expected MissingPlugins, got {other:?}"),
    }
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty());
    assert!(harness.sink.payloads.lock().unwrap().is_empty());
}
