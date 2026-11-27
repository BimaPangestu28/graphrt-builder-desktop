//! The guided path end to end, with a scripted model in place of Ollama.

use std::sync::Arc;

use graphrt_llm::mock::MockModel;
use graphrt_llm::ResponseFormat;

use crate::agent_builder::{build_agent_with_model, BuildRequest, BuilderModel};
use crate::credentials::{ModelChoice, ModelProvider};
use crate::error::AppError;
use crate::flow;
use crate::storage::models::AgentKind;
use crate::storage::Database;

const SIMPLE_ANSWER: &str = include_str!("../../../fixtures/flows/simple_answer.yaml");

const REPLY_PLAN: &str = r#"{"looks_up_the_web": false, "summary": "Writes a polite reply to a complaint.",
    "name": "complaint reply", "inputs": [{"name": "Complaint", "label": "The complaint", "long_text": true}],
    "steps": [{"kind": "write", "title": "Write the reply", "instruction": "Write a polite reply.", "url": ""}]}"#;

const WIKIPEDIA_PLAN: &str = r#"{"looks_up_the_web": true, "summary": "Summarizes a Wikipedia page.",
    "name": "Wikipedia Summary", "inputs": [{"name": "topic", "label": "Topic", "long_text": false}],
    "steps": [{"kind": "lookup", "title": "Get the page", "instruction": "", "url": "https://en.wikipedia.org/api/rest_v1/page/summary/{{topic}}"},
              {"kind": "write", "title": "Summarize", "instruction": "Two sentences.", "url": ""}]}"#;

const PLACEHOLDER_PLAN: &str = r#"{"looks_up_the_web": true, "summary": "Reads a page.", "name": "Reader", "inputs": [],
    "steps": [{"kind": "lookup", "title": "Get it", "instruction": "", "url": "https://www.example.com/data"},
              {"kind": "write", "title": "Summarize", "instruction": "Two sentences.", "url": ""}]}"#;

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

#[tokio::test]
async fn a_local_model_fills_in_a_plan_and_the_app_writes_the_document() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[REPLY_PLAN]);

    let agent = build_agent_with_model(&db, &builder, request("Write a polite reply to a complaint I paste"), &|_| {})
        .await
        .unwrap();

    assert_eq!(agent.name, "Complaint Reply");
    let summary = flow::summarize_flow(&agent.flow_yaml).unwrap();
    assert_eq!(summary.model_providers, ["ollama"]);
    assert_eq!(summary.inputs[0].name, "complaint");
    assert!(agent.flow_yaml.contains("name: llama3.2"), "{}", agent.flow_yaml);
    let requests = mock.requests();
    assert_eq!(requests.len(), 1, "one short call, no full-document draft");
    assert!(
        matches!(requests[0].response_format, Some(ResponseFormat::JsonSchema { .. })),
        "the answer is held to the schema"
    );
    let system_prompt = requests[0].messages[0].text();
    assert!(system_prompt.len() < 3200, "the prompt fits a local model: {} bytes", system_prompt.len());
    let history = db.list_builder_messages(&agent.id).unwrap();
    assert!(history
        .iter()
        .any(|message| message.explanation.as_deref() == Some("Writes a polite reply to a complaint.")));
}

#[tokio::test]
async fn a_lookup_is_proposed_for_the_users_trust_not_trusted() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[WIKIPEDIA_PLAN]);

    let agent = build_agent_with_model(&db, &builder, request("Look up a Wikipedia summary and shorten it"), &|_| {})
        .await
        .unwrap();

    assert!(db.trusted_lookup_hosts(&agent.id).unwrap().is_empty(), "only the user's click trusts a host");
    let history = db.list_builder_messages(&agent.id).unwrap();
    let explanation = history.iter().find_map(|message| message.explanation.clone()).unwrap();
    assert_eq!(explanation, "Summarizes a Wikipedia page. Trust en.wikipedia.org for lookups.");
    assert!(agent.flow_yaml.contains("page/summary/{{#start.topic#}}"), "{}", agent.flow_yaml);
}

#[tokio::test]
async fn a_plan_the_checks_refuse_goes_back_to_the_model_in_plain_words() {
    let db = Database::open_in_memory().unwrap();
    let (mock, builder) = local_builder(&[PLACEHOLDER_PLAN, WIKIPEDIA_PLAN]);

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
    let full_reply = format!("Answers a question.\nAgent name: Simple answer\n```yaml\n{SIMPLE_ANSWER}```\n");
    let (mock, builder) = local_builder(&["not json", "{\"steps\": []}", "still nothing", &full_reply]);

    let agent = build_agent_with_model(&db, &builder, request("Answer my question"), &|_| {}).await.unwrap();

    assert_eq!(agent.name, "Simple Answer");
    let requests = mock.requests();
    assert_eq!(requests.len(), 4);
    assert!(requests[3].response_format.is_none(), "the fourth call is the full-document draft");
    // The app, not the model, moves the copied example's provider to the local model.
    assert_eq!(flow::summarize_flow(&agent.flow_yaml).unwrap().model_providers, ["ollama"]);
}

#[tokio::test]
async fn jobs_that_send_something_and_teams_skip_the_plan() {
    let full_reply = format!("Answers a question.\nAgent name: Simple answer\n```yaml\n{SIMPLE_ANSWER}```\n");
    for build in [
        BuildRequest { description: "Send the answer to my customer by WhatsApp".into(), kind: None },
        BuildRequest { description: "Answer my question".into(), kind: Some(AgentKind::Team) },
    ] {
        let db = Database::open_in_memory().unwrap();
        let (mock, builder) = local_builder(&[&full_reply]);
        build_agent_with_model(&db, &builder, build, &|_| {}).await.unwrap();
        assert!(mock.requests()[0].response_format.is_none());
    }
}

#[tokio::test]
async fn a_chatbot_plan_answers_the_customers_message() {
    let db = Database::open_in_memory().unwrap();
    let (_mock, builder) = local_builder(&[REPLY_PLAN]);
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
