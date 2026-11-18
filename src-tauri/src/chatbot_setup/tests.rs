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

fn nothing_connected(_channel: &str) -> bool {
    false
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
    let harness = harness(&["Ongkir sesuai jarak."]);
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
    harness.conversations.send_customer_message(&conversation.id, "delivery fee for small orders").await.unwrap();

    let prompt = system_prompt(&harness.model, 0);
    assert!(prompt.contains("Facts from the owner's knowledge"), "{prompt}");
    assert!(prompt.contains("delivery fee based on distance"), "{prompt}");
    assert!(prompt.contains("[catering-faq.md]"), "{prompt}");
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
    harness.conversations.send_customer_message(&conversation.id, "minimum order for packages").await.unwrap();
    assert!(format!("{:?}", harness.model.requests()[0]).contains("minimum order of 20 boxes"));

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
    let whatsapp_only = |channel: &str| channel == "whatsapp";
    let setup = get_chatbot_setup(&db, &agent.id, &whatsapp_only).unwrap();
    let states: Vec<(&str, bool, bool)> =
        setup.channels.iter().map(|channel| (channel.id.as_str(), channel.connected, channel.enabled)).collect();
    assert_eq!(states, [("whatsapp", true, true), ("telegram", false, false)]);

    let settings = ChatbotSettings { disabled_channels: vec!["whatsapp".into(), "sms".into()], ..setup.settings };
    let saved = save_chatbot_settings(&db, &agent.id, settings, &whatsapp_only).unwrap();
    assert_eq!(saved.settings.disabled_channels, ["whatsapp"]);
    assert!(!saved.channels[0].enabled);
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
