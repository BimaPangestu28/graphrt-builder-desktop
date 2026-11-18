//! Team activity, coordinator chat and guardrails from real runs on graphrt
//! with scripted mock models.

use std::sync::Arc;
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::json;

use super::guardrails::{get_team_guardrails, set_max_agent_calls_per_run};
use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::{ModelRegistrySource, RunEventPayload, RunEventSink, RunManager};
use crate::storage::models::{AgentKind, NewAgent, RunTrigger};

const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

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

#[derive(Debug, Default)]
struct DiscardingSink;

impl RunEventSink for DiscardingSink {
    fn send(&self, _payload: RunEventPayload) {}
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
    member: Agent,
    team: Agent,
}

fn harness() -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(Vec::new()));
    let runs = RunManager::new(db.clone(), credentials, Arc::new(DiscardingSink))
        .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }));
    let member = create_agent(&db, "Summarizer", AgentKind::Task, SUMMARIZER_FLOW);
    let team = create_agent(&db, "Sales team", AgentKind::Team, &team_flow(&member.id));
    Harness { db, runs, model, member, team }
}

fn create_agent(db: &Database, name: &str, kind: AgentKind, flow_yaml: &str) -> Agent {
    db.create_agent(NewAgent { name: name.into(), kind, description: format!("{name}."), flow_yaml: flow_yaml.into() })
        .unwrap()
}

async fn run_team(harness: &Harness, goal: &str) -> Run {
    let inputs = coordinator_run_inputs(&harness.team, goal).unwrap();
    let run = harness.runs.start_run(&harness.team.id, RunTrigger::Manual, inputs).await.unwrap();
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    loop {
        let current = harness.db.get_run(&run.id).unwrap();
        if !matches!(current.status, RunStatus::Running) {
            return current;
        }
        assert!(tokio::time::Instant::now() < deadline, "run {} never finished", run.id);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn sentence(entry: &TeamActivityEntry) -> String {
    entry.parts.iter().map(|part| part.text.as_str()).collect()
}

#[tokio::test]
async fn activity_and_chat_come_from_the_team_run_and_its_member_calls() {
    let harness = harness();
    let arguments = json!({"text": "Report"}).to_string();
    harness.model.push(MockModel::tool_calls(&[("call_1", harness.member.id.as_str(), arguments.as_str())]));
    harness.model.push(MockModel::text("Member summary"));
    harness.model.push(MockModel::text("The team is done"));

    let finished = run_team(&harness, "Summarize the report").await;
    assert_eq!(finished.status, RunStatus::Succeeded, "{:?}", finished.error_message);

    let activity = list_team_activity(&harness.db, &harness.team.id).unwrap();
    let sentences: Vec<String> = activity.iter().map(sentence).collect();
    assert_eq!(
        sentences,
        [
            "Coordinator finished the goal",
            "Summarizer finished and reported back",
            "Coordinator asked Summarizer: Report",
            "Coordinator started on a goal: Summarize the report",
        ],
        "newest first"
    );
    assert!(activity.iter().all(|entry| entry.run_id == finished.id));
    let asked = &activity[2].parts;
    assert!(asked[0].is_member && !asked[1].is_member && asked[2].is_member);

    let chat = list_coordinator_chat(&harness.db, &harness.team.id).unwrap();
    assert_eq!(chat.len(), 1);
    assert_eq!(chat[0].message, "Summarize the report");
    assert_eq!(chat[0].reply_text.as_deref(), Some("The team is done"));
    assert_eq!(
        chat[0].member_calls,
        [CoordinatorMemberCall {
            member_name: "Summarizer".into(),
            task: "Report".into(),
            status: MemberCallStatus::Done
        }]
    );
    assert_eq!(chat[0].note.as_deref(), Some("1 agent call"));
}

#[tokio::test]
async fn member_runs_of_their_own_appear_in_the_activity() {
    let harness = harness();
    harness.model.push(MockModel::text("Alone"));
    let run = harness.runs.start_run(&harness.member.id, RunTrigger::Manual, json!({"text": "x"})).await.unwrap();
    let deadline = tokio::time::Instant::now() + WAIT_TIMEOUT;
    while matches!(harness.db.get_run(&run.id).unwrap().status, RunStatus::Running) {
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let activity = list_team_activity(&harness.db, &harness.team.id).unwrap();
    assert_eq!(activity.iter().map(sentence).collect::<Vec<_>>(), ["Summarizer finished a run of its own"]);
}

#[tokio::test]
async fn the_agent_call_guardrail_stops_calls_beyond_the_limit() {
    let harness = harness();
    let guardrails = set_max_agent_calls_per_run(&harness.db, &harness.team.id, Some(1)).unwrap();
    assert_eq!(guardrails.max_agent_calls_per_run, Some(1));
    let first = json!({"text": "First"}).to_string();
    let second = json!({"text": "Second"}).to_string();
    let member_id = harness.member.id.as_str();
    harness.model.push(MockModel::tool_calls(&[("call_1", member_id, first.as_str())]));
    harness.model.push(MockModel::text("First summary"));
    harness.model.push(MockModel::tool_calls(&[("call_2", member_id, second.as_str())]));
    harness.model.push(MockModel::text("Done with one"));

    let finished = run_team(&harness, "Two jobs").await;
    assert_eq!(finished.status, RunStatus::Succeeded, "{:?}", finished.error_message);
    let requests = harness.model.requests();
    // Coordinator, member (first call only), coordinator, coordinator: the second call never ran.
    assert_eq!(requests.len(), 4);
    let last_turn = serde_json::to_string(&requests[3].messages).unwrap();
    assert!(last_turn.contains("the limit of 1 agent calls per run is reached"), "{last_turn}");

    let chat = list_coordinator_chat(&harness.db, &harness.team.id).unwrap();
    let statuses: Vec<MemberCallStatus> = chat[0].member_calls.iter().map(|call| call.status).collect();
    assert_eq!(statuses, [MemberCallStatus::Done, MemberCallStatus::Failed]);
    assert_eq!(chat[0].note.as_deref(), Some("2 agent calls of max 1"));
}

#[test]
fn guardrails_validate_the_limit_and_report_sending() {
    let db = Database::open_in_memory().unwrap();
    let team = create_agent(&db, "Team", AgentKind::Team, SUMMARIZER_FLOW);
    let guardrails = get_team_guardrails(&db, &team.id).unwrap();
    assert_eq!(guardrails.max_agent_calls_per_run, None);
    assert!(guardrails.unapproved_sending_steps.is_empty());
    assert!(matches!(set_max_agent_calls_per_run(&db, &team.id, Some(0)), Err(AppError::InvalidInput(_))));
    assert!(matches!(set_max_agent_calls_per_run(&db, &team.id, Some(101)), Err(AppError::InvalidInput(_))));
    set_max_agent_calls_per_run(&db, &team.id, Some(5)).unwrap();
    assert_eq!(set_max_agent_calls_per_run(&db, &team.id, None).unwrap().max_agent_calls_per_run, None);
    assert_eq!(guardrails::max_agent_calls_per_run(&db, &team.id), None);
}

#[test]
fn coordinator_messages_fill_the_teams_text_input() {
    let db = Database::open_in_memory().unwrap();
    let member = create_agent(&db, "Summarizer", AgentKind::Task, SUMMARIZER_FLOW);
    let team = create_agent(&db, "Team", AgentKind::Team, &team_flow(&member.id));
    assert_eq!(coordinator_run_inputs(&team, "  Find cafes ").unwrap(), json!({"goal": "Find cafes"}));
    assert!(matches!(coordinator_run_inputs(&team, " "), Err(AppError::InvalidInput(_))));
}
