//! The guided path end to end, with a scripted model in place of Ollama.

use std::sync::Arc;

use graphrt_llm::mock::MockModel;
use graphrt_llm::ResponseFormat;

use crate::agent_builder::{build_agent_with_model, revise_agent_with_model, BuildRequest, BuilderModel};
use crate::credentials::{ModelChoice, ModelProvider};
use crate::error::AppError;
use crate::flow;
use crate::storage::models::{Agent, AgentKind};
use crate::storage::Database;

const SIMPLE_ANSWER: &str = include_str!("../../../fixtures/flows/simple_answer.yaml");

const NO_SCHEDULE: &str = r#""schedule": {"repeat": "never", "hour": 0}"#;

fn reply_plan() -> String {
    format!(
        r#"{{"looks_up_the_web": false, "summary": "Writes a polite reply to a complaint.", "name": "complaint reply",
            "inputs": [{{"name": "Complaint", "label": "The complaint", "long_text": true, "value": ""}}],
            "steps": [{{"kind": "write", "title": "Write the reply", "instruction": "Write a polite reply.", "url": ""}}], {NO_SCHEDULE}}}"#
    )
}

fn wikipedia_plan() -> String {
    format!(
        r#"{{"looks_up_the_web": true, "summary": "Summarizes a Wikipedia page.", "name": "Wikipedia Summary",
            "inputs": [{{"name": "topic", "label": "Topic", "long_text": false, "value": "Jakarta"}}],
            "steps": [{{"kind": "lookup", "title": "Get the page", "instruction": "", "url": "https://en.wikipedia.org/api/rest_v1/page/summary/{{{{topic}}}}"}},
                      {{"kind": "write", "title": "Summarize", "instruction": "Two sentences.", "url": ""}}], {NO_SCHEDULE}}}"#
    )
}

const PLACEHOLDER_PLAN: &str = r#"{"looks_up_the_web": true, "summary": "Reads a page.", "name": "Reader", "inputs": [],
    "steps": [{"kind": "lookup", "title": "Get it", "instruction": "", "url": "https://www.example.com/data"},
              {"kind": "write", "title": "Summarize", "instruction": "Two sentences.", "url": ""}]}"#;

/// Writes a note and mails it with the fixture catalog's `fixture-mail.send_mail`.
const MAIL_PLAN: &str = r#"{"looks_up_the_web": false, "summary": "Writes a thank-you note and mails it.", "name": "Thank You Mail",
    "inputs": [{"name": "address", "label": "Mail address", "long_text": false, "value": ""}],
    "steps": [{"kind": "write", "title": "Write the note", "instruction": "Write a short thank-you note.", "url": "", "operation": ""},
              {"kind": "use", "title": "Send the note", "instruction": "Mail the note to the address", "url": "", "operation": "fixture-mail.send_mail"}],
    "schedule": {"repeat": "never", "hour": 0}}"#;

const MAIL_FIELDS: &str = r#"{"to": "{address}", "subject": "Thank you", "body": "{step_1}"}"#;

/// A builder on a local Ollama model that replays `replies`.
fn local_builder(replies: &[&str]) -> (Arc<MockModel>, BuilderModel) {
    let mock = Arc::new(MockModel::new(replies.iter().map(|reply| MockModel::text(reply)).collect()));
    let builder = BuilderModel {
        model: mock.clone(),
        choice: ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() },
        available_providers: vec!["ollama".into()],
    };
    (mock, builder)
}

fn request(description: &str) -> BuildRequest {
    BuildRequest { description: description.into(), kind: None }
}

fn full_reply() -> String {
    format!("Answers a question.\nAgent name: Simple answer\n```yaml\n{SIMPLE_ANSWER}```\n")
}

fn explanation_of(db: &Database, agent: &Agent) -> String {
    db.list_builder_messages(&agent.id).unwrap().iter().rev().find_map(|message| message.explanation.clone()).unwrap()
}

/// The fixture catalog (with `fixture-mail`) published for one test.
struct PublishedCatalog {
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

impl PublishedCatalog {
    async fn publish() -> Self {
        let lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
        crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::not_installed_catalog())));
        Self { _lock: lock }
    }
}

impl Drop for PublishedCatalog {
    fn drop(&mut self) {
        crate::plugins::active::publish_catalog(None);
    }
}

#[tokio::test]
async fn a_local_model_fills_in_a_plan_and_the_app_writes_the_document() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[&reply_plan()]);

    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();

    assert_eq!(agent.name, "Complaint Reply");
    let summary = flow::summarize_flow(&agent.flow_yaml).unwrap();
    assert_eq!(summary.model_providers, ["ollama"]);
    assert_eq!(summary.inputs[0].name, "complaint");
    assert!(agent.flow_yaml.contains("name: llama3.2"), "{}", agent.flow_yaml);
    assert!(
        agent
            .flow_yaml
            .contains("The whole job, as the person asked for it: Write a polite reply to a complaint I paste"),
        "the writing step reads the job: {}",
        agent.flow_yaml
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 1, "one short call, no full-document draft");
    assert!(
        matches!(requests[0].response_format, Some(ResponseFormat::JsonSchema { .. })),
        "the answer is held to the schema"
    );
    let system_prompt = requests[0].messages[0].text();
    assert!(system_prompt.len() < 3800, "the prompt fits a local model: {} bytes", system_prompt.len());
    assert_eq!(explanation_of(&db, &agent), "Writes a polite reply to a complaint.");
    assert!(db.list_triggers(Some(&agent.id)).unwrap().is_empty());
}

#[tokio::test]
async fn a_lookup_is_proposed_for_the_users_trust_not_trusted() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[&wikipedia_plan()]);

    let agent = build_agent_with_model(&db, &builder, request("Look up a Wikipedia summary and shorten it"), &|_| {})
        .await
        .unwrap();

    assert!(db.trusted_lookup_hosts(&agent.id).unwrap().is_empty(), "only the user's click trusts a host");
    assert_eq!(explanation_of(&db, &agent), "Summarizes a Wikipedia page. Trust en.wikipedia.org for lookups.");
    assert!(agent.flow_yaml.contains("page/summary/{{#start.topic#}}"), "{}", agent.flow_yaml);
}

#[tokio::test]
async fn a_plan_the_checks_refuse_goes_back_to_the_model_in_plain_words() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[PLACEHOLDER_PLAN, &wikipedia_plan()]);

    let agent = build_agent_with_model(&db, &builder, request("Look up a page and shorten it"), &|_| {}).await.unwrap();

    assert!(agent.flow_yaml.contains("en.wikipedia.org"));
    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    let correction = requests[1].messages.last().unwrap().text();
    assert!(correction.contains("That plan cannot be used") && correction.contains("placeholder"), "{correction}");
}

#[tokio::test]
async fn without_a_usable_plan_the_full_document_is_drafted() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&["not json", "{\"steps\": []}", "still nothing", &full_reply()]);

    let agent = build_agent_with_model(&db, &builder, request("Answer my question"), &|_| {}).await.unwrap();

    assert_eq!(agent.name, "Simple Answer");
    let requests = mock.requests();
    assert_eq!(requests.len(), 4);
    assert!(requests[3].response_format.is_none(), "the fourth call is the full-document draft");
    // The app, not the model, moves the copied example's provider to the local model.
    assert_eq!(flow::summarize_flow(&agent.flow_yaml).unwrap().model_providers, ["ollama"]);
}

/// A plan whose own (checked) words say why the job needs the full format.
fn plan_quoting(field: &str, words: &str) -> String {
    reply_plan().replace(NO_SCHEDULE, &format!(r#"{NO_SCHEDULE}, "job_words": {{"{field}": "{words}"}}"#))
}

#[tokio::test]
async fn jobs_out_of_a_plans_reach_and_teams_are_drafted_in_full() {
    for (description, field, words) in [
        // Repeats over a list.
        ("Send each customer in my list a reminder", "for_each", "each customer in my list"),
        // Works on files.
        ("Summarize the PDF I attach", "files", "the PDF I attach"),
        // Sends, and no plugin operation is offered to send with.
        ("Kirim jawabannya ke pelanggan lewat WhatsApp", "send", "Kirim jawabannya ke pelanggan lewat WhatsApp"),
    ] {
        let db = Database::open_in_memory().unwrap();
        let (mock, builder) = local_builder(&[&plan_quoting(field, words), &full_reply()]);
        build_agent_with_model(&db, &builder, request(description), &|_| {}).await.unwrap();
        let requests = mock.requests();
        assert_eq!(requests.len(), 2, "{description}: one plan, then the full document at once");
        assert!(requests[1].response_format.is_none(), "{description}");
    }
    // A team is never planned.
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[&full_reply()]);
    let team = BuildRequest { description: "Answer my question".into(), kind: Some(AgentKind::Team) };
    build_agent_with_model(&db, &builder, team, &|_| {}).await.unwrap();
    assert!(mock.requests()[0].response_format.is_none());
}

#[tokio::test]
async fn words_the_job_does_not_hold_are_no_evidence() {
    // The model claims the job repeats for each item; the job says nothing of the kind.
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[&plan_quoting("for_each", "for each customer")]);
    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();
    assert_eq!(mock.requests().len(), 1);
    assert!(agent.flow_yaml.contains("type: llm"));
}

#[tokio::test]
async fn a_chatbot_plan_answers_the_customers_message() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[&reply_plan()]);
    let build =
        BuildRequest { description: "Reply kindly to what the customer writes".into(), kind: Some(AgentKind::Chatbot) };

    let agent = build_agent_with_model(&db, &builder, build, &|_| {}).await.unwrap();

    let summary = flow::summarize_flow(&agent.flow_yaml).unwrap();
    assert_eq!(summary.inputs.iter().map(|input| input.name.as_str()).collect::<Vec<_>>(), ["message"]);
    assert!(summary.steps.iter().any(|step| step.node_type == "answer"));
}

#[tokio::test]
async fn a_failed_model_call_is_reported_not_retried_on_the_full_path() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[]);

    let result = build_agent_with_model(&db, &builder, request("Write a reply"), &|_| {}).await;

    assert!(matches!(result, Err(AppError::Model(_))), "{result:?}");
    assert_eq!(mock.requests().len(), 1);
}

#[tokio::test]
async fn a_job_that_sends_uses_an_offered_operation_and_asks_first() {
    let _catalog = PublishedCatalog::publish().await;
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[MAIL_PLAN, MAIL_FIELDS]);
    let description = "Write a thank-you note and send it by mail to the address I give";

    let agent = build_agent_with_model(&db, &builder, request(description), &|_| {}).await.unwrap();

    let types: Vec<String> =
        flow::summarize_flow(&agent.flow_yaml).unwrap().steps.into_iter().map(|step| step.node_type).collect();
    let steps: Vec<&str> =
        types.iter().map(String::as_str).filter(|node_type| !matches!(*node_type, "start" | "end")).collect();
    assert_eq!(steps, ["llm", "human-input", "fixture-mail.send_mail"], "{}", agent.flow_yaml);
    assert!(agent.flow_yaml.contains("{{#start.address#}}") && agent.flow_yaml.contains("{{#write_1.text#}}"));
    let requests = mock.requests();
    assert_eq!(requests.len(), 2, "the plan, then the fields of the sending step");
    let plan_prompt = requests[0].messages[0].text();
    assert!(
        plan_prompt.contains("fixture-mail.send_mail: Send mail"),
        "the operation comes from the plugin's own list: {plan_prompt}"
    );
    let fields_request = requests[1].messages[1].text();
    assert!(fields_request.contains("\"to\" (required)") && fields_request.contains("{address}"), "{fields_request}");
    assert!(!fields_request.contains("api_key"), "the plugin's own key is the app's to fill in: {fields_request}");
}

#[tokio::test]
async fn a_plan_that_forgets_to_send_gets_the_offered_sending_step() {
    let _catalog = PublishedCatalog::publish().await;
    let db = Database::open_in_memory().unwrap();
    let only_writes = format!(
        r#"{{"looks_up_the_web": false, "summary": "Writes a note.", "name": "Note",
            "inputs": [{{"name": "address", "label": "Email address", "long_text": false, "value": ""}}],
            "steps": [{{"kind": "write", "title": "Write the note", "instruction": "Write a short note.", "url": ""}}], {NO_SCHEDULE},
            "job_words": {{"send": "send it by mail"}}}}"#
    );
    let fields = r#"{"to": "someone@example.com", "body": "Hello"}"#;
    let (mock, builder) = local_builder(&[&only_writes, fields]);

    let agent =
        build_agent_with_model(&db, &builder, request("Write a note and send it by mail"), &|_| {}).await.unwrap();

    assert_eq!(mock.requests().len(), 2, "no round is spent asking the model again");
    let yaml = &agent.flow_yaml;
    assert!(yaml.contains("type: fixture-mail.send_mail"), "{yaml}");
    assert!(yaml.contains("type: human-input"), "asked before sending: {yaml}");
    assert!(yaml.contains("{{#start.address#}}") && !yaml.contains("someone@example.com"), "{yaml}");
    assert!(yaml.contains("{{#write_1.text#}}"), "the written note is what is sent: {yaml}");
}

#[tokio::test]
async fn a_schedule_the_job_asks_for_is_saved_turned_off() {
    let db = Database::open_in_memory().unwrap();
    // A summary without a full stop, as small models write it.
    let plan = wikipedia_plan()
        .replace(
            NO_SCHEDULE,
            r#""schedule": {"repeat": "weekdays", "hour": 7}, "job_words": {"when": "On weekdays at 7"}"#,
        )
        .replace("Summarizes a Wikipedia page.", "Summarizes a Wikipedia page");
    let (_mock, builder) = local_builder(&[&plan]);

    let agent = build_agent_with_model(
        &db,
        &builder,
        request("On weekdays at 7 look up Jakarta on Wikipedia and sum it up"),
        &|_| {},
    )
    .await
    .unwrap();

    let [trigger] = db.list_triggers(Some(&agent.id)).unwrap().try_into().expect("one schedule");
    assert_eq!(trigger.cron_expression, "0 0 7 * * Mon-Fri");
    assert!(!trigger.enabled, "an agent nobody tried yet never starts by itself");
    assert_eq!(trigger.next_fire_at, None);
    assert_eq!(trigger.inputs, serde_json::json!({"topic": "Jakarta"}));
    let explanation = explanation_of(&db, &agent);
    assert!(explanation.contains("Monday to Friday at 07:00") && explanation.contains("turned off"), "{explanation}");
    assert!(!explanation.contains(". .") && explanation.contains(". A schedule"), "{explanation}");
}

#[tokio::test]
async fn words_that_say_when_are_a_schedule_even_when_the_plan_forgot_it() {
    let db = Database::open_in_memory().unwrap();
    let plan =
        wikipedia_plan().replace(NO_SCHEDULE, &format!(r#"{NO_SCHEDULE}, "job_words": {{"when": "Every morning"}}"#));
    let (_mock, builder) = local_builder(&[&plan]);

    let agent = build_agent_with_model(
        &db,
        &builder,
        request("Every morning look up Jakarta on Wikipedia and sum it up"),
        &|_| {},
    )
    .await
    .unwrap();

    let triggers = db.list_triggers(Some(&agent.id)).unwrap();
    assert_eq!(triggers.iter().map(|trigger| trigger.cron_expression.as_str()).collect::<Vec<_>>(), ["0 0 8 * * *"]);
}

#[tokio::test]
async fn a_schedule_the_job_never_asked_for_is_dropped() {
    let db = Database::open_in_memory().unwrap();
    let plan = reply_plan().replace(NO_SCHEDULE, r#""schedule": {"repeat": "daily", "hour": 10}"#);
    let (_mock, builder) = local_builder(&[&plan]);
    let agent = build_agent_with_model(&db, &builder, request("Turn my meeting notes into action items"), &|_| {})
        .await
        .unwrap();
    assert!(db.list_triggers(Some(&agent.id)).unwrap().is_empty());
}

#[tokio::test]
async fn a_change_in_the_chat_changes_the_plan_not_the_yaml() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[&reply_plan()]);
    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();

    let changed_plan = reply_plan().replace("Write a polite reply.", "Write a polite reply in Indonesian.");
    let (mock, builder) = local_builder(&[&changed_plan]);
    let revision = revise_agent_with_model(&db, &builder, &agent.id, "Reply in Indonesian", &|_| {}).await.unwrap();

    assert!(
        revision.agent.flow_yaml.contains("Task: Write a polite reply in Indonesian."),
        "{}",
        revision.agent.flow_yaml
    );
    assert_eq!(revision.agent.current_version, agent.current_version + 1);
    // A new instruction is a changed step, though its title and model stayed the same.
    assert_eq!(revision.summary, "Changed 1 step: Write the reply");
    assert_eq!(revision.changed_step_ids, ["write_1"]);
    assert!(
        revision.explanation.contains("Step 1 (Write the reply) now: Write a polite reply in Indonesian."),
        "{}",
        revision.explanation
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert!(matches!(requests[0].response_format, Some(ResponseFormat::JsonSchema { .. })));
    let change_request = requests[0].messages[1].text();
    assert!(
        change_request.contains("\"instruction\":\"Write a polite reply.\""),
        "the model sees the plan: {change_request}"
    );
    assert!(!change_request.contains("prompt_template"), "and not the YAML: {change_request}");
    assert!(requests[0].messages[0].text().len() < 3800);
}

#[tokio::test]
async fn a_changed_plan_keeps_the_fields_of_a_sending_step_it_did_not_touch() {
    let _catalog = PublishedCatalog::publish().await;
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[MAIL_PLAN, MAIL_FIELDS]);
    let description = "Write a thank-you note and send it by mail to the address I give";
    let agent = build_agent_with_model(&db, &builder, request(description), &|_| {}).await.unwrap();

    let changed_plan = MAIL_PLAN.replace("Write a short thank-you note.", "Write a long thank-you note.");
    let (mock, builder) = local_builder(&[&changed_plan]);
    let revision = revise_agent_with_model(&db, &builder, &agent.id, "Make the note longer", &|_| {}).await.unwrap();

    assert_eq!(mock.requests().len(), 1, "the fields of the untouched sending step are not asked for again");
    assert!(revision.agent.flow_yaml.contains("Write a long thank-you note."));
    assert!(revision.agent.flow_yaml.contains("{{#start.address#}}"));
    let plan_prompt = mock.requests()[0].messages[0].text();
    assert!(plan_prompt.contains("fixture-mail.send_mail"), "the operation the plan uses stays offered: {plan_prompt}");
}

#[tokio::test]
async fn an_agent_changed_by_hand_or_not_drafted_from_a_plan_is_revised_in_full() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[&reply_plan()]);
    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();
    let edited = agent.flow_yaml.replacen("Task: Write a polite reply.", "Task: Write a rude reply.", 1);
    db.update_agent_flow(&agent.id, &edited, "Edited by hand").unwrap();

    let full_revision = format!("Made it polite again.\n```yaml\n{}```\n", agent.flow_yaml);
    let (mock, builder) = local_builder(&[&full_revision]);
    revise_agent_with_model(&db, &builder, &agent.id, "Make it polite again", &|_| {}).await.unwrap();

    assert!(
        mock.requests()[0].response_format.is_none(),
        "the hand edit is revised as a document, never overwritten from the old plan"
    );
}

#[tokio::test]
async fn an_unchanged_plan_changes_nothing() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[&reply_plan()]);
    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();
    let (_mock, builder) = local_builder(&[&reply_plan()]);

    let result = revise_agent_with_model(&db, &builder, &agent.id, "Keep it as it is", &|_| {}).await;

    assert!(matches!(&result, Err(AppError::InvalidInput(message)) if message.contains("No changes")), "{result:?}");
}

#[tokio::test]
async fn an_openai_model_plans_a_job_within_reach_and_the_steps_run_on_it() {
    let db = Database::open_in_memory().unwrap();
    let mock = Arc::new(MockModel::new(vec![MockModel::text(&reply_plan())]));
    let builder = BuilderModel {
        model: mock.clone(),
        choice: ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() },
        available_providers: vec!["openai".into()],
    };

    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();

    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert!(
        matches!(&requests[0].response_format, Some(ResponseFormat::JsonSchema { name, strict: true, .. }) if name == "agent_plan"),
        "the plan is asked for with a strict schema"
    );
    assert!(agent.flow_yaml.contains("provider: openai") && agent.flow_yaml.contains("name: gpt-4o-mini"));
}

#[tokio::test]
async fn a_lookup_on_a_site_the_job_does_not_name_reads_with_the_offered_plugin() {
    let _catalog = PublishedCatalog::publish().await;
    let db = Database::open_in_memory().unwrap();
    // As llama3.2 planned the exchange-rate job: a guessed API instead of the offered plugin.
    let guessed = format!(
        r#"{{"looks_up_the_web": true, "summary": "Lists the newest mail in the inbox.", "name": "Inbox",
            "inputs": [],
            "steps": [{{"kind": "lookup", "title": "Get the inbox", "instruction": "", "url": "https://api.mailcheck.example/inbox"}},
                      {{"kind": "write", "title": "Sum it up", "instruction": "Sum up the mail.", "url": ""}}], {NO_SCHEDULE}}}"#
    );
    let (mock, builder) = local_builder(&[&guessed, r#"{"limit": 5}"#]);

    let agent =
        build_agent_with_model(&db, &builder, request("Check my mail inbox and sum it up"), &|_| {}).await.unwrap();

    assert!(agent.flow_yaml.contains("type: fixture-mail.list_inbox"), "{}", agent.flow_yaml);
    assert!(!agent.flow_yaml.contains("mailcheck"), "{}", agent.flow_yaml);
    let fields_request = mock.requests()[1].messages[1].text();
    assert!(fields_request.contains("The job: <<<Check my mail inbox and sum it up>>>"), "{fields_request}");
    // A site the job names stays a lookup.
    let named = wikipedia_plan();
    let (_mock, builder) = local_builder(&[&named]);
    let wiki = build_agent_with_model(&db, &builder, request("Look up Jakarta on Wikipedia and sum it up"), &|_| {})
        .await
        .unwrap();
    assert!(wiki.flow_yaml.contains("type: http-request"), "{}", wiki.flow_yaml);
}

#[tokio::test]
async fn a_model_call_cut_off_once_is_asked_again() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[]);
    mock.push_error(graphrt_llm::LlmError::Network("error decoding response body".into()));
    mock.push(MockModel::text(&reply_plan()));

    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();

    assert_eq!(mock.requests().len(), 2);
    assert_eq!(agent.name, "Complaint Reply");
    // Twice in a row is reported.
    let (mock, builder) = local_builder(&[]);
    mock.push_error(graphrt_llm::LlmError::Network("reset".into()));
    mock.push_error(graphrt_llm::LlmError::Network("reset".into()));
    let failed = build_agent_with_model(&db, &builder, request("Write a reply"), &|_| {}).await;
    assert!(matches!(failed, Err(AppError::Model(_))), "{failed:?}");
    assert_eq!(mock.requests().len(), 2);
}

#[tokio::test]
async fn a_chatbot_whose_job_says_when_the_owner_takes_over_hands_over() {
    let db = Database::open_in_memory().unwrap();
    let plan = reply_plan().replace(
        NO_SCHEDULE,
        &format!(r#"{NO_SCHEDULE}, "job_words": {{"hand_over": "Hand over to me for custom orders"}}"#),
    );
    let (_mock, builder) = local_builder(&[&plan]);
    let build = BuildRequest {
        description: "Answer questions about my bakery's prices. Hand over to me for custom orders.".into(),
        kind: Some(AgentKind::Chatbot),
    };

    let agent = build_agent_with_model(&db, &builder, build, &|_| {}).await.unwrap();

    let yaml = &agent.flow_yaml;
    assert!(yaml.contains("id: decide_handoff"), "{yaml}");
    assert!(yaml.contains("The owner takes over when: Hand over to me for custom orders"), "{yaml}");
    assert!(yaml.contains("variable: handoff\n") && yaml.contains("variable: handoff_reason"), "{yaml}");
    assert!(yaml.contains("Write your reply in the same language as the customer's message"), "{yaml}");
    // Without such words the bot never hands over on its own.
    let (_mock, builder) = local_builder(&[&reply_plan()]);
    let plain = BuildRequest {
        description: "Answer questions about my bakery's prices.".into(),
        kind: Some(AgentKind::Chatbot),
    };
    let agent = build_agent_with_model(&db, &builder, plain, &|_| {}).await.unwrap();
    assert!(!agent.flow_yaml.contains("decide_handoff"));
}
