//! A `tool` step / `agent`-node tool calling another stored agent, end to end on
//! graphrt with scripted mock models.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::json;

use super::*;
use crate::credentials::ModelProvider;
use crate::engine::{RunEventPayload, RunEventSink, RunManager};
use crate::error::AppError;
use crate::storage::models::{AgentKind, NewAgent, Run, RunStatus, RunTrigger};

const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Default)]
struct DiscardingSink {
    payloads: Mutex<Vec<RunEventPayload>>,
}

impl RunEventSink for DiscardingSink {
    fn send(&self, payload: RunEventPayload) {
        if let Ok(mut payloads) = self.payloads.lock() {
            payloads.push(payload);
        }
    }
}

#[derive(Debug)]
struct FixedModelSource {
    model: Arc<dyn ChatModel>,
}

impl ModelRegistrySource for FixedModelSource {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.model.clone()))
    }
}

struct Harness {
    db: Arc<Database>,
    runs: RunManager,
    model: Arc<MockModel>,
}

fn harness(model: MockModel) -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(model);
    let runs = RunManager::new(db.clone(), credentials, Arc::new(DiscardingSink::default()))
        .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }));
    Harness { db, runs, model }
}

fn create_agent(db: &Database, name: &str, flow_yaml: &str) -> Agent {
    db.create_agent(NewAgent {
        name: name.into(),
        kind: AgentKind::Task,
        description: format!("{name}."),
        flow_yaml: flow_yaml.into(),
    })
    .unwrap()
}

async fn wait_until_finished(db: &Database, run_id: &str) -> Run {
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    loop {
        let run = db.get_run(run_id).unwrap();
        if !matches!(run.status, RunStatus::Running) {
            return run;
        }
        assert!(tokio::time::Instant::now() < deadline, "run {run_id} never finished");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Summarizes `text` with one model call; outputs `summary`.
const SUMMARIZER_FLOW: &str = r#"
version: "1"
name: summarizer
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: text, type: paragraph, required: true, label: Text to summarize }
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

/// Calls agent `{agent_id}` as a `tool` step with `text` from the start input.
fn calling_flow(agent_id: &str) -> String {
    format!(
        r#"
version: "1"
name: caller
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: topic, type: paragraph, required: true }}
    - id: call_agent
      type: tool
      title: Run the summarizer
      provider_id: agents
      tool_name: "{agent_id}"
      tool_parameters:
        text: {{ type: variable, value: [start, topic] }}
    - id: end
      type: end
      outputs:
        - {{ variable: result, value_selector: [call_agent, json, summary] }}
        - {{ variable: text, value_selector: [call_agent, text] }}
  edges:
    - {{ source: start, target: call_agent }}
    - {{ source: call_agent, target: end }}
"#
    )
}

const APPROVAL_FLOW: &str = r#"
version: "1"
name: asks
graph:
  nodes:
    - { id: start, type: start, variables: [] }
    - id: ask
      type: human-input
      prompt: "Go?"
      actions: [{ id: go, title: Go }]
    - { id: end, type: end, outputs: [{ variable: action, value_selector: [ask, action] }] }
  edges:
    - { source: start, target: ask }
    - { source: ask, target: end, handle: go }
"#;

#[tokio::test]
async fn a_tool_step_runs_another_agent_and_gets_its_outputs() {
    let harness = harness(MockModel::new(vec![MockModel::text("Short summary")]));
    let summarizer = create_agent(&harness.db, "Summarizer", SUMMARIZER_FLOW);
    let caller = create_agent(&harness.db, "Caller", &calling_flow(&summarizer.id));

    let run = harness.runs.start_run(&caller.id, RunTrigger::Manual, json!({"topic": "A long text"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Succeeded, "{:?}", finished.error_message);
    let outputs = finished.outputs.unwrap();
    assert_eq!(outputs["result"], json!("Short summary"));
    assert_eq!(outputs["text"], json!("Short summary"));
    assert_eq!(harness.model.requests()[0].messages[0].text(), "Summarize: A long text");
    // The nested run is not recorded as a run of its own.
    let summarizer_runs = harness
        .db
        .list_runs(&crate::storage::models::RunFilter { agent_id: Some(summarizer.id), ..Default::default() })
        .unwrap();
    assert!(summarizer_runs.is_empty());
}

#[tokio::test]
async fn an_agent_calling_itself_is_rejected() {
    let harness = harness(MockModel::new(Vec::new()));
    let looping = create_agent(&harness.db, "Looper", SUMMARIZER_FLOW);
    harness.db.update_agent_flow(&looping.id, &calling_flow(&looping.id), "Calls itself").unwrap();

    let run = harness.runs.start_run(&looping.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Failed);
    assert!(finished.error_message.unwrap().contains("cannot call itself"));
}

#[tokio::test]
async fn a_cycle_between_two_agents_is_rejected() {
    let harness = harness(MockModel::new(Vec::new()));
    let first = create_agent(&harness.db, "First", SUMMARIZER_FLOW);
    let second = create_agent(&harness.db, "Second", SUMMARIZER_FLOW);
    harness.db.update_agent_flow(&first.id, &calling_flow(&second.id), "Calls second").unwrap();
    // `second` passes its `text` on as `topic`... it has no `topic` input, so map it explicitly.
    let second_flow =
        calling_flow(&first.id).replace("variable: topic", "variable: text").replace("[start, topic]", "[start, text]");
    harness.db.update_agent_flow(&second.id, &second_flow, "Calls first").unwrap();

    let run = harness.runs.start_run(&first.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Failed);
    let message = finished.error_message.unwrap();
    assert!(message.contains("First is already running"), "{message}");
}

#[tokio::test]
async fn a_called_agent_that_asks_for_approval_fails_the_call() {
    let harness = harness(MockModel::new(Vec::new()));
    let asking = create_agent(&harness.db, "Asker", APPROVAL_FLOW);
    let caller_flow = calling_flow(&asking.id).replace("text: { type: variable, value: [start, topic] }", "{}");
    let caller = create_agent(&harness.db, "Caller", &caller_flow);

    let run = harness.runs.start_run(&caller.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Failed);
    assert!(finished.error_message.unwrap().contains(APPROVAL_NOT_SUPPORTED_MESSAGE));
}

#[tokio::test]
async fn a_paused_agent_refuses_calls() {
    let harness = harness(MockModel::new(Vec::new()));
    let summarizer = create_agent(&harness.db, "Summarizer", SUMMARIZER_FLOW);
    harness.db.set_agent_status(&summarizer.id, AgentStatus::Paused).unwrap();
    let caller = create_agent(&harness.db, "Caller", &calling_flow(&summarizer.id));

    let run = harness.runs.start_run(&caller.id, RunTrigger::Manual, json!({"topic": "x"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Failed);
    assert!(finished.error_message.unwrap().contains("Summarizer is paused"));
}

/// A team: the coordinator `agent` node has the summarizer as a tool.
fn team_flow(member_id: &str) -> String {
    format!(
        r#"
version: "1"
name: team
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: goal, type: paragraph, required: true }}
    - id: coordinator
      type: agent
      model: {{ provider: openai, name: gpt-4o-mini }}
      instruction: "Hand the text to your member."
      query: "{{{{#start.goal#}}}}"
      tools: ["agents/{member_id}"]
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

#[tokio::test]
async fn a_team_coordinator_calls_member_agents_as_tools() {
    let harness = harness(MockModel::new(Vec::new()));
    let summarizer = create_agent(&harness.db, "Summarizer", SUMMARIZER_FLOW);
    let arguments = json!({"text": "Report"}).to_string();
    harness.model.push(MockModel::tool_calls(&[("call_1", summarizer.id.as_str(), arguments.as_str())]));
    harness.model.push(MockModel::text("Member summary"));
    harness.model.push(MockModel::text("The team is done"));
    let team = create_agent(&harness.db, "Team", &team_flow(&summarizer.id));

    let run =
        harness.runs.start_run(&team.id, RunTrigger::Manual, json!({"goal": "Summarize the report"})).await.unwrap();
    let finished = wait_until_finished(&harness.db, &run.id).await;

    assert_eq!(finished.status, RunStatus::Succeeded, "{:?}", finished.error_message);
    assert_eq!(finished.outputs.unwrap()["text"], json!("The team is done"));
    let requests = harness.model.requests();
    let offered_tools: Vec<&str> = requests[0].tools.iter().map(|tool| tool.name.as_str()).collect();
    assert_eq!(offered_tools, [summarizer.id.as_str()]);
    assert_eq!(requests[1].messages[0].text(), "Summarize: Report");
    let final_request = serde_json::to_string(&requests[2].messages).unwrap();
    assert!(final_request.contains("Member summary"));
}

#[test]
fn recursion_error_covers_self_calls_and_depth() {
    let db = Database::open_in_memory().unwrap();
    let agent = create_agent(&db, "Deep", SUMMARIZER_FLOW);
    assert!(recursion_error(std::slice::from_ref(&agent.id), &agent).is_some());
    let shallow: Vec<String> = (0..MAX_AGENT_CALL_DEPTH).map(|index| format!("agent-{index}")).collect();
    assert!(recursion_error(&shallow, &agent).is_none());
    let too_deep: Vec<String> = (0..=MAX_AGENT_CALL_DEPTH).map(|index| format!("agent-{index}")).collect();
    assert!(recursion_error(&too_deep, &agent).unwrap().contains("levels deep"));
}

#[tokio::test]
async fn unknown_agents_are_a_tool_error() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let dependencies = EngineDependencies {
        db: db.clone(),
        credentials: Arc::new(CredentialStore::in_memory()),
        model_source: Arc::new(FixedModelSource { model: Arc::new(MockModel::new(Vec::new())) }),
        agent_files: None,
        read_only_memory: false,
    };
    let registry = agent_tool_registry(&dependencies, vec!["caller".into()]);
    let runtime = registry.get(AGENT_TOOL_PROVIDER).unwrap();
    let error = runtime.call("ghost", json!({}), ToolCallContext::empty()).await.unwrap_err();
    assert!(error.message.contains("not found"));
    create_agent(&db, "Listed", SUMMARIZER_FLOW);
    let specs = runtime.list().await.unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].parameters["required"], json!(["text"]));
    assert!(matches!(db.get_agent("ghost"), Err(AppError::NotFound(_))));
}
