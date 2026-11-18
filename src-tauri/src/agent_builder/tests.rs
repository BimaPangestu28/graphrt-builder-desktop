use std::sync::Mutex;

use graphrt_llm::mock::MockModel;
use graphrt_llm::Role;

use super::*;

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
const INVALID_REFERENCE: &str = include_str!("../../fixtures/flows/invalid_reference.yaml");

const CAFE_REQUEST: &str = "Find cafes in Bandar Lampung on Google Maps, get their name and phone number, \
then send each one a WhatsApp message offering our catering menu";

/// Records progress updates in order.
#[derive(Default)]
struct ProgressLog(Mutex<Vec<BuildProgress>>);

impl ProgressLog {
    fn stages(&self) -> Vec<BuildStage> {
        self.0.lock().unwrap().iter().map(|progress| progress.stage).collect()
    }

    fn record(&self, progress: BuildProgress) {
        self.0.lock().unwrap().push(progress);
    }
}

fn fenced_reply(name: &str, yaml: &str) -> String {
    format!("Agent name: {name}\n```yaml\n{yaml}```\n")
}

/// Builder backed by a mock replaying `replies`; the mock is returned to inspect requests.
fn mock_builder(replies: &[String]) -> (Arc<MockModel>, BuilderModel) {
    let mock = Arc::new(MockModel::new(replies.iter().map(|reply| MockModel::text(reply)).collect()));
    let builder = BuilderModel {
        model: mock.clone(),
        choice: ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() },
        available_providers: vec!["openai".into(), "anthropic".into()],
    };
    (mock, builder)
}

fn test_database() -> Database {
    Database::open_in_memory().unwrap()
}

fn request(description: &str, kind: Option<AgentKind>) -> BuildRequest {
    BuildRequest { description: description.into(), kind }
}

fn message_text(request: &ChatRequest, index: usize) -> String {
    request.messages[index].text()
}

#[tokio::test]
async fn valid_first_draft_is_saved_with_name_kind_and_progress() {
    let db = test_database();
    let (mock, builder) = mock_builder(&[fenced_reply("Cafe WhatsApp offers", APPROVAL_LOOP)]);
    let progress = ProgressLog::default();

    let agent = build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|update| progress.record(update))
        .await
        .unwrap();

    assert_eq!(agent.name, "Cafe WhatsApp offers");
    assert_eq!(agent.kind, AgentKind::Task);
    assert_eq!(agent.description, CAFE_REQUEST);
    assert_eq!(agent.flow_yaml.trim(), APPROVAL_LOOP.trim());
    assert_eq!(db.get_agent(&agent.id).unwrap(), agent);
    assert_eq!(
        progress.stages(),
        vec![BuildStage::Understanding, BuildStage::Drafting, BuildStage::Checking, BuildStage::Done]
    );

    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].model, "gpt-4o-mini");
    assert_eq!(requests[0].messages[0].role, Role::System);
    let system_prompt = message_text(&requests[0], 0);
    assert!(system_prompt.contains("provider: openai, name: gpt-4o-mini"), "{system_prompt}");
    assert!(system_prompt.contains(flow::workflow_format_guide().trim()));
    assert!(system_prompt.contains("human-input"));
    assert!(system_prompt.contains("cafe-whatsapp-offers"), "fixture example missing");
    let user_prompt = message_text(&requests[0], 1);
    assert!(user_prompt.contains(CAFE_REQUEST));
    assert!(user_prompt.contains("Kind: task"));
}

#[tokio::test]
async fn chosen_kind_is_kept_and_name_falls_back_to_document_name() {
    let db = test_database();
    let unnamed_reply = format!("```yaml\n{SIMPLE_ANSWER}```");
    let (mock, builder) = mock_builder(&[unnamed_reply]);

    let agent = build_agent_with_model(
        &db,
        &builder,
        request("Answer my questions about our menu", Some(AgentKind::Chatbot)),
        &|_| {},
    )
    .await
    .unwrap();

    assert_eq!(agent.kind, AgentKind::Chatbot);
    assert_eq!(agent.name, "Simple answer");
    assert!(message_text(&mock.requests()[0], 1).contains("Kind: chatbot"));
}

#[tokio::test]
async fn invalid_draft_is_repaired_with_graphrt_error() {
    let db = test_database();
    let (mock, builder) =
        mock_builder(&[fenced_reply("Broken", INVALID_REFERENCE), fenced_reply("Quick answers", SIMPLE_ANSWER)]);
    let progress = ProgressLog::default();

    let agent =
        build_agent_with_model(&db, &builder, request("Answer a question", None), &|update| progress.record(update))
            .await
            .unwrap();

    assert_eq!(agent.name, "Quick answers");
    assert_eq!(
        progress.stages(),
        vec![
            BuildStage::Understanding,
            BuildStage::Drafting,
            BuildStage::Checking,
            BuildStage::Repairing,
            BuildStage::Checking,
            BuildStage::Done,
        ]
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    let repair_messages = &requests[1].messages;
    assert_eq!(repair_messages.len(), 4);
    assert_eq!(repair_messages[2].role, Role::Assistant);
    assert!(repair_messages[2].text().contains("invalid-reference"), "the broken document is sent back");
    assert_eq!(repair_messages[3].role, Role::User);
    let repair_text = repair_messages[3].text();
    let graphrt_error = match flow::compile_flow(INVALID_REFERENCE) {
        Err(AppError::Workflow(message)) => message,
        other => panic!("expected a workflow error, got {other:?}"),
    };
    assert!(repair_text.contains(&graphrt_error), "{repair_text}");
}

#[tokio::test]
async fn still_invalid_after_max_attempts_fails_and_saves_nothing() {
    let db = test_database();
    let replies: Vec<String> = (0..=MAX_REPAIR_ATTEMPTS).map(|_| fenced_reply("Broken", INVALID_REFERENCE)).collect();
    let (mock, builder) = mock_builder(&replies);
    let progress = ProgressLog::default();

    let result =
        build_agent_with_model(&db, &builder, request("Summarize a topic", None), &|update| progress.record(update))
            .await;

    match result {
        Err(AppError::Workflow(message)) => assert!(message.contains("search"), "{message}"),
        other => panic!("expected a workflow error, got {other:?}"),
    }
    assert!(db.list_agents().unwrap().is_empty());
    assert_eq!(mock.requests().len(), MAX_REPAIR_ATTEMPTS + 1);
    let stages = progress.stages();
    assert_eq!(stages.iter().filter(|stage| **stage == BuildStage::Repairing).count(), MAX_REPAIR_ATTEMPTS);
    assert!(!stages.contains(&BuildStage::Done));
}

#[tokio::test]
async fn unavailable_model_provider_is_sent_back_for_repair() {
    let db = test_database();
    let (mock, mut builder) =
        mock_builder(&[fenced_reply("Cafe offers", APPROVAL_LOOP), fenced_reply("Quick answers", SIMPLE_ANSWER)]);
    builder.available_providers = vec!["openai".into()];

    let agent = build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|_| {}).await.unwrap();

    assert_eq!(agent.name, "Quick answers");
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("anthropic"), "{repair_text}");
    assert!(repair_text.contains("gpt-4o-mini"), "{repair_text}");
}

#[tokio::test]
async fn reply_without_document_is_repaired() {
    let db = test_database();
    let (_mock, builder) =
        mock_builder(&["Sorry, I cannot help.".to_owned(), fenced_reply("Quick answers", SIMPLE_ANSWER)]);
    let agent = build_agent_with_model(&db, &builder, request("Answer a question", None), &|_| {}).await.unwrap();
    assert_eq!(agent.name, "Quick answers");
}

#[tokio::test]
async fn model_failure_is_a_model_error() {
    let db = test_database();
    let (mock, builder) = mock_builder(&[]);
    mock.push_error(LlmError::Config("boom".into()));
    let result = build_agent_with_model(&db, &builder, request("Answer a question", None), &|_| {}).await;
    assert!(matches!(result, Err(AppError::Model(_))), "{result:?}");
    assert!(db.list_agents().unwrap().is_empty());
}

#[tokio::test]
async fn blank_description_is_rejected() {
    let (mock, builder) = mock_builder(&[]);
    let result = build_agent_with_model(&test_database(), &builder, request("   ", None), &|_| {}).await;
    assert!(matches!(result, Err(AppError::InvalidInput(_))));
    assert!(mock.requests().is_empty());
}

/// Approval-loop fixture with a title added to `draft_message` and the send step renamed.
fn revised_approval_loop() -> String {
    let revised = APPROVAL_LOOP
        .replace(
            "    - id: draft_message\n      type: llm\n",
            "    - id: draft_message\n      type: llm\n      title: Write a short message\n",
        )
        .replace("title: Send the WhatsApp message", "title: Send WhatsApp");
    assert_ne!(revised, APPROVAL_LOOP, "fixture edit did not apply");
    revised
}

fn create_cafe_agent(db: &Database) -> Agent {
    db.create_agent(NewAgent {
        name: "Cafe offers".into(),
        kind: AgentKind::Task,
        description: CAFE_REQUEST.into(),
        flow_yaml: APPROVAL_LOOP.into(),
    })
    .unwrap()
}

#[tokio::test]
async fn revision_saves_new_version_with_changed_steps() {
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let (mock, builder) = mock_builder(&[format!("```yaml\n{}```", revised_approval_loop())]);
    let progress = ProgressLog::default();

    let result = revise_agent_with_model(&db, &builder, &agent.id, "Make the messages shorter", &|update| {
        progress.record(update)
    })
    .await
    .unwrap();

    assert_eq!(result.changed_step_ids, vec!["draft_message", "send_message"]);
    assert_eq!(result.summary, "Changed 2 steps: Write a short message, Send WhatsApp");
    assert_eq!(result.agent.current_version, 2);
    assert_eq!(result.agent.name, "Cafe offers");
    assert!(result.agent.flow_yaml.contains("title: Send WhatsApp"));
    let versions = db.list_agent_versions(&agent.id).unwrap();
    let newest = versions.iter().find(|version| version.version == 2).unwrap();
    assert_eq!(newest.change_summary, result.summary);
    assert_eq!(
        progress.stages(),
        vec![BuildStage::Understanding, BuildStage::Drafting, BuildStage::Checking, BuildStage::Done]
    );

    let user_prompt = message_text(&mock.requests()[0], 1);
    assert!(user_prompt.contains("Make the messages shorter"));
    assert!(user_prompt.contains("id: approve_message"), "current document is sent");
}

#[tokio::test]
async fn identical_revision_is_rejected() {
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let (_mock, builder) = mock_builder(&[format!("Here you go:\n```yaml\n{APPROVAL_LOOP}\n\n```")]);

    let result = revise_agent_with_model(&db, &builder, &agent.id, "Make it better", &|_| {}).await;

    match result {
        Err(AppError::InvalidInput(message)) => assert_eq!(message, "No changes were needed"),
        other => panic!("expected InvalidInput, got {other:?}"),
    }
    assert_eq!(db.get_agent(&agent.id).unwrap().current_version, 1);
}

#[tokio::test]
async fn revision_of_missing_agent_is_not_found() {
    let (mock, builder) = mock_builder(&[]);
    let result = revise_agent_with_model(&test_database(), &builder, "missing", "Change it", &|_| {}).await;
    assert!(matches!(result, Err(AppError::NotFound(_))), "{result:?}");
    assert!(mock.requests().is_empty());
}

#[tokio::test]
async fn missing_credentials_are_reported() {
    let db = test_database();
    let credentials = CredentialStore::in_memory();

    let build_result = build_agent(&db, &credentials, request(CAFE_REQUEST, None), &|_| {}).await;
    assert!(matches!(build_result, Err(AppError::MissingCredentials(_))), "{build_result:?}");

    let agent = create_cafe_agent(&db);
    let revise_result = revise_agent(&db, &credentials, &agent.id, "Change it", &|_| {}).await;
    assert!(matches!(revise_result, Err(AppError::MissingCredentials(_))), "{revise_result:?}");
}
