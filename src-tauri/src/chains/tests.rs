//! Chains end to end: real `RunManager` + `ChainingSink`, scripted mock models.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, LlmError, ModelRegistry};
use serde_json::json;

use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::ModelRegistrySource;
use crate::storage::chains::{ChainDraft, ChainInputMapping};
use crate::storage::models::{Agent, AgentKind, NewAgent, RunFilter};

const WAIT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long "nothing else starts" is observed.
const QUIET_PERIOD: Duration = Duration::from_millis(300);

#[derive(Debug, Default)]
struct CollectingSink {
    payloads: Mutex<Vec<RunEventPayload>>,
}

impl RunEventSink for CollectingSink {
    fn send(&self, payload: RunEventPayload) {
        self.payloads.lock().unwrap().push(payload);
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
    runs: Arc<RunManager>,
    runner: Arc<ChainRunner>,
    inner_sink: Arc<CollectingSink>,
    model: Arc<MockModel>,
}

fn harness() -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(Vec::new()));
    let inner_sink = Arc::new(CollectingSink::default());
    let runner = Arc::new(ChainRunner::new(db.clone()));
    let sink = Arc::new(ChainingSink::new(inner_sink.clone(), runner.clone()));
    let runs = Arc::new(
        RunManager::new(db.clone(), credentials, sink)
            .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() })),
    );
    runner.attach(&runs);
    Harness { db, runs, runner, inner_sink, model }
}

/// Writes about `topic`; outputs `message`.
const WRITER_FLOW: &str = r#"
version: "1"
name: writer
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: topic, type: paragraph, required: true }
        - { variable: tone, type: text-input }
    - id: write
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Write about {{#start.topic#}} {{#start.tone#}}" }
    - id: end
      type: end
      outputs:
        - { variable: message, value_selector: [write, text] }
  edges:
    - { source: start, target: write }
    - { source: write, target: end }
"#;

fn create_agent(db: &Database, name: &str) -> Agent {
    db.create_agent(NewAgent {
        name: name.into(),
        kind: AgentKind::Task,
        description: name.into(),
        flow_yaml: WRITER_FLOW.into(),
    })
    .unwrap()
}

fn first_step(agent: &Agent) -> ChainStep {
    ChainStep {
        agent_id: agent.id.clone(),
        inputs: vec![ChainInputMapping {
            input: "topic".into(),
            source: ChainInputSource::Constant { value: json!("cafes") },
        }],
        run_condition: ChainRunCondition::OnSuccess,
        on_failure: ChainFailurePolicy::Stop,
    }
}

/// B's `topic` ← A's `message`, `tone` ← a constant.
fn mapped_step(agent: &Agent, run_condition: ChainRunCondition) -> ChainStep {
    ChainStep {
        agent_id: agent.id.clone(),
        inputs: vec![
            ChainInputMapping {
                input: "topic".into(),
                source: ChainInputSource::Output { output_key: "message".into() },
            },
            ChainInputMapping { input: "tone".into(), source: ChainInputSource::Constant { value: json!("briefly") } },
        ],
        run_condition,
        on_failure: ChainFailurePolicy::Stop,
    }
}

fn create_active_chain(db: &Database, steps: Vec<ChainStep>) -> Chain {
    let chain = db.create_chain(ChainDraft { name: "Chain".into(), steps }).unwrap();
    db.set_chain_status(&chain.id, ChainStatus::Active).unwrap()
}

fn runs_of(db: &Database, agent: &Agent) -> Vec<Run> {
    db.list_runs(&RunFilter { agent_id: Some(agent.id.clone()), ..RunFilter::default() }).unwrap()
}

async fn wait_for_runs(db: &Database, agent: &Agent, count: usize) -> Vec<Run> {
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    loop {
        let runs = runs_of(db, agent);
        let finished = runs.iter().filter(|run| run.status != RunStatus::Running).count();
        if runs.len() >= count && finished == runs.len() {
            return runs;
        }
        assert!(tokio::time::Instant::now() < deadline, "agent {} never got {count} finished runs", agent.name);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Waits long enough for any (wrong) follow-up run to have been started.
async fn settle() {
    tokio::time::sleep(QUIET_PERIOD).await;
}

#[tokio::test]
async fn success_starts_the_next_agent_with_mapped_inputs() {
    let harness = harness();
    harness.model.push(MockModel::text("Hello cafes"));
    harness.model.push(MockModel::text("Short recap"));
    let writer = create_agent(&harness.db, "Writer");
    let recapper = create_agent(&harness.db, "Recapper");
    create_active_chain(&harness.db, vec![first_step(&writer), mapped_step(&recapper, ChainRunCondition::OnSuccess)]);

    harness.runs.start_run(&writer.id, RunTrigger::Manual, json!({"topic": "cafes"})).await.unwrap();
    let recap_runs = wait_for_runs(&harness.db, &recapper, 1).await;

    assert_eq!(recap_runs[0].status, RunStatus::Succeeded);
    assert_eq!(recap_runs[0].trigger, RunTrigger::Manual);
    assert_eq!(recap_runs[0].outputs.as_ref().unwrap()["message"], json!("Short recap"));
    assert_eq!(harness.model.requests()[1].messages[0].text(), "Write about Hello cafes briefly");
    // Events still reach the UI sink.
    assert!(!harness.inner_sink.payloads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failure_does_not_start_an_on_success_link() {
    let harness = harness();
    harness.model.push_error(LlmError::Config("provider is down".into()));
    let writer = create_agent(&harness.db, "Writer");
    let recapper = create_agent(&harness.db, "Recapper");
    create_active_chain(&harness.db, vec![first_step(&writer), mapped_step(&recapper, ChainRunCondition::OnSuccess)]);

    harness.runs.start_run(&writer.id, RunTrigger::Manual, json!({"topic": "cafes"})).await.unwrap();
    let writer_runs = wait_for_runs(&harness.db, &writer, 1).await;
    settle().await;

    assert_eq!(writer_runs[0].status, RunStatus::Failed);
    assert!(runs_of(&harness.db, &recapper).is_empty());
}

#[tokio::test]
async fn failure_starts_an_always_link_only_when_the_failed_step_continues() {
    let harness = harness();
    harness.model.push_error(LlmError::Config("provider is down".into()));
    harness.model.push(MockModel::text("Recap anyway"));
    let writer = create_agent(&harness.db, "Writer");
    let recapper = create_agent(&harness.db, "Recapper");
    let mut writer_step = first_step(&writer);
    writer_step.on_failure = ChainFailurePolicy::Continue;
    let mut recap_step = mapped_step(&recapper, ChainRunCondition::Always);
    // The failed run has no outputs, so give `topic` a constant.
    recap_step.inputs[0].source = ChainInputSource::Constant { value: json!("nothing") };
    create_active_chain(&harness.db, vec![writer_step, recap_step]);

    harness.runs.start_run(&writer.id, RunTrigger::Manual, json!({"topic": "cafes"})).await.unwrap();
    let recap_runs = wait_for_runs(&harness.db, &recapper, 1).await;
    assert_eq!(recap_runs[0].status, RunStatus::Succeeded);
}

#[tokio::test]
async fn a_paused_chain_does_nothing() {
    let harness = harness();
    harness.model.push(MockModel::text("Hello"));
    let writer = create_agent(&harness.db, "Writer");
    let recapper = create_agent(&harness.db, "Recapper");
    let chain =
        create_active_chain(&harness.db, vec![first_step(&writer), mapped_step(&recapper, ChainRunCondition::Always)]);
    harness.db.set_chain_status(&chain.id, ChainStatus::Paused).unwrap();

    harness.runs.start_run(&writer.id, RunTrigger::Manual, json!({"topic": "cafes"})).await.unwrap();
    wait_for_runs(&harness.db, &writer, 1).await;
    settle().await;

    assert!(runs_of(&harness.db, &recapper).is_empty());
}

#[tokio::test]
async fn chains_never_loop() {
    let harness = harness();
    for answer in ["one", "two", "three", "four"] {
        harness.model.push(MockModel::text(answer));
    }
    let first = create_agent(&harness.db, "First");
    let second = create_agent(&harness.db, "Second");
    // A → B → A inside one chain, and B → A in a second chain.
    create_active_chain(
        &harness.db,
        vec![
            first_step(&first),
            mapped_step(&second, ChainRunCondition::Always),
            mapped_step(&first, ChainRunCondition::Always),
        ],
    );
    create_active_chain(&harness.db, vec![first_step(&second), mapped_step(&first, ChainRunCondition::Always)]);

    harness.runs.start_run(&first.id, RunTrigger::Manual, json!({"topic": "cafes"})).await.unwrap();
    wait_for_runs(&harness.db, &second, 1).await;
    settle().await;

    assert_eq!(runs_of(&harness.db, &first).len(), 1, "First must not run again");
    assert_eq!(runs_of(&harness.db, &second).len(), 1);
}

#[tokio::test]
async fn test_chain_starts_the_first_agent_even_while_paused() {
    let harness = harness();
    harness.model.push(MockModel::text("Hello"));
    harness.model.push(MockModel::text("Recap"));
    let writer = create_agent(&harness.db, "Writer");
    let recapper = create_agent(&harness.db, "Recapper");
    let chain = harness
        .db
        .create_chain(ChainDraft {
            name: "Draft chain".into(),
            steps: vec![first_step(&writer), mapped_step(&recapper, ChainRunCondition::OnSuccess)],
        })
        .unwrap();
    assert_eq!(chain.status, ChainStatus::Paused);

    let run = harness.runner.test_chain(&chain.id).await.unwrap();
    assert_eq!(run.agent_id, writer.id);
    assert_eq!(run.trigger, RunTrigger::Test);
    let recap_runs = wait_for_runs(&harness.db, &recapper, 1).await;
    assert_eq!(recap_runs[0].trigger, RunTrigger::Test);
    assert_eq!(harness.model.requests()[0].messages[0].text(), "Write about cafes ");

    let empty_chain = harness.db.create_chain(ChainDraft { name: "Empty".into(), steps: Vec::new() }).unwrap();
    assert!(matches!(harness.runner.test_chain(&empty_chain.id).await, Err(AppError::InvalidInput(_))));
}

#[test]
fn inputs_skip_missing_outputs() {
    let step = ChainStep {
        agent_id: "b".into(),
        inputs: vec![
            ChainInputMapping {
                input: "topic".into(),
                source: ChainInputSource::Output { output_key: "missing".into() },
            },
            ChainInputMapping { input: "tone".into(), source: ChainInputSource::Constant { value: json!(3) } },
        ],
        run_condition: ChainRunCondition::Always,
        on_failure: ChainFailurePolicy::Stop,
    };
    assert_eq!(build_inputs(&step, Some(&json!({"message": "x"}))), json!({"tone": 3}));
}
