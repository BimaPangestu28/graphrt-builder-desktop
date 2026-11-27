//! Chatbot setup: saved, validated, and applied to real bot replies on graphrt
//! with scripted mock models.

use std::path::Path;
use std::sync::{Arc, Mutex};

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::Value as Json;

use super::*;
use crate::conversations::models::ConversationStatus;
use crate::conversations::{ConversationEventPayload, ConversationEventSink, ConversationManager};
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::ModelRegistrySource;
use crate::knowledge::events::{KnowledgeEvent, KnowledgeEventSink};
use crate::knowledge::models::SourceKind;
use crate::knowledge::{KnowledgeService, KNOWLEDGE_DIR_NAME};
use crate::storage::models::NewAgent;

/// One `llm` step that answers with its own system prompt.
const REPLY_FLOW: &str = r#"
version: "1"
name: chatbot
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: write_reply
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: system, text: "Answer the customer." }
        - { role: user, text: "{{#start.message#}}" }
    - id: reply
      type: answer
      answer: "{{#write_reply.text#}}"
    - id: end
      type: end
      outputs: []
  edges:
    - { source: start, target: write_reply }
    - { source: write_reply, target: reply }
    - { source: reply, target: end }
"#;

/// Hands over with `asked_for_person` when the message mentions a person.
const HANDOFF_FLOW: &str = r#"
version: "1"
name: chatbot-handoff
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: check
      type: if-else
      cases:
        - case_id: wants_person
          logical_operator: and
          conditions:
            - { variable_selector: [start, message], comparison_operator: contains, value: person }
    - id: handoff_reply
      type: answer
      answer: "Let me get the owner for you."
    - id: mark_handoff
      type: template-transform
      template: "true"
      variables: []
    - id: handoff_reason
      type: template-transform
      template: "asked_for_person"
      variables: []
    - id: end_handoff
      type: end
      outputs:
        - { variable: handoff, value_selector: [mark_handoff, output] }
        - { variable: handoff_reason, value_selector: [handoff_reason, output] }
    - id: fallback_reply
      type: answer
      answer: "Happy to help."
    - id: end_reply
      type: end
      outputs: []
  edges:
    - { source: start, target: check }
    - { source: check, target: handoff_reply, handle: wants_person }
    - { source: handoff_reply, target: mark_handoff }
    - { source: mark_handoff, target: handoff_reason }
    - { source: handoff_reason, target: end_handoff }
    - { source: check, target: fallback_reply, handle: "false" }
    - { source: fallback_reply, target: end_reply }
"#;

/// Searches `DATASET` and gives the passages to the answering `llm` step.
const RETRIEVAL_FLOW: &str = r#"
version: "1"
name: chatbot-knowledge
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: look_up
      type: knowledge-retrieval
      query_variable_selector: [start, message]
      dataset_ids: ["DATASET"]
      multiple_retrieval_config: { top_k: 2 }
    - id: write_reply
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      context: { enabled: true, variable_selector: [look_up, result] }
      prompt_template:
        - { role: system, text: "Answer only from: {{#context#}}" }
        - { role: user, text: "{{#start.message#}}" }
    - id: reply
      type: answer
      answer: "{{#write_reply.text#}}"
    - id: end
      type: end
      outputs: []
  edges:
    - { source: start, target: look_up }
    - { source: look_up, target: write_reply }
    - { source: write_reply, target: reply }
    - { source: reply, target: end }
"#;

#[derive(Debug, Default)]
struct DiscardingConversationSink;

impl ConversationEventSink for DiscardingConversationSink {
    fn send(&self, _payload: ConversationEventPayload) {}
}

#[derive(Debug, Default)]
struct DiscardingKnowledgeSink {
    events: Mutex<Vec<KnowledgeEvent>>,
}

impl KnowledgeEventSink for DiscardingKnowledgeSink {
    fn send(&self, event: KnowledgeEvent) {
        self.events.lock().unwrap().push(event);
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
    model: Arc<MockModel>,
    conversations: ConversationManager,
    knowledge: Arc<KnowledgeService>,
    _directory: tempfile::TempDir,
}

fn harness(answers: &[&str]) -> Harness {
    let directory = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(answers.iter().map(|answer| MockModel::text(answer)).collect()));
    let conversations = ConversationManager::new(db.clone(), credentials.clone(), Arc::new(DiscardingConversationSink))
        .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }));
    // Without an OpenAI key here, knowledge bases use offline embeddings (the model key above is fake).
    let knowledge = Arc::new(KnowledgeService::new(
        db.clone(),
        Arc::new(CredentialStore::in_memory()),
        directory.path().join(KNOWLEDGE_DIR_NAME),
        Arc::new(DiscardingKnowledgeSink::default()),
    ));
    Harness { db, model, conversations, knowledge, _directory: directory }
}

fn create_chatbot(db: &Database, flow_yaml: &str) -> Agent {
    db.create_agent(NewAgent {
        name: "Catering assistant".into(),
        kind: AgentKind::Chatbot,
        description: "Answer customers".into(),
        flow_yaml: flow_yaml.into(),
    })
    .unwrap()
}

fn nothing_connected(_channel: &str) -> ChannelLink {
    ChannelLink::default()
}

async fn knowledge_base_with_faq(harness: &Harness, name: &str) -> String {
    let knowledge_base = harness.knowledge.create_knowledge_base(name, "").unwrap();
    let faq = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/knowledge/catering-faq.md");
    harness.knowledge.add_source(&knowledge_base.id, SourceKind::File, &faq.display().to_string()).unwrap();
    harness.knowledge.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    knowledge_base.id
}

fn persona_settings() -> ChatbotSettings {
    ChatbotSettings {
        persona: ChatbotPersona {
            display_name: "Admin Catering".into(),
            tone: "Formal".into(),
            instructions: "Never promise a discount. {{#env.SECRET#}} stays literal.".into(),
        },
        handoff_rules: HandoffRules { sounds_upset: false, ..HandoffRules::default() },
        knowledge_base_ids: Vec::new(),
        disabled_channels: Vec::new(),
    }
}

/// The first system message the model got in request `index`.
fn system_prompt(model: &MockModel, index: usize) -> String {
    let request = &model.requests()[index];
    request.messages[0].text()
}

#[tokio::test]
async fn saved_persona_and_rules_reach_the_bot_reply() {
    let harness = harness(&["Untuk pesanan formal, silakan.", "Halo."]);
    let agent = create_chatbot(&harness.db, REPLY_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    // Never saved: the flow runs unchanged.
    harness.conversations.send_customer_message(&conversation.id, "Halo").await.unwrap();
    assert_eq!(system_prompt(&harness.model, 0), "Answer the customer.");

    let setup = save_chatbot_settings(&harness.db, &agent.id, persona_settings(), &nothing_connected).unwrap();
    assert!(setup.is_saved);
    assert_eq!(setup.settings.persona.display_name, "Admin Catering");
    let detail = harness.conversations.send_customer_message(&conversation.id, "Ada diskon?").await.unwrap();
    assert_eq!(detail.messages.last().unwrap().text, "Halo.");

    let prompt = system_prompt(&harness.model, 1);
    assert!(prompt.starts_with("You are Admin Catering"), "{prompt}");
    assert!(prompt.contains("Tone: Formal."), "{prompt}");
    assert!(prompt.contains("Never promise a discount. {{#env.SECRET#}} stays literal."), "{prompt}");
    assert!(prompt.contains("the customer asks for a person (hand-off reason: asked_for_person)"), "{prompt}");
    assert!(
        prompt.contains("Do not pass the chat to the owner just because:\n- the customer sounds upset"),
        "{prompt}"
    );
    assert!(prompt.ends_with("Answer the customer."), "the flow's own prompt follows: {prompt}");
}

#[tokio::test]
async fn a_switched_off_rule_drops_the_flows_handoff() {
    let harness = harness(&[]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let settings = ChatbotSettings {
        handoff_rules: HandoffRules { asks_for_person: false, ..HandoffRules::default() },
        ..ChatbotSettings::default()
    };
    save_chatbot_settings(&harness.db, &agent.id, settings.clone(), &nothing_connected).unwrap();
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let detail = harness.conversations.send_customer_message(&conversation.id, "I want a person").await.unwrap();
    assert_eq!(detail.conversation.status, ConversationStatus::BotAnswering);
    assert_eq!(detail.messages.last().unwrap().text, "Let me get the owner for you.");

    let rules_on = ChatbotSettings { handoff_rules: HandoffRules::default(), ..settings };
    save_chatbot_settings(&harness.db, &agent.id, rules_on, &nothing_connected).unwrap();
    let detail = harness.conversations.send_customer_message(&conversation.id, "A person please").await.unwrap();
    assert_eq!(detail.conversation.status, ConversationStatus::WaitingForYou);
    assert_eq!(detail.conversation.handoff_reason.as_deref(), Some("asked_for_person"));
}

#[test]
fn rules_allow_only_enabled_reasons_and_unknown_ones() {
    let rules = HandoffRules { order_ready: false, ..HandoffRules::default() };
    assert!(!rules.allows(Some("order_to_confirm")));
    assert!(rules.allows(Some("asked_for_person")));
    assert!(rules.allows(Some("wants a refund")));
    assert!(rules.allows(None));
}

#[tokio::test]
async fn attached_knowledge_reaches_a_flow_without_retrieval_steps() {
    let harness = harness(&["Ongkir sesuai jarak.", "Ongkir sesuai jarak."]);
    let knowledge_base_id = knowledge_base_with_faq(&harness, "Catering menu and prices").await;
    let agent = create_chatbot(&harness.db, REPLY_FLOW);
    assert!(get_chatbot_setup(&harness.db, &agent.id, &nothing_connected)
        .unwrap()
        .settings
        .knowledge_base_ids
        .is_empty());

    let setup = attach_knowledge_base(&harness.db, &agent.id, &knowledge_base_id, &nothing_connected).unwrap();
    assert_eq!(setup.settings.knowledge_base_ids, std::slice::from_ref(&knowledge_base_id));
    // The knowledge screens list the chatbot as a user of the knowledge base.
    let used_by = &harness.knowledge.list_knowledge_bases().unwrap()[0].used_by;
    assert_eq!(used_by.iter().map(|usage| usage.agent_id.as_str()).collect::<Vec<_>>(), [agent.id.as_str()]);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    let detail =
        harness.conversations.send_customer_message(&conversation.id, "delivery fee for small orders").await.unwrap();

    let prompt = system_prompt(&harness.model, 0);
    assert!(prompt.contains("Facts from the owner's knowledge"), "{prompt}");
    assert!(prompt.contains("delivery fee based on distance"), "{prompt}");
    assert!(prompt.contains("[catering-faq.md]"), "{prompt}");
    assert!(prompt.matches("[catering-faq.md]").count() > 1, "default: up to 4 passages: {prompt}");
    // "Always show the source in answers" is on by default: the reply names its file.
    assert_eq!(detail.messages.last().unwrap().metadata, serde_json::json!({ "citations": ["catering-faq.md"] }));

    // One passage per answer, sources hidden.
    let mut settings = harness.knowledge.get_knowledge_base(&knowledge_base_id).unwrap().knowledge_base.settings;
    settings.passages_per_answer = 1;
    settings.show_sources = false;
    harness.knowledge.update_settings(&knowledge_base_id, settings).await.unwrap();
    let detail =
        harness.conversations.send_customer_message(&conversation.id, "delivery fee for small orders").await.unwrap();
    let prompt = system_prompt(&harness.model, 1);
    assert_eq!(prompt.matches("[catering-faq.md]").count(), 1, "{prompt}");
    assert_eq!(detail.messages.last().unwrap().metadata, serde_json::json!({}));
}

#[tokio::test]
async fn retrieval_steps_search_exactly_the_attached_knowledge() {
    let harness = harness(&["Ada.", "Maaf."]);
    let knowledge_base_id = knowledge_base_with_faq(&harness, "Catering menu and prices").await;
    // The flow names the knowledge base, so it is attached by default.
    let agent = create_chatbot(&harness.db, &RETRIEVAL_FLOW.replace("DATASET", "Catering menu and prices"));
    let defaults = get_chatbot_setup(&harness.db, &agent.id, &nothing_connected).unwrap();
    assert!(!defaults.is_saved);
    assert_eq!(defaults.settings.knowledge_base_ids, std::slice::from_ref(&knowledge_base_id));

    attach_knowledge_base(&harness.db, &agent.id, &knowledge_base_id, &nothing_connected).unwrap();
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    let detail =
        harness.conversations.send_customer_message(&conversation.id, "minimum order for packages").await.unwrap();
    assert!(format!("{:?}", harness.model.requests()[0]).contains("minimum order of 20 boxes"));
    // Sources of the passages the flow's own retrieval step found.
    assert_eq!(detail.messages.last().unwrap().metadata, serde_json::json!({ "citations": ["catering-faq.md"] }));

    let setup = detach_knowledge_base(&harness.db, &agent.id, &knowledge_base_id, &nothing_connected).unwrap();
    assert!(setup.settings.knowledge_base_ids.is_empty());
    harness.conversations.send_customer_message(&conversation.id, "minimum order for packages").await.unwrap();
    let second = format!("{:?}", harness.model.requests()[1]);
    assert!(!second.contains("minimum order of 20 boxes"), "{second}");
}

#[test]
fn rejects_unknown_knowledge_long_fields_and_non_chatbots() {
    let db = Database::open_in_memory().unwrap();
    let agent = create_chatbot(&db, REPLY_FLOW);
    let unknown_knowledge = attach_knowledge_base(&db, &agent.id, "kb_missing", &nothing_connected);
    assert!(matches!(unknown_knowledge, Err(AppError::NotFound(_))));
    let mut too_long = ChatbotSettings::default();
    too_long.persona.display_name = "x".repeat(MAX_DISPLAY_NAME_CHARS + 1);
    assert!(matches!(
        save_chatbot_settings(&db, &agent.id, too_long, &nothing_connected),
        Err(AppError::InvalidInput(_))
    ));
    let task = db
        .create_agent(NewAgent {
            name: "Task".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: REPLY_FLOW.into(),
        })
        .unwrap();
    assert!(matches!(get_chatbot_setup(&db, &task.id, &nothing_connected), Err(AppError::InvalidInput(_))));
}

#[test]
fn channels_show_connection_and_the_owners_switch() {
    let db = Database::open_in_memory().unwrap();
    let agent = create_chatbot(&db, REPLY_FLOW);
    let whatsapp_only =
        |channel: &str| ChannelLink { connected: channel == "whatsapp", account: Some("+62 812-0000-1111".into()) };
    let setup = get_chatbot_setup(&db, &agent.id, &whatsapp_only).unwrap();
    let states: Vec<(&str, bool, bool)> =
        setup.channels.iter().map(|channel| (channel.id.as_str(), channel.connected, channel.enabled)).collect();
    assert_eq!(states, [("telegram", false, false), ("whatsapp", true, true), ("whatsapp-web", false, false)]);
    assert_eq!(setup.channels[1].detail.as_deref(), Some("+62 812-0000-1111"));
    assert_eq!(setup.channels[0].detail, None, "a channel that is not connected names no account");

    let settings = ChatbotSettings { disabled_channels: vec!["whatsapp".into(), "sms".into()], ..setup.settings };
    let saved = save_chatbot_settings(&db, &agent.id, settings, &whatsapp_only).unwrap();
    assert_eq!(saved.settings.disabled_channels, ["whatsapp"]);
    assert!(!saved.channels[1].enabled);
    assert!(!is_channel_enabled(&db, &agent.id, "whatsapp").unwrap());
    assert!(is_channel_enabled(&db, &agent.id, "telegram").unwrap());
}

#[test]
fn overlay_adds_references_and_points_retrieval_at_attached_knowledge() {
    let flow = RETRIEVAL_FLOW.replace("DATASET", "Old");
    let attached = overlay::overlay_flow(&flow, &["kb_1".to_owned()]).unwrap();
    assert!(attached.has_retrieval_step);
    let document: Json = serde_json::from_str(&attached.flow_text).unwrap();
    let nodes = document["graph"]["nodes"].as_array().unwrap();
    let node = |id: &str| nodes.iter().find(|node| node["id"] == id).unwrap().clone();
    assert_eq!(node("look_up")["dataset_ids"], serde_json::json!(["kb_1"]));
    let system_text = node("write_reply")["prompt_template"][0]["text"].as_str().unwrap().to_owned();
    assert_eq!(system_text, "{{#sys.chatbot_brief#}}\n\nAnswer only from: {{#context#}}");
    crate::flow::compile_flow(&attached.flow_text).unwrap();

    let detached = overlay::overlay_flow(&flow, &[]).unwrap();
    let document: Json = serde_json::from_str(&detached.flow_text).unwrap();
    let look_up = document["graph"]["nodes"].as_array().unwrap().iter().find(|node| node["id"] == "look_up").unwrap();
    assert_eq!(look_up["query_variable_selector"], serde_json::json!(["sys", "chatbot_no_knowledge"]));
    assert_eq!(overlay::referenced_dataset_ids(&flow), ["Old"]);
}

/// A PDF with one page per entry of `pages`, each showing that text (empty: a page without text).
fn pdf_with_pages(pages: &[&str]) -> Vec<u8> {
    let count = pages.len();
    let kids: Vec<String> = (0..count).map(|index| format!("{} 0 R", 4 + 2 * index)).collect();
    let mut objects: Vec<Vec<u8>> = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        format!("<< /Type /Pages /Kids [{}] /Count {count} >>", kids.join(" ")).into_bytes(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
    ];
    for (index, text) in pages.iter().enumerate() {
        objects.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
                5 + 2 * index
            )
            .into_bytes(),
        );
        let content = if text.is_empty() { String::new() } else { format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET") };
        let mut stream = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
        stream.extend_from_slice(content.as_bytes());
        stream.extend_from_slice(b"\nendstream");
        objects.push(stream);
    }
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes(),
    );
    out
}

#[tokio::test]
async fn pdf_citations_name_the_pages_of_the_passages() {
    let harness = harness(&["Buka jam sembilan, ongkir sesuai jarak."]);
    let knowledge_base = harness.knowledge.create_knowledge_base("Catering guide", "").unwrap();
    let pdf_path = harness._directory.path().join("guide.pdf");
    // Page 2 has no text: the fees are on page 3. Each page is longer than one passage.
    let hours = "Opening hours are nine to five on weekdays and the kitchen closes early on Friday ".repeat(14);
    let fees = "Delivery fees depend on the distance to the venue and small orders pay a flat fee ".repeat(14);
    std::fs::write(&pdf_path, pdf_with_pages(&[&hours, "", &fees])).unwrap();
    harness.knowledge.add_source(&knowledge_base.id, SourceKind::File, &pdf_path.display().to_string()).unwrap();
    harness.knowledge.sync_knowledge_base(&knowledge_base.id).await.unwrap();

    // The knowledge screen's search names the page.
    let passages = harness.knowledge.search("delivery fees distance venue", None, 4).await.unwrap();
    let locations: Vec<&str> = passages.iter().filter_map(|passage| passage.location.as_deref()).collect();
    assert!(locations.contains(&"Page 3"), "{locations:?}");
    assert!(locations.iter().all(|location| location.starts_with("Page ")), "{locations:?}");

    let agent = create_chatbot(&harness.db, REPLY_FLOW);
    attach_knowledge_base(&harness.db, &agent.id, &knowledge_base.id, &nothing_connected).unwrap();
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    let detail =
        harness.conversations.send_customer_message(&conversation.id, "opening hours and delivery fees").await.unwrap();

    // Passages from both pages of the same file share one citation.
    let metadata = &detail.messages.last().unwrap().metadata;
    assert_eq!(metadata, &serde_json::json!({ "citations": ["guide.pdf · p1, p3"] }), "{metadata}");
    let prompt = system_prompt(&harness.model, 0);
    assert!(prompt.contains("[guide.pdf · p3]") && prompt.contains("[guide.pdf · p1]"), "{prompt}");
    assert!(!prompt.contains('\u{E000}'), "no page marker reaches the model: {prompt}");
}

#[test]
fn citations_merge_pages_per_file_and_keep_files_without_pages_plain() {
    use crate::conversations::bot::RetrievedSource;
    let source = |name: &str, pages: &[u32]| RetrievedSource {
        knowledge_base_id: "kb_1".into(),
        source_name: name.into(),
        pages: pages.to_vec(),
    };
    let prepared = reply::PreparedReply {
        flow_text: String::new(),
        sys_values: Vec::new(),
        handoff_rules: None,
        host_sources: vec![source("menu.pdf", &[12]), source("faq.md", &[])],
        cited_knowledge_base_ids: vec!["kb_1".into()],
    };
    let retrieved = [source("menu.pdf", &[3]), source("menu.pdf", &[12, 13]), source("faq.md", &[])];
    assert_eq!(prepared.citations(&retrieved), ["menu.pdf · p3, p12, p13", "faq.md"]);
}
