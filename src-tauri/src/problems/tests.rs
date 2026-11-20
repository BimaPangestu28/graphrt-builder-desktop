use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::{json, Value as Json};

use super::models::{FailedRunStepState, ProblemActionKind, ProblemKind};
use super::*;
use crate::credentials::ModelProvider;
use crate::engine::{ModelRegistrySource, RunEventPayload, RunEventSink, RunManager};
use crate::error::AppError;
use crate::plugins::models::{PluginConfigStatus, PluginPermissions};
use crate::storage::models::{AgentKind, MissedRunPolicy, NewAgent, NewTrigger};

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");

const SECRET_FLOW: &str = r#"
version: "1"
name: weather
env:
  - { name: WEATHER_TOKEN, type: secret }
  - { name: CITY, type: string, value: Jakarta }
graph:
  nodes:
    - { id: start, type: start }
    - id: write
      type: llm
      model: { provider: anthropic, name: claude-test }
      prompt_template:
        - { role: user, text: "Weather" }
    - { id: end, type: end, outputs: [] }
  edges:
    - { source: start, target: write }
    - { source: write, target: end }
"#;

const PLUGIN_FLOW: &str = r#"
version: "1"
name: leads
graph:
  nodes:
    - { id: start, type: start }
    - { id: search, type: maps-browser.search_places, title: Search Google Maps }
    - { id: send, type: whatsapp-api.send_text, title: Send on WhatsApp }
    - { id: end, type: end, outputs: [] }
  edges:
    - { source: start, target: search }
    - { source: search, target: send }
    - { source: send, target: end }
"#;

/// Events of a run of `simple_answer.yaml` whose model step timed out after retries.
fn timed_out_events() -> Vec<Json> {
    vec![
        json!({"type": "run_started", "run_id": "r", "resumed": false}),
        json!({"type": "node_started", "node_id": "start", "kind": "start", "title": "", "exec_id": "1", "attempt": 1}),
        json!({"type": "node_succeeded", "node_id": "start", "exec_id": "1", "outputs": {"question": "Why?", "note": null}}),
        json!({"type": "node_started", "node_id": "answer_question", "kind": "llm", "title": "Answer the question", "exec_id": "2", "attempt": 1}),
        json!({"type": "node_retry", "node_id": "answer_question", "exec_id": "2", "attempt": 1, "error": "timed out", "delay_ms": 500}),
        json!({"type": "node_retry", "node_id": "answer_question", "exec_id": "2", "attempt": 2, "error": "timed out", "delay_ms": 1000}),
        json!({"type": "node_failed", "node_id": "answer_question", "exec_id": "2", "error": "node timed out after 120000ms", "error_type": "timeout", "handled": false, "elapsed_ms": 5}),
        json!({"type": "run_failed", "error": "node answer_question failed: node timed out after 120000ms", "error_type": "timeout", "elapsed_ms": 6}),
    ]
}

struct Fixture {
    db: Database,
    credentials: CredentialStore,
    plugins: Vec<InstalledPlugin>,
    browser_status: BrowserRuntimeStatus,
}

impl Fixture {
    fn new() -> Self {
        let credentials = CredentialStore::in_memory();
        credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
        Self {
            db: Database::open_in_memory().unwrap(),
            credentials,
            plugins: Vec::new(),
            browser_status: BrowserRuntimeStatus::Installed,
        }
    }

    fn agent(&self, name: &str, flow_yaml: &str) -> Agent {
        let agent = self
            .db
            .create_agent(NewAgent {
                name: name.into(),
                kind: AgentKind::Task,
                description: "test".into(),
                flow_yaml: flow_yaml.into(),
            })
            .unwrap();
        self.db.set_agent_status(&agent.id, AgentStatus::Active).unwrap()
    }

    fn finished_run(&self, agent: &Agent, trigger: RunTrigger, status: RunStatus, events: &[Json]) -> Run {
        let run = self.db.insert_run(&agent.id, agent.current_version, trigger).unwrap();
        for event in events {
            self.db.append_run_event(&run.id, event).unwrap();
        }
        let error =
            (status == RunStatus::Failed).then_some("node answer_question failed: node timed out after 120000ms");
        self.db.finish_run(&run.id, status, None, error).unwrap();
        self.db.get_run(&run.id).unwrap()
    }

    fn problems(&self) -> Vec<Problem> {
        let sources = ProblemSources {
            db: &self.db,
            credentials: &self.credentials,
            plugins: &self.plugins,
            browser_status: self.browser_status,
        };
        collect_problems(&sources).unwrap()
    }

    fn problems_of(&self, kind: ProblemKind) -> Vec<Problem> {
        self.problems().into_iter().filter(|problem| problem.kind == kind).collect()
    }
}

fn installed_plugin(name: &str) -> InstalledPlugin {
    InstalledPlugin {
        name: name.into(),
        display_name: crate::plugins::display_name::humanize_plugin_name(name),
        version: "1.0.0".into(),
        description: String::new(),
        permissions: PluginPermissions::default(),
        trusted: true,
        needs_browser: false,
        nodes: Vec::new(),
        tools: Vec::new(),
        config: Vec::new(),
        load_error: None,
        warnings: Vec::new(),
        readme_url: None,
        icon_url: None,
    }
}

fn action_kinds(problem: &Problem) -> Vec<ProblemActionKind> {
    problem.actions.iter().map(|action| action.kind).collect()
}

#[test]
fn nothing_wrong_means_no_problems() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Succeeded, &[]);
    assert!(fixture.problems().is_empty());
}

#[test]
fn latest_failed_run_is_explained_with_retry() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let run = fixture.finished_run(&agent, RunTrigger::Schedule, RunStatus::Failed, &timed_out_events());

    let problems = fixture.problems_of(ProblemKind::FailedRun);
    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.title, "A step kept timing out");
    assert!(problem.detail.contains("Answer the question took too long"), "{}", problem.detail);
    assert_eq!(problem.run_id.as_deref(), Some(run.id.as_str()));
    assert_eq!(problem.agent_name.as_deref(), Some("Answers"));
    assert_eq!(action_kinds(problem), [ProblemActionKind::OpenRun, ProblemActionKind::RetryRun]);
}

#[test]
fn only_the_latest_non_test_run_counts() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Failed, &timed_out_events());
    fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Succeeded, &[]);
    fixture.finished_run(&agent, RunTrigger::Test, RunStatus::Failed, &timed_out_events());
    assert!(fixture.problems_of(ProblemKind::FailedRun).is_empty());
}

#[test]
fn failed_run_report_lists_steps_and_graphrt_error() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let run = fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Failed, &timed_out_events());

    let report = failed_run_report(&fixture.db, &run.id).unwrap();
    assert_eq!(report.agent_name, "Answers");
    assert_eq!(report.failed_step_id.as_deref(), Some("answer_question"));
    let states: Vec<(&str, FailedRunStepState)> =
        report.steps.iter().map(|step| (step.id.as_str(), step.state)).collect();
    assert_eq!(states, [("answer_question", FailedRunStepState::Failed), ("reply", FailedRunStepState::Pending)]);
    assert_eq!(report.steps[0].note.as_deref(), Some("Failed after 3 tries"));
    assert!(report.technical_details.contains("node: answer_question (llm)"));
    assert!(report.technical_details.contains("error: timeout · node timed out after 120000ms"));
    assert!(report.technical_details.contains("resume: not possible"));
    assert!(report.retry.can_retry);
    assert_eq!(report.fix_action.map(|action| action.kind), Some(ProblemActionKind::OpenBuilder));
}

#[test]
fn signed_out_and_interrupted_runs_get_their_own_explanation() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let run = fixture.db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
    fixture.db.finish_run(&run.id, RunStatus::Failed, None, Some("HTTP 401: invalid_grant")).unwrap();
    let report = failed_run_report(&fixture.db, &run.id).unwrap();
    assert_eq!(report.title, "A connected account was signed out");
    assert_eq!(report.fix_action.map(|action| action.kind), Some(ProblemActionKind::OpenConnections));

    let interrupted = fixture.db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
    let started =
        json!({"type": "node_started", "node_id": "answer_question", "kind": "llm", "title": "Answer the question"});
    fixture.db.append_run_event(&interrupted.id, &started).unwrap();
    fixture.db.fail_interrupted_runs().unwrap();
    let report = failed_run_report(&fixture.db, &interrupted.id).unwrap();
    assert_eq!(report.title, "The app closed during this run");
    assert_eq!(report.failed_step_id.as_deref(), Some("answer_question"));
}

#[test]
fn missing_provider_key_and_secret_are_reported_for_active_agents_only() {
    let fixture = Fixture::new();
    fixture.agent("Weather", SECRET_FLOW);
    fixture
        .db
        .create_agent(NewAgent {
            name: "Draft".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: SECRET_FLOW.into(),
        })
        .unwrap();

    let problems = fixture.problems_of(ProblemKind::MissingCredentials);
    assert_eq!(problems.len(), 1, "drafts are left out");
    assert_eq!(problems[0].title, "Weather is missing a connection");
    assert!(problems[0].detail.contains("Anthropic key, WEATHER_TOKEN"), "{}", problems[0].detail);
    assert!(!problems[0].detail.contains("CITY"), "values with a default are not required");
    assert_eq!(action_kinds(&problems[0]), [ProblemActionKind::OpenConnections]);

    fixture.credentials.set_api_key(ModelProvider::Anthropic, "sk-ant").unwrap();
    fixture.credentials.set_workflow_secret("WEATHER_TOKEN", "token").unwrap();
    assert!(fixture.problems_of(ProblemKind::MissingCredentials).is_empty());
}

#[test]
fn plugins_missing_not_loaded_or_untrusted_are_reported() {
    let mut fixture = Fixture::new();
    fixture.agent("Maps leads", PLUGIN_FLOW);
    let problems = fixture.problems_of(ProblemKind::PluginMissing);
    assert_eq!(problems.len(), 2);
    assert_eq!(problems[0].title, "The Maps Browser plugin is not installed");
    assert_eq!(action_kinds(&problems[0]), [ProblemActionKind::OpenPlugins]);

    let mut broken = installed_plugin("maps-browser");
    broken.load_error = Some("manifest is missing `nodes`".into());
    let mut untrusted = installed_plugin("whatsapp-api");
    untrusted.trusted = false;
    let mut unused_broken = installed_plugin("x-api");
    unused_broken.load_error = Some("could not start node".into());
    fixture.plugins = vec![broken, untrusted, unused_broken];

    let problems = fixture.problems();
    let kinds: Vec<(ProblemKind, &str)> =
        problems.iter().map(|problem| (problem.kind, problem.title.as_str())).collect();
    assert!(kinds.contains(&(ProblemKind::PluginNotLoaded, "The Maps Browser plugin could not start")));
    assert!(kinds.contains(&(ProblemKind::PluginNotLoaded, "The X API plugin could not start")));
    assert!(kinds.contains(&(ProblemKind::PluginUntrusted, "The WhatsApp API plugin is not trusted yet")));
    assert!(!kinds.iter().any(|(kind, _)| *kind == ProblemKind::PluginMissing));
    let not_loaded = problems.iter().find(|problem| problem.id == "plugin_not_loaded:maps-browser").unwrap();
    assert!(not_loaded.detail.contains("Maps leads cannot run"));
}

#[test]
fn unset_plugin_settings_are_missing_credentials() {
    let mut fixture = Fixture::new();
    fixture.agent("Maps leads", PLUGIN_FLOW);
    let mut whatsapp = installed_plugin("whatsapp-api");
    whatsapp.config = vec![
        PluginConfigStatus { name: "WHATSAPP_TOKEN".into(), configured: false, optional: false },
        PluginConfigStatus { name: "WHATSAPP_PHONE_ID".into(), configured: true, optional: false },
        PluginConfigStatus { name: "WHATSAPP_GRAPH_VERSION".into(), configured: false, optional: true },
    ];
    fixture.plugins = vec![installed_plugin("maps-browser"), whatsapp];

    let problems = fixture.problems_of(ProblemKind::MissingCredentials);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].detail.contains("WhatsApp API setting WHATSAPP_TOKEN"));
    assert!(!problems[0].detail.contains("WHATSAPP_PHONE_ID"));
    // Optional tuning settings have defaults, so leaving them unset is not a problem.
    assert!(!problems[0].detail.contains("WHATSAPP_GRAPH_VERSION"));
    assert_eq!(action_kinds(&problems[0]), [ProblemActionKind::OpenPlugins]);
}

#[test]
fn browser_plugins_need_the_browser_runtime() {
    let mut fixture = Fixture::new();
    fixture.agent("Maps leads", PLUGIN_FLOW);
    let mut maps = installed_plugin("maps-browser");
    maps.needs_browser = true;
    fixture.plugins = vec![maps, installed_plugin("whatsapp-api")];
    assert!(fixture.problems_of(ProblemKind::BrowserMissing).is_empty(), "installed");

    fixture.browser_status = BrowserRuntimeStatus::NotInstalled;
    let problems = fixture.problems_of(ProblemKind::BrowserMissing);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].detail.starts_with("Maps leads open web pages"));
    assert_eq!(action_kinds(&problems[0]), [ProblemActionKind::InstallBrowser, ProblemActionKind::OpenPlugins]);
}

fn schedule(fixture: &Fixture, agent: &Agent, cron_expression: &str) -> Trigger {
    let new_trigger = NewTrigger {
        agent_id: agent.id.clone(),
        cron_expression: cron_expression.into(),
        timezone: "Asia/Jakarta".into(),
        missed_run_policy: MissedRunPolicy::RunOnce,
        inputs: json!({"question": "From the schedule"}),
    };
    fixture.db.create_trigger(new_trigger, None).unwrap()
}

#[test]
fn unreadable_schedules_are_reported() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let trigger = schedule(&fixture, &agent, "every morning");
    let problems = fixture.problems_of(ProblemKind::ScheduleInvalid);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].id, format!("schedule_invalid:{}", trigger.id));
    assert_eq!(problems[0].title, "The schedule of Answers cannot be read");
    assert_eq!(action_kinds(&problems[0]), [ProblemActionKind::OpenSchedule]);

    fixture.db.set_trigger_enabled(&trigger.id, false, None).unwrap();
    assert!(fixture.problems_of(ProblemKind::ScheduleInvalid).is_empty(), "disabled schedules never run");
}

#[test]
fn schedules_whose_last_three_runs_failed_are_reported() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    schedule(&fixture, &agent, "0 0 9 * * *");
    for _ in 0..2 {
        fixture.finished_run(&agent, RunTrigger::Schedule, RunStatus::Failed, &[]);
    }
    assert!(fixture.problems_of(ProblemKind::ScheduleFailing).is_empty(), "two failures are not a pattern yet");

    fixture.finished_run(&agent, RunTrigger::Schedule, RunStatus::Failed, &[]);
    let problems = fixture.problems_of(ProblemKind::ScheduleFailing);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].title, "Answers keeps failing on schedule");
}

#[test]
fn retry_inputs_come_from_the_start_step() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let run = fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Failed, &timed_out_events());
    assert_eq!(retry::inputs_for_retry(&fixture.db, &run).unwrap(), json!({"question": "Why?"}));
}

#[test]
fn retry_inputs_fall_back_to_the_schedule_then_refuse() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Answers", SIMPLE_ANSWER);
    let manual = fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Failed, &[]);
    let error = retry::inputs_for_retry(&fixture.db, &manual).unwrap_err();
    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("no longer stored")));
    let report = failed_run_report(&fixture.db, &manual.id).unwrap();
    assert!(!report.retry.can_retry);
    assert!(report.retry.reason.unwrap().starts_with("the details this run started with"));

    schedule(&fixture, &agent, "0 0 9 * * *");
    let scheduled = fixture.finished_run(&agent, RunTrigger::Schedule, RunStatus::Failed, &[]);
    assert_eq!(retry::inputs_for_retry(&fixture.db, &scheduled).unwrap(), json!({"question": "From the schedule"}));
}

#[test]
fn retry_without_required_inputs_uses_none_and_open_runs_are_refused() {
    let fixture = Fixture::new();
    let agent = fixture.agent("Weather", SECRET_FLOW);
    let run = fixture.finished_run(&agent, RunTrigger::Manual, RunStatus::Failed, &[]);
    assert_eq!(retry::inputs_for_retry(&fixture.db, &run).unwrap(), json!({}));

    let running = fixture.db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
    assert!(matches!(retry::inputs_for_retry(&fixture.db, &running), Err(AppError::InvalidInput(_))));
}

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

async fn wait_until_finished(db: &Database, run_id: &str) -> Run {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let run = db.get_run(run_id).unwrap();
        if !matches!(run.status, RunStatus::Running | RunStatus::Paused) {
            return run;
        }
        assert!(tokio::time::Instant::now() < deadline, "run {run_id} never finished");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn retry_starts_a_new_run_with_the_same_inputs() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(vec![MockModel::text("First."), MockModel::text("Second.")]));
    let runs = RunManager::new(db.clone(), credentials, Arc::new(CollectingSink::default()))
        .with_model_registry_source(Arc::new(FixedModelSource { model }));
    let agent = db
        .create_agent(NewAgent {
            name: "Answers".into(),
            kind: AgentKind::Task,
            description: "test".into(),
            flow_yaml: SIMPLE_ANSWER.into(),
        })
        .unwrap();
    let first = runs.start_run(&agent.id, RunTrigger::Schedule, json!({"question": "What is Rust?"})).await.unwrap();
    wait_until_finished(&db, &first.id).await;

    let retried = retry::retry_run(&db, &runs, &first.id).await.unwrap();
    assert_ne!(retried.id, first.id);
    assert_eq!(retried.trigger, RunTrigger::Manual);
    let finished = wait_until_finished(&db, &retried.id).await;
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(retry::inputs_for_retry(&db, &finished).unwrap(), json!({"question": "What is Rust?"}));
}
