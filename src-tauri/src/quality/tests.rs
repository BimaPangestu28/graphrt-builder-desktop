//! The whole pipeline on a scripted model: tests, a check scored by graphrt with the judge
//! workflows, the release rule, an override, a better version, the comparison and going back.

use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use graphrt_core::text_model::{TextModel, TextModelError, TextRequest};
use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ChatRequest, ChatStream, LlmError, ModelRegistry};

use super::release::{ReleaseBlock, ReleaseReadiness};
use super::view::{NotGoodReason, QuestionChange};
use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::ModelRegistrySource;
use crate::storage::models::NewAgent;
use crate::storage::Database;

/// The agent answers the opening hours; with `ALWAYS_HELPFUL` in its prompt it also says
/// it delivers. The judges pass a reply that contains the good answer's key word.
#[derive(Debug, Default)]
struct ShopModel {
    requests: Mutex<usize>,
}

fn text_of(request: &ChatRequest) -> String {
    request.messages.iter().map(|message| message.text()).collect::<Vec<_>>().join("\n")
}

fn section<'a>(text: &'a str, heading: &str) -> &'a str {
    text.split(heading).nth(1).unwrap_or_default()
}

impl ChatModel for ShopModel {
    fn chat(&self, request: ChatRequest) -> BoxFuture<'_, Result<ChatStream, LlmError>> {
        if let Ok(mut requests) = self.requests.lock() {
            *requests += 1;
        }
        let text = text_of(&request);
        let answer = if text.contains("You check one reply") {
            let reply = section(&text, "REPLY:").to_lowercase();
            let good = section(&text, "GOOD ANSWER (written by the owner):");
            let key_word = good.split_whitespace().next().unwrap_or("x").to_lowercase();
            if reply.contains(&key_word) {
                r#"{"reasoning":"The reply gives it.","verdict":"pass"}"#.to_owned()
            } else {
                r#"{"reasoning":"The reply does not say it.","verdict":"fail"}"#.to_owned()
            }
        } else if text.contains("ALWAYS_HELPFUL") {
            "We open at 9. Yes, we deliver.".to_owned()
        } else if text.contains("open") {
            "We open at 9.".to_owned()
        } else {
            "Sorry, I am not sure.".to_owned()
        };
        let scripted = MockModel::new(vec![MockModel::text(&answer)]);
        Box::pin(async move { scripted.chat(request).await })
    }
}

#[derive(Debug)]
struct FixedModelSource(Arc<ShopModel>);

impl ModelRegistrySource for FixedModelSource {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.0.clone()))
    }
}

#[derive(Debug)]
struct NoDraftModel;

impl DraftModelSource for NoDraftModel {
    fn text_model(&self) -> AppResult<Arc<dyn TextModel>> {
        Ok(Arc::new(ScriptedText))
    }
}

#[derive(Debug)]
struct ScriptedText;

impl TextModel for ScriptedText {
    fn complete(&self, _request: TextRequest) -> BoxFuture<'_, Result<String, TextModelError>> {
        Box::pin(async { Ok(r#"[{"question":"When do you open?","goodAnswer":"9 in the morning"}]"#.to_owned()) })
    }
}

#[derive(Debug, Default)]
struct Quiet(Mutex<Vec<CheckProgress>>);

impl CheckProgressSink for Quiet {
    fn send(&self, progress: CheckProgress) {
        if let Ok(mut sent) = self.0.lock() {
            sent.push(progress);
        }
    }
}

fn flow(prompt: &str) -> String {
    format!(
        r#"version: "1"
name: shop
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: question, type: paragraph, required: true }}
    - id: reply
      type: llm
      model: {{ provider: openai, name: gpt-4o-mini }}
      prompt_template:
        - {{ role: system, text: "{prompt}" }}
        - {{ role: user, text: "{{{{#start.question#}}}}" }}
    - id: end
      type: end
      outputs:
        - {{ variable: answer, value_selector: [reply, text] }}
  edges:
    - {{ source: start, target: reply }}
    - {{ source: reply, target: end }}
"#
    )
}

struct Harness {
    service: QualityService,
    db: Arc<Database>,
    agent_id: String,
    sink: Arc<Quiet>,
}

fn harness() -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let agent = db
        .create_agent(NewAgent {
            name: "Shop helper".into(),
            kind: AgentKind::Task,
            description: "Answers shop questions".into(),
            flow_yaml: flow("Answer briefly."),
        })
        .unwrap();
    let sink = Arc::new(Quiet::default());
    let dependencies = CheckDependencies {
        db: db.clone(),
        credentials,
        model_source: Arc::new(FixedModelSource(Arc::new(ShopModel::default()))),
        agent_files: None,
    };
    let service = QualityService::new(dependencies, Arc::new(NoDraftModel), sink.clone());
    Harness { service, db, agent_id: agent.id, sink }
}

fn test_of(question: &str, good_answer: &str) -> TestInput {
    TestInput { question: question.into(), good_answer: good_answer.into(), ..TestInput::default() }
}

#[tokio::test]
async fn a_check_gates_the_release_and_a_better_version_is_released_and_rolled_back() {
    let harness = harness();
    let id = harness.agent_id.as_str();
    assert!(matches!(
        harness.service.overview(id).unwrap().readiness,
        ReleaseReadiness::Blocked { block: ReleaseBlock::NoTests, can_override: true, .. }
    ));
    let mut deliver = test_of("Do you deliver?", "Yes we deliver");
    deliver.must_not_include = vec!["sorry".into()];
    harness.service.add_tests(id, vec![test_of("When do you open?", "9 in the morning"), deliver]).unwrap();
    assert_eq!(
        harness.service.overview(id).unwrap().readiness,
        ReleaseReadiness::Blocked { block: ReleaseBlock::NotChecked, can_override: true, check_id: None }
    );

    // Version 1: one of two answers is good, 80 % are needed.
    let first = harness.service.run_check_now(id).await.unwrap();
    assert_eq!((first.status, first.good, first.total, first.needed), (CheckStatus::Finished, 1, 2, 2));
    assert!(!first.enough_good);
    assert_eq!(first.previous, None);
    let opening = first.questions.iter().find(|question| question.question == "When do you open?").unwrap();
    assert!(opening.good);
    assert_eq!(opening.answer, "We open at 9.");
    assert_eq!(opening.good_because.as_deref(), Some("The reply gives it."));
    let delivery = first.questions.iter().find(|question| question.question == "Do you deliver?").unwrap();
    assert!(!delivery.good);
    assert!(delivery.not_good_because.contains(&NotGoodReason::Judge { text: "The reply does not say it.".into() }));
    assert!(delivery.not_good_because.contains(&NotGoodReason::UnwantedWords { words: vec!["sorry".into()] }));

    let blocked = harness.service.create_release(id, "First", None).unwrap_err();
    assert!(blocked.to_string().contains("Only 1 of 2 answers were good; 2 are needed"), "{blocked}");
    let forced = harness.service.create_release(id, "First", Some("Shop opens tomorrow".into())).unwrap();
    assert_eq!((forced.number, forced.passed, forced.total), (1, Some(1), Some(2)));
    assert_eq!(forced.override_reason.as_deref(), Some("Shop opens tomorrow"));

    // Version 2 answers both: ready, and the comparison shows what got better.
    harness.db.update_agent_flow(id, &flow("ALWAYS_HELPFUL"), "Says it delivers").unwrap();
    let second = harness.service.run_check_now(id).await.unwrap();
    assert_eq!((second.good, second.total), (2, 2));
    assert!(second.enough_good);
    assert_eq!(second.previous.as_ref().map(|previous| (previous.good, previous.agent_version)), Some((1, 1)));
    let delivery = second.questions.iter().find(|question| question.question == "Do you deliver?").unwrap();
    assert_eq!(delivery.change, Some(QuestionChange::NowGood));
    let release = harness.service.create_release(id, "Says it delivers", None).unwrap();
    assert_eq!((release.number, release.agent_version, release.override_reason), (2, 2, None));
    assert!(matches!(
        harness.service.overview(id).unwrap().readiness,
        ReleaseReadiness::Blocked { block: ReleaseBlock::AlreadyReleased { number: 2 }, can_override: false, .. }
    ));

    // Going back to release 1 makes it the one in use; the draft stays as it is.
    harness.service.switch_release(id, 1).unwrap();
    let overview = harness.service.overview(id).unwrap();
    assert_eq!(overview.in_use.map(|release| release.number), Some(1));
    assert_eq!(overview.current_version, 2);
    assert_eq!(harness.db.released_agent(id).unwrap().current_version, 1);
    assert!(harness.service.switch_release(id, 1).is_err(), "already in use");

    let finished = harness.sink.0.lock().unwrap().iter().filter(|progress| progress.finished).count();
    assert_eq!(finished, 2);
}

#[tokio::test]
async fn changing_a_test_after_a_check_asks_for_a_new_check() {
    let harness = harness();
    let id = harness.agent_id.as_str();
    let tests = harness.service.add_tests(id, vec![test_of("When do you open?", "9 in the morning")]).unwrap();
    harness.service.run_check_now(id).await.unwrap();
    assert!(matches!(
        harness.service.overview(id).unwrap().readiness,
        ReleaseReadiness::Ready { good: 1, total: 1, .. }
    ));
    harness.service.update_test(id, &tests[0].id, test_of("When do you close?", "5 in the afternoon")).unwrap();
    let overview = harness.service.overview(id).unwrap();
    assert!(matches!(overview.readiness, ReleaseReadiness::Blocked { block: ReleaseBlock::TestsChanged, .. }));
    assert!(overview.latest_check.is_some_and(|check| check.tests_changed_since));
}

#[tokio::test]
async fn a_stricter_setting_and_suggestions() {
    let harness = harness();
    let id = harness.agent_id.as_str();
    assert!(harness.service.set_settings(id, QualitySettings { required_percent: 101, times_each: 1 }).is_err());
    assert!(harness.service.set_settings(id, QualitySettings { required_percent: 50, times_each: 0 }).is_err());
    let settings = harness.service.set_settings(id, QualitySettings { required_percent: 50, times_each: 1 }).unwrap();
    assert_eq!(harness.service.settings(id).unwrap(), settings);
    harness.service.add_tests(id, vec![test_of("When do you open?", "9"), test_of("Do you deliver?", "Yes")]).unwrap();
    harness.service.run_check_now(id).await.unwrap();
    assert!(matches!(
        harness.service.overview(id).unwrap().readiness,
        ReleaseReadiness::Ready { good: 1, total: 2, .. }
    ));

    let suggested = harness.service.suggest_tests(id).await.unwrap();
    assert_eq!(suggested[0].question, "When do you open?");
}

#[tokio::test]
async fn a_check_without_tests_or_while_one_runs_is_refused() {
    let harness = harness();
    let id = harness.agent_id.as_str();
    assert!(matches!(harness.service.start_check(id), Err(AppError::InvalidInput(_))));
    harness.service.running.lock().unwrap().insert(id.to_owned());
    harness.service.add_tests(id, vec![test_of("When do you open?", "9")]).unwrap();
    assert!(matches!(harness.service.start_check(id), Err(AppError::Conflict(_))));
}

#[test]
fn checks_left_running_by_a_closed_app_are_marked_not_finished() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let agent = db
        .create_agent(NewAgent {
            name: "A".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: flow("x"),
        })
        .unwrap();
    let check = db.start_check(&agent.id, 1, "f", 1, 80).unwrap();
    let dependencies = CheckDependencies {
        db: db.clone(),
        credentials: Arc::new(CredentialStore::in_memory()),
        model_source: Arc::new(FixedModelSource(Arc::new(ShopModel::default()))),
        agent_files: None,
    };
    let _service = QualityService::new(dependencies, Arc::new(NoDraftModel), Arc::new(Quiet::default()));
    let stored = db.get_check(&agent.id, &check.id).unwrap();
    assert_eq!((stored.status, stored.error_message.as_deref()), (CheckStatus::Failed, Some(APP_CLOSED_MESSAGE)));
}
