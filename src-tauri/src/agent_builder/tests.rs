use std::sync::Mutex;

use graphrt_llm::mock::MockModel;
use graphrt_llm::Role;

use super::*;

static NO_TRUSTED_HOSTS: TrustedHosts = TrustedHosts::none();

/// A draft of an agent that trusts no hosts and whose reply proposes none.
fn no_trust() -> DraftTrust<'static> {
    DraftTrust { trusted_hosts: &NO_TRUSTED_HOSTS, proposed_hosts: &[] }
}

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
const INVALID_REFERENCE: &str = include_str!("../../fixtures/flows/invalid_reference.yaml");

const CAFE_REQUEST: &str = "Find cafes in Bandar Lampung on Google Maps, get their name and phone number, \
then send each one a WhatsApp message offering our catering menu";

/// Records progress updates in order.
#[derive(Default)]
struct ProgressLog(Mutex<Vec<BuildProgress>>);

impl ProgressLog {
    /// Stage changes in order; draft previews repeat their stage, so repeats collapse.
    fn stages(&self) -> Vec<BuildStage> {
        let mut stages: Vec<BuildStage> = self.0.lock().unwrap().iter().map(|progress| progress.stage).collect();
        stages.dedup();
        stages
    }

    /// Draft previews in order.
    fn previews(&self) -> Vec<DraftPreview> {
        self.0.lock().unwrap().iter().filter_map(|progress| progress.draft.clone()).collect()
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

    assert_eq!(agent.name, "Cafe WhatsApp Offers");
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
async fn system_prompt_offers_saved_secret_names_but_never_values() {
    let db = test_database();
    let credentials = crate::credentials::CredentialStore::in_memory();
    let server_token = crate::workflow_secrets::saved::NewWorkflowSecret {
        name: "MY_SERVER_TOKEN".into(),
        value: "token-value-never-in-prompt".into(),
        note: None,
    };
    crate::workflow_secrets::saved::add_workflow_secret(&db, &credentials, server_token).unwrap();
    let (mock, builder) = mock_builder(&[fenced_reply("Simple answer", SIMPLE_ANSWER)]);

    build_agent_with_model(&db, &builder, request("Post to my server with my API token", None), &|_| {}).await.unwrap();

    let system_prompt = message_text(&mock.requests()[0], 0);
    assert!(system_prompt.contains("Secrets the user already saved in the app"), "{system_prompt}");
    assert!(system_prompt.contains("`MY_SERVER_TOKEN`"));
    assert!(system_prompt.contains("{{#env.MY_SERVER_TOKEN#}}"));
    assert!(!system_prompt.contains("token-value-never-in-prompt"));
}

#[test]
fn system_prompt_has_no_saved_secrets_section_without_saved_secrets() {
    let choice = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
    assert!(!prompt::build_system_prompt(&choice, &[]).contains("Secrets the user already saved"));
    let revision_prompt = prompt::revision_system_prompt(&choice, &["DB_PASSWORD".into()], &TrustedHosts::none());
    assert!(revision_prompt.contains("`DB_PASSWORD`"));
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
    assert_eq!(agent.name, "Simple Answer");
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

    assert_eq!(agent.name, "Quick Answers");
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

    assert_eq!(agent.name, "Quick Answers");
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("anthropic"), "{repair_text}");
    assert!(repair_text.contains("gpt-4o-mini"), "{repair_text}");
}

#[tokio::test]
async fn steps_a_local_cli_cannot_run_are_sent_back_for_repair() {
    let db = test_database();
    let cli_draft = SIMPLE_ANSWER.replace(
        "      model:\n        provider: openai\n        name: gpt-4o-mini\n",
        "      vision: { enabled: true }\n      model:\n        provider: claude-code-cli\n        name: default\n",
    );
    let (mock, mut builder) =
        mock_builder(&[fenced_reply("Quick answers", &cli_draft), fenced_reply("Quick answers", SIMPLE_ANSWER)]);
    builder.available_providers = vec!["openai".into(), "claude-code-cli".into()];
    builder.choice = ModelChoice { provider: ModelProvider::ClaudeCodeCli, name: "default".into() };

    build_agent_with_model(&db, &builder, request("Answer a question", None), &|_| {}).await.unwrap();

    let system_prompt = mock.requests()[0].messages[0].text();
    assert!(system_prompt.contains("cannot call tools and cannot read images"), "the builder is told up front");
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("can't read images"), "{repair_text}");
}

#[tokio::test]
async fn reply_without_document_is_repaired() {
    let db = test_database();
    let (_mock, builder) =
        mock_builder(&["Sorry, I cannot help.".to_owned(), fenced_reply("Quick answers", SIMPLE_ANSWER)]);
    let agent = build_agent_with_model(&db, &builder, request("Answer a question", None), &|_| {}).await.unwrap();
    assert_eq!(agent.name, "Quick Answers");
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

/// Like the cafe fixture but the message is sent without asking first.
fn approval_loop_without_approval() -> String {
    flow::test_fixtures::without_search_confirmation(APPROVAL_LOOP)
        .replace("    - { source: draft_message, target: approve_message }\n", "    - { source: draft_message, target: send_message }\n")
        .replace("    - { source: approve_message, target: send_message, handle: send }\n", "")
        .replace(
            "    - id: approve_message\n      type: human-input\n      parent: each_cafe\n      prompt: \"Send this message to {{#each_cafe.item.name#}}?\\n\\n{{#draft_message.text#}}\"\n      form:\n        fields:\n          - { name: note, label: Note, type: text, required: false }\n      actions:\n        - { id: send, title: Send }\n        - { id: skip, title: Skip }\n\n",
            "",
        )
}

#[tokio::test]
async fn draft_that_sends_without_approval_is_sent_back_for_repair() {
    let unapproved_draft = approval_loop_without_approval();
    assert!(!unapproved_draft.contains("human-input"), "fixture text changed; update this test");
    let db = test_database();
    let (mock, builder) =
        mock_builder(&[fenced_reply("Cafe offers", &unapproved_draft), fenced_reply("Cafe offers", APPROVAL_LOOP)]);
    let progress = ProgressLog::default();

    let agent = build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|update| progress.record(update))
        .await
        .unwrap();

    assert_eq!(agent.flow_yaml.trim(), APPROVAL_LOOP.trim());
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("Send the WhatsApp message"), "{repair_text}");
    assert!(repair_text.contains("human-input"), "{repair_text}");
    assert!(progress.stages().contains(&BuildStage::Repairing));
}

#[test]
fn system_prompt_includes_the_chatbot_guide() {
    let choice = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
    for system_prompt in
        [prompt::build_system_prompt(&choice, &[]), prompt::revision_system_prompt(&choice, &[], &TrustedHosts::none())]
    {
        assert!(system_prompt.contains("`handoff_reason`"), "{system_prompt}");
        assert!(system_prompt.contains("{{#conversation.notes#}}"));
    }
}

#[tokio::test]
async fn system_prompt_lists_installed_plugin_steps() {
    let fixture = crate::plugins::tests::installed_fixture().await;
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    fixture.service.activate();
    let choice = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
    let with_plugin = prompt::build_system_prompt(&choice, &[]);
    crate::plugins::active::publish(None);
    crate::plugins::active::publish_catalog(None);
    let without_plugin = prompt::build_system_prompt(&choice, &[]);

    assert!(with_plugin.contains("`fixture-echo.echo` (Echo text)"), "{with_plugin}");
    assert!(with_plugin.contains("instead of a raw `http-request`"));
    assert!(!without_plugin.contains("fixture-echo"));
}

#[tokio::test]
async fn drafting_streams_the_explanation_and_step_titles() {
    let db = test_database();
    let reply =
        format!("I find cafes and ask you before each message.\n{}", fenced_reply("Cafe offers", APPROVAL_LOOP));
    let (_mock, builder) = mock_builder(&[reply]);
    let progress = ProgressLog::default();

    build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|update| progress.record(update))
        .await
        .unwrap();

    let previews = progress.previews();
    let last = previews.last().expect("at least one draft preview");
    assert_eq!(last.explanation, "I find cafes and ask you before each message.");
    assert_eq!(
        last.step_titles,
        [
            "Ask before searching",
            "Find cafes on Google Maps",
            "For each cafe",
            "Send the WhatsApp message",
            "Write the run report"
        ]
    );
    assert!(last.output_tokens > 0);
    // Previews belong to the drafting stage; stage-only messages carry none.
    let logged = progress.0.lock().unwrap();
    assert!(logged.iter().filter(|update| update.draft.is_some()).all(|update| update.stage == BuildStage::Drafting));
    assert!(logged.iter().any(|update| update.stage == BuildStage::Done && update.draft.is_none()));
}

#[tokio::test]
async fn a_revision_returns_the_models_explanation() {
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let reply =
        format!("I shortened the message and renamed the send step.\n```yaml\n{}```\n", revised_approval_loop());
    let (_mock, builder) = mock_builder(&[reply]);

    let result = revise_agent_with_model(&db, &builder, &agent.id, "Make the message shorter", &|_| {}).await.unwrap();

    assert_eq!(result.explanation, "I shortened the message and renamed the send step.");
}

#[tokio::test]
async fn the_name_line_is_not_part_of_the_explanation() {
    let db = test_database();
    let (_mock, builder) = mock_builder(&[fenced_reply("Cafe offers", APPROVAL_LOOP)]);
    let progress = ProgressLog::default();

    let agent = build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|update| progress.record(update))
        .await
        .unwrap();

    assert_eq!(agent.name, "Cafe Offers");
    assert_eq!(progress.previews().last().unwrap().explanation, "");
}

#[tokio::test]
async fn a_draft_calling_a_placeholder_address_is_sent_back_for_repair() {
    let placeholder_draft = APPROVAL_LOOP.replace(
        "https://graph.facebook.com/v21.0/{{#env.WHATSAPP_PHONE_NUMBER_ID#}}/messages",
        "https://api.example.com/send-promotion",
    );
    assert_ne!(placeholder_draft, APPROVAL_LOOP, "fixture URL changed; update this test");
    let db = test_database();
    let (mock, builder) =
        mock_builder(&[fenced_reply("Cafe offers", &placeholder_draft), fenced_reply("Cafe offers", APPROVAL_LOOP)]);

    let agent = build_agent_with_model(&db, &builder, request(CAFE_REQUEST, None), &|_| {}).await.unwrap();

    assert_eq!(agent.flow_yaml.trim(), APPROVAL_LOOP.trim());
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("api.example.com"), "{repair_text}");
    assert!(repair_text.contains("placeholder"), "{repair_text}");
}

/// Approval, then a step of the catalog-only `fixture-mail` plugin.
const CATALOG_PLUGIN_DRAFT: &str = r#"version: "1"
name: mail-offer
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: email, type: text-input, required: true }
    - id: approve
      type: human-input
      prompt: "Send the offer to {{#start.email#}}?"
      actions:
        - { id: send, title: Send }
        - { id: skip, title: Skip }
    - id: send_offer
      type: fixture-mail.send_mail
      title: Send the offer
      to: "{{#start.email#}}"
      body: Our catering menu
    - id: end
      type: end
      outputs:
        - { variable: result, value_selector: [send_offer, data] }
  edges:
    - { source: start, target: approve }
    - { source: approve, target: send_offer, handle: send }
    - { source: send_offer, target: end }
"#;

#[tokio::test]
async fn drafts_may_use_catalog_plugins_that_are_not_installed() {
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::not_installed_catalog())));
    let choice = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
    let system_prompt = prompt::build_system_prompt(&choice, &[]);
    let unknown_kind = CATALOG_PLUGIN_DRAFT.replace("fixture-mail.send_mail", "fixture-mail.format_disk");
    let db = test_database();
    let (mock, builder) =
        mock_builder(&[fenced_reply("Mail offer", &unknown_kind), fenced_reply("Mail offer", CATALOG_PLUGIN_DRAFT)]);
    let progress = ProgressLog::default();

    let built =
        build_agent_with_model(&db, &builder, request("Email an offer", None), &|update| progress.record(update)).await;
    crate::plugins::active::publish_catalog(None);

    assert!(system_prompt.contains("Plugin `fixture-mail` (not installed yet)"), "{system_prompt}");
    assert!(system_prompt.contains("installed or not"));
    let agent = built.unwrap();
    assert_eq!(agent.flow_yaml.trim(), CATALOG_PLUGIN_DRAFT.trim());
    let repair_text = mock.requests()[1].messages[3].text();
    assert!(repair_text.contains("fixture-mail.format_disk"), "{repair_text}");
    let done = progress.0.lock().unwrap().last().cloned().unwrap();
    assert_eq!(done.stage, BuildStage::Done);
    assert_eq!(done.message, "Your agent is ready · needs 1 plugin");
}

#[tokio::test]
async fn a_catalog_plugin_step_missing_a_required_field_is_sent_back() {
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::not_installed_catalog())));
    let without_body = CATALOG_PLUGIN_DRAFT.replace("      body: Our catering menu\n", "");
    let (_, builder) = mock_builder(&[]);

    let problem = validate_draft(&without_body, &builder, &no_trust());
    let accepted = validate_draft(CATALOG_PLUGIN_DRAFT, &builder, &no_trust());
    crate::plugins::active::publish_catalog(None);

    assert!(problem.unwrap_err().contains("`body`"));
    assert!(accepted.is_ok());
}

/// [`revise_agent_from_chat`] with an explicit model.
async fn revise_from_chat(
    db: &Database,
    builder: &BuilderModel,
    agent_id: &str,
    instruction: &str,
) -> AppResult<RevisionResult> {
    let revision = revise_agent_with_model(db, builder, agent_id, instruction, &|_| {});
    stoppable_revision_with_history(db, agent_id, instruction, revision).await
}

/// A model whose reply never arrives, like a slow provider; counts the calls it got.
#[derive(Debug, Default)]
struct StalledModel {
    calls: std::sync::atomic::AtomicUsize,
}

impl ChatModel for StalledModel {
    fn chat(&self, _request: ChatRequest) -> futures::future::BoxFuture<'_, Result<graphrt_llm::ChatStream, LlmError>> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}

#[tokio::test]
async fn stopping_a_chat_revision_releases_the_agent_and_notes_it_in_the_chat() {
    use crate::storage::models::{BuilderMessageStatus, STOPPED_REPLY_TEXT};
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let model = Arc::new(StalledModel::default());
    let builder = BuilderModel {
        model: model.clone(),
        choice: ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() },
        available_providers: vec!["openai".into()],
    };
    let stop_while_drafting = async {
        // Wait until the revision holds the edit lock and has asked the model.
        while model.calls.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        assert!(edit_lock::is_builder_editing(&agent.id), "the Nodes view waits while the builder works");
        assert!(stop::stop_revisions(&agent.id));
    };

    let (outcome, ()) =
        tokio::join!(revise_from_chat(&db, &builder, &agent.id, "Make it friendlier"), stop_while_drafting);

    assert!(matches!(outcome, Err(AppError::Stopped)));
    assert!(!edit_lock::is_builder_editing(&agent.id), "stopping releases the edit lock");
    let messages = db.list_builder_messages(&agent.id).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].text, "Make it friendlier");
    assert_eq!(messages[1].text, STOPPED_REPLY_TEXT);
    assert_eq!(messages[1].status, BuilderMessageStatus::Done);
    assert_eq!((messages[1].version_before, messages[1].version_after), (Some(1), None));
    assert_eq!(db.get_agent(&agent.id).unwrap().current_version, 1, "nothing was saved");
}

#[tokio::test]
async fn a_chat_revision_saves_the_request_and_the_builders_reply() {
    use crate::storage::models::{BuilderMessageRole, BuilderMessageStatus};
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let reply = format!("I shortened the message.\n```yaml\n{}```\n", revised_approval_loop());
    let (_mock, builder) = mock_builder(&[reply]);

    let result = revise_from_chat(&db, &builder, &agent.id, "  Make the messages shorter ").await.unwrap();

    let messages = db.list_builder_messages(&agent.id).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, BuilderMessageRole::User);
    assert_eq!(messages[0].text, "Make the messages shorter");
    assert_eq!(messages[0].version_before, Some(1));
    assert_eq!(messages[1].role, BuilderMessageRole::Builder);
    assert_eq!(messages[1].status, BuilderMessageStatus::Done);
    assert_eq!(messages[1].text, result.summary);
    assert_eq!(messages[1].explanation.as_deref(), Some("I shortened the message."));
    assert_eq!(messages[1].changed_step_ids, result.changed_step_ids);
    assert_eq!((messages[1].version_before, messages[1].version_after), (Some(1), Some(2)));
}

#[tokio::test]
async fn a_failed_chat_revision_saves_the_request_and_the_error() {
    use crate::storage::models::BuilderMessageStatus;
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let (mock, builder) = mock_builder(&[]);
    mock.push_error(LlmError::Config("offline".into()));

    let result = revise_from_chat(&db, &builder, &agent.id, "Make it friendlier").await;

    let error = result.unwrap_err();
    let messages = db.list_builder_messages(&agent.id).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].text, "Make it friendlier");
    assert_eq!(messages[1].status, BuilderMessageStatus::Failed);
    assert_eq!(messages[1].text, error.to_string());
    assert_eq!((messages[1].version_before, messages[1].version_after), (Some(1), None));
    assert_eq!(db.get_agent(&agent.id).unwrap().current_version, 1);
}

#[tokio::test]
async fn revisions_outside_the_chat_save_no_messages() {
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let (_mock, builder) = mock_builder(&[format!("```yaml\n{}```", revised_approval_loop())]);

    revise_agent_with_model(&db, &builder, &agent.id, "Add a step", &|_| {}).await.unwrap();

    assert!(db.list_builder_messages(&agent.id).unwrap().is_empty());
}

#[tokio::test]
async fn a_build_saves_the_builders_explanation() {
    let db = test_database();
    let reply = format!("This agent answers questions.\n{}", fenced_reply("Quick answers", SIMPLE_ANSWER));
    let (_mock, builder) = mock_builder(&[reply]);

    let agent = build_agent_with_model(&db, &builder, request("Answer a question", None), &|_| {}).await.unwrap();

    let messages = db.list_builder_messages(&agent.id).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].text, history::BUILD_REPLY_TEXT);
    assert_eq!(messages[0].explanation.as_deref(), Some("This agent answers questions."));
    assert_eq!((messages[0].version_before, messages[0].version_after), (None, Some(1)));
}

#[test]
fn a_restore_that_adds_a_version_is_noted_in_the_chat() {
    let db = test_database();
    let agent = create_cafe_agent(&db);
    let revised = db.update_agent_flow(&agent.id, &revised_approval_loop(), "Changed").unwrap();

    let restored = db.restore_agent_version(&agent.id, 1).unwrap();
    history::record_restore(&db, &revised, &restored, 1);
    let unchanged = db.restore_agent_version(&agent.id, 1).unwrap();
    history::record_restore(&db, &restored, &unchanged, 1);

    let messages = db.list_builder_messages(&agent.id).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].text, "Restored version 1");
    assert_eq!((messages[0].version_before, messages[0].version_after), (Some(2), Some(3)));
}

/// What the builder should reply for the "Find businesses on Maps and message them on
/// WhatsApp" template: plugin steps from the real catalog, an approval before each send.
const MAPS_WHATSAPP_OUTREACH: &str = include_str!("../../fixtures/flows/maps_whatsapp_outreach.yaml");

/// The template's prompt, from the same file the New agent screen reads.
fn maps_whatsapp_template_prompt() -> String {
    let template: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/pages/new-agent/mapsWhatsAppTemplate.json")).unwrap();
    template["prompt"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn the_maps_whatsapp_template_builds_with_the_real_plugin_kinds() {
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::maps_whatsapp_catalog())));
    let template_prompt = maps_whatsapp_template_prompt();
    let db = test_database();
    let reply = format!(
        "I search Google Maps and ask you before every WhatsApp message.\n{}",
        fenced_reply("Maps WhatsApp Outreach", MAPS_WHATSAPP_OUTREACH)
    );
    let (mock, builder) = mock_builder(&[reply]);
    let progress = ProgressLog::default();

    let built = build_agent_with_model(&db, &builder, request(&template_prompt, Some(AgentKind::Task)), &|update| {
        progress.record(update)
    })
    .await;
    let summary = validate_draft(MAPS_WHATSAPP_OUTREACH, &builder, &no_trust());
    let unapproved = flow::find_unapproved_sending_steps(MAPS_WHATSAPP_OUTREACH, &crate::flow::TrustedHosts::none());
    crate::plugins::active::publish_catalog(None);

    let agent = built.unwrap();
    assert_eq!(agent.flow_yaml.trim(), MAPS_WHATSAPP_OUTREACH.trim());
    assert_eq!(mock.requests().len(), 1, "the fixture is accepted without a repair round");
    let system_prompt = message_text(&mock.requests()[0], 0);
    assert!(system_prompt.contains("`google-maps-scraper.search`"), "{system_prompt}");
    assert!(system_prompt.contains("`whatsapp-web.send_message`"), "{system_prompt}");
    assert!(message_text(&mock.requests()[0], 1).contains(&template_prompt));
    let done = progress.0.lock().unwrap().last().cloned().unwrap();
    assert_eq!(done.message, "Your agent is ready · needs 2 plugins");

    let summary = summary.unwrap();
    let input_names: Vec<&str> = summary.inputs.iter().map(|input| input.name.as_str()).collect();
    assert_eq!(input_names, ["area", "business_type", "offer", "max_results"]);
    assert!(unapproved.unwrap().is_empty());
}

#[tokio::test]
async fn a_maps_whatsapp_draft_that_sends_without_asking_is_rejected() {
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::maps_whatsapp_catalog())));
    let without_approval = MAPS_WHATSAPP_OUTREACH
        .replace(
            "    - { source: draft_message, target: approve_message }\n",
            "    - { source: draft_message, target: send_message }\n",
        )
        .replace("    - { source: approve_message, target: send_message, handle: send }\n", "");
    let unknown_kind = MAPS_WHATSAPP_OUTREACH.replace("whatsapp-web.send_message", "whatsapp-web.send_text");
    let (_, builder) = mock_builder(&[]);

    let unapproved = validate_draft(&without_approval, &builder, &no_trust());
    let unknown = validate_draft(&unknown_kind, &builder, &no_trust());
    crate::plugins::active::publish_catalog(None);

    assert_ne!(without_approval, MAPS_WHATSAPP_OUTREACH, "fixture edges changed; update this test");
    assert!(unapproved.unwrap_err().contains("Send it on WhatsApp"));
    assert!(unknown.unwrap_err().contains("whatsapp-web.send_text"));
}

/// What a draft of each bypass trick is refused with: the step it names.
fn expected_problem_part(trick: &str) -> &'static str {
    if trick.contains("time runs out") {
        "Ask before posting answers `send`"
    } else {
        "send data without asking the user first"
    }
}

#[test]
fn validate_draft_refuses_every_approval_bypass_trick() {
    let (_, builder) = mock_builder(&[]);
    for (trick, draft, _) in flow::test_fixtures::approval_bypass_drafts() {
        let problem = validate_draft(&draft, &builder, &no_trust()).expect_err(trick);
        assert!(problem.contains(expected_problem_part(trick)), "{trick}: {problem}");
    }
    assert!(validate_draft(&flow::test_fixtures::timeout_draft_repaired(), &builder, &no_trust()).is_ok());
}

/// A prompt-injected builder reply using each trick goes back to the model with the
/// reason, and only the repaired draft is saved.
#[tokio::test]
async fn an_injected_draft_using_any_bypass_trick_is_repaired_before_it_is_saved() {
    for (trick, injected, _) in flow::test_fixtures::approval_bypass_drafts() {
        let repaired = if trick.contains("time runs out") {
            flow::test_fixtures::timeout_draft_repaired()
        } else {
            SIMPLE_ANSWER.to_owned()
        };
        let db = test_database();
        let (mock, builder) =
            mock_builder(&[fenced_reply("Helpful agent", &injected), fenced_reply("Helpful agent", &repaired)]);
        let progress = ProgressLog::default();

        let agent = build_agent_with_model(&db, &builder, request("Answer my question", None), &|update| {
            progress.record(update)
        })
        .await
        .unwrap_or_else(|error| panic!("{trick}: {error}"));

        assert_eq!(agent.flow_yaml.trim(), repaired.trim(), "{trick}");
        let repair_text = mock.requests()[1].messages[3].text();
        assert!(repair_text.contains(expected_problem_part(trick)), "{trick}: {repair_text}");
        assert!(progress.stages().contains(&BuildStage::Repairing), "{trick}");
    }
}

#[test]
fn validate_draft_refuses_codex_output_reaching_a_search_without_an_approval() {
    let (_, mut builder) = mock_builder(&[]);
    builder.available_providers.push("codex-cli".into());
    let unapproved = flow::test_fixtures::model_output_into_a_search("codex-cli", true, false);
    let problem = validate_draft(&unapproved, &builder, &no_trust()).unwrap_err();
    assert!(problem.contains("Search places") && problem.contains("without asking"), "{problem}");
    let approved = flow::test_fixtures::model_output_into_a_search("codex-cli", true, true);
    assert!(
        validate_draft(&approved, &builder, &no_trust()).is_ok(),
        "{:?}",
        validate_draft(&approved, &builder, &no_trust())
    );
}

#[tokio::test]
async fn an_injected_draft_that_never_stops_bypassing_is_not_saved() {
    let (_, injected, _) = flow::test_fixtures::approval_bypass_drafts().remove(1);
    let replies = vec![fenced_reply("Helpful agent", &injected); MAX_REPAIR_ATTEMPTS + 1];
    let db = test_database();
    let (_mock, builder) = mock_builder(&replies);

    let result = build_agent_with_model(&db, &builder, request("Answer my question", None), &|_| {}).await;

    assert!(matches!(&result, Err(AppError::Workflow(message)) if message.contains("without asking")), "{result:?}");
    assert!(db.list_agents().unwrap().is_empty());
}
