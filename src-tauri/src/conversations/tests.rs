use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use futures::StreamExt;
use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::json;

use super::channel::{ChannelAdapter, ChannelCapabilities, InboundMessage, OutboundImage, OutboundMessage};
use super::*;
use crate::credentials::ModelProvider;
use crate::storage::models::{Agent, NewAgent};
use graphrt_ui::fallback::Markup;

/// Replies with the model's text and remembers every customer message in `conversation.history`.
const MEMORY_FLOW: &str = r#"
version: "1"
name: chatbot-memory
conversation:
  - { name: turns, type: integer, value: 0 }
  - { name: history, type: "array[string]" }
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
        - { role: system, text: "Earlier customer messages: {{#conversation.history#}}" }
        - { role: user, text: "{{#start.message#}}" }
    - id: reply
      type: answer
      answer: "{{#write_reply.text#}}"
    - id: remember
      type: assigner
      items:
        - { variable_selector: [conversation, turns], operation: "+=", input_type: constant, value: 1 }
        - { variable_selector: [conversation, history], operation: append, input_type: variable, value: [start, message] }
    - id: end
      type: end
      outputs: []
  edges:
    - { source: start, target: write_reply }
    - { source: write_reply, target: reply }
    - { source: reply, target: remember }
    - { source: remember, target: end }
"#;

/// Hands the chat over when the customer asks for a person; otherwise the model answers.
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
    - id: write_reply
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "{{#start.message#}}" }
    - id: reply
      type: answer
      answer: "{{#write_reply.text#}}"
    - id: end_reply
      type: end
      outputs: []
  edges:
    - { source: start, target: check }
    - { source: check, target: handoff_reply, handle: wants_person }
    - { source: handoff_reply, target: mark_handoff }
    - { source: mark_handoff, target: handoff_reason }
    - { source: handoff_reason, target: end_handoff }
    - { source: check, target: write_reply, handle: "false" }
    - { source: write_reply, target: reply }
    - { source: reply, target: end_reply }
"#;

#[derive(Debug, Default)]
struct CollectingSink {
    payloads: Mutex<Vec<ConversationEventPayload>>,
}

impl CollectingSink {
    fn kinds_for(&self, conversation_id: &str) -> Vec<ConversationEventKind> {
        let payloads = self.payloads.lock().unwrap();
        payloads
            .iter()
            .filter(|payload| payload.conversation_id == conversation_id)
            .map(|payload| payload.kind)
            .collect()
    }
}

impl ConversationEventSink for CollectingSink {
    fn send(&self, payload: ConversationEventPayload) {
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

/// A pretend WhatsApp channel that records what it sends.
#[derive(Debug, Default)]
struct RecordingChannel {
    sent: Mutex<Vec<(MessageAuthor, String)>>,
    images: Mutex<Vec<OutboundImage>>,
    /// Whether this pretend channel sends images.
    sends_images: bool,
}

impl ChannelAdapter for RecordingChannel {
    fn name(&self) -> &'static str {
        "whatsapp"
    }

    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: self.sends_images, markup: Markup::WhatsApp }
    }

    fn parse_inbound(&self, payload: &serde_json::Value) -> AppResult<InboundMessage> {
        Ok(InboundMessage {
            customer_handle: payload["from"].as_str().unwrap_or_default().to_owned(),
            customer_name: None,
            text: payload["body"].as_str().unwrap_or_default().to_owned(),
        })
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), super::channel::DeliveryFailure>> {
        self.sent.lock().unwrap().push((outbound.author, outbound.text.to_owned()));
        self.images.lock().unwrap().extend(outbound.images.iter().cloned());
        Box::pin(async { Ok(()) })
    }
}

struct Harness {
    db: Arc<Database>,
    sink: Arc<CollectingSink>,
    model: Arc<MockModel>,
    channel: Arc<RecordingChannel>,
    conversations: ConversationManager,
}

fn harness_with_answers(answers: &[&str]) -> Harness {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let sink = Arc::new(CollectingSink::default());
    let model = Arc::new(MockModel::new(answers.iter().map(|answer| MockModel::text(answer)).collect()));
    let channel = Arc::new(RecordingChannel::default());
    let conversations = ConversationManager::new(db.clone(), credentials, sink.clone())
        .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }))
        .with_channel(channel.clone());
    Harness { db, sink, model, channel, conversations }
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

fn authors_and_texts(detail: &ConversationDetail) -> Vec<(MessageAuthor, String)> {
    detail.messages.iter().map(|message| (message.author, message.text.clone())).collect()
}

#[tokio::test]
async fn bot_replies_and_memory_persists_across_turns() {
    let harness = harness_with_answers(&["Halo kak, ada paket nasi box.", "Siap, untuk 50 orang."]);
    let agent = create_chatbot(&harness.db, MEMORY_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    assert_eq!(conversation.channel, TEST_CHANNEL);
    assert_eq!(conversation.status, ConversationStatus::BotAnswering);

    let after_first = harness.conversations.send_customer_message(&conversation.id, "Ada nasi box?").await.unwrap();
    assert_eq!(
        authors_and_texts(&after_first),
        [
            (MessageAuthor::Customer, "Ada nasi box?".to_owned()),
            (MessageAuthor::Bot, "Halo kak, ada paket nasi box.".to_owned())
        ]
    );
    assert_eq!(after_first.conversation.variables, json!({"turns": 1, "history": ["Ada nasi box?"]}));

    let after_second = harness.conversations.send_customer_message(&conversation.id, "Untuk 50 orang").await.unwrap();
    assert_eq!(after_second.messages.len(), 4);
    assert_eq!(after_second.messages[3].text, "Siap, untuk 50 orang.");
    assert_eq!(
        after_second.conversation.variables,
        json!({"turns": 2, "history": ["Ada nasi box?", "Untuk 50 orang"]})
    );
    assert_eq!(after_second.conversation.last_message_author, Some(MessageAuthor::Bot));

    // The second run saw the first message through `conversation.history`.
    let requests = harness.model.requests();
    assert_eq!(requests.len(), 2);
    assert!(format!("{:?}", requests[1]).contains("Ada nasi box?"));

    let kinds = harness.sink.kinds_for(&conversation.id);
    assert_eq!(kinds.first(), Some(&ConversationEventKind::Created));
    assert_eq!(kinds.iter().filter(|kind| **kind == ConversationEventKind::MessageAdded).count(), 4);
}

#[tokio::test]
async fn only_a_reply_of_the_chatbot_can_be_rated_and_it_comes_with_what_the_customer_wrote() {
    let harness = harness_with_answers(&["Halo kak, ada paket nasi box.", "Siap, untuk 50 orang."]);
    let agent = create_chatbot(&harness.db, MEMORY_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    harness.conversations.send_customer_message(&conversation.id, "Ada nasi box?").await.unwrap();
    let detail = harness.conversations.send_customer_message(&conversation.id, "Untuk 50 orang").await.unwrap();

    let second_reply = find_bot_reply(&detail, &detail.messages[3].id).unwrap();
    assert_eq!(second_reply.text, "Siap, untuk 50 orang.");
    assert_eq!(second_reply.customer_text, Some("Untuk 50 orang"), "the message right before it, not an earlier one");
    let first_reply = find_bot_reply(&detail, &detail.messages[1].id).unwrap();
    assert_eq!(first_reply.customer_text, Some("Ada nasi box?"));

    let customer_message = find_bot_reply(&detail, &detail.messages[0].id);
    assert!(matches!(customer_message, Err(AppError::InvalidInput(_))), "{customer_message:?}");
    assert!(matches!(find_bot_reply(&detail, "no-such-message"), Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn handoff_output_moves_the_chat_to_waiting_for_you() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let detail =
        harness.conversations.send_customer_message(&conversation.id, "Can I talk to a person?").await.unwrap();
    assert_eq!(detail.conversation.status, ConversationStatus::WaitingForYou);
    assert_eq!(detail.conversation.handoff_reason.as_deref(), Some("asked_for_person"));
    assert_eq!(
        authors_and_texts(&detail),
        [
            (MessageAuthor::Customer, "Can I talk to a person?".to_owned()),
            (MessageAuthor::Bot, "Let me get the owner for you.".to_owned()),
            (MessageAuthor::System, "Bot handed this to you · customer asked for a person".to_owned()),
        ]
    );
    assert_eq!(detail.messages[2].metadata, json!({"handoffReason": "asked_for_person"}));

    // While waiting for the owner the bot stays quiet (the model has no scripted answer).
    let later = harness.conversations.send_customer_message(&conversation.id, "Hello?").await.unwrap();
    assert_eq!(later.conversation.status, ConversationStatus::WaitingForYou);
    assert_eq!(later.messages.last().unwrap().author, MessageAuthor::Customer);
    assert!(harness.model.requests().is_empty());
    assert_eq!(harness.conversations.count_conversations(None).unwrap().waiting_for_you, 1);
}

#[tokio::test]
async fn take_over_stops_bot_replies_and_hand_back_resumes_them() {
    let harness = harness_with_answers(&["Menu kami ada di sini."]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let taken = harness.conversations.take_over(&conversation.id).unwrap();
    assert_eq!(taken.status, ConversationStatus::YouReplying);
    let detail = harness.conversations.send_customer_message(&conversation.id, "Lihat menu?").await.unwrap();
    assert_eq!(detail.messages.last().unwrap().author, MessageAuthor::Customer);
    assert!(harness.model.requests().is_empty());

    let handed_back = harness.conversations.hand_back(&conversation.id).unwrap();
    assert_eq!(handed_back.status, ConversationStatus::BotAnswering);
    assert!(matches!(harness.conversations.hand_back(&conversation.id), Err(AppError::InvalidInput(_))));
    let detail = harness.conversations.send_customer_message(&conversation.id, "Lihat menu?").await.unwrap();
    assert_eq!(detail.messages.last().unwrap().text, "Menu kami ada di sini.");
    let notices: Vec<&str> = detail
        .messages
        .iter()
        .filter(|message| message.author == MessageAuthor::System)
        .map(|message| message.text.as_str())
        .collect();
    assert_eq!(notices, ["You took over · bot paused", "You handed this back to the bot"]);
}

#[tokio::test]
async fn operator_reply_is_stored_delivered_and_takes_over() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let detail = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": "Need a person please"}))
        .await
        .unwrap();
    assert_eq!(detail.conversation.channel, "whatsapp");
    assert_eq!(detail.conversation.customer_name, "+62 800");
    assert_eq!(detail.conversation.status, ConversationStatus::WaitingForYou);

    let reply =
        harness.conversations.send_operator_reply(&detail.conversation.id, "Halo, saya pemiliknya").await.unwrap();
    assert_eq!(reply.author, MessageAuthor::Operator);
    assert_eq!(reply.metadata, json!({}));
    let stored = harness.conversations.get_conversation(&detail.conversation.id).unwrap();
    assert_eq!(stored.conversation.status, ConversationStatus::YouReplying);
    assert_eq!(stored.messages.last().unwrap().text, "Halo, saya pemiliknya");
    assert_eq!(
        *harness.channel.sent.lock().unwrap(),
        [
            (MessageAuthor::Bot, "Let me get the owner for you.".to_owned()),
            (MessageAuthor::Operator, "Halo, saya pemiliknya".to_owned())
        ]
    );
    assert!(matches!(
        harness.conversations.send_operator_reply(&detail.conversation.id, "  ").await,
        Err(AppError::InvalidInput(_))
    ));

    // The same customer writing again lands in the same open chat.
    let again = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": "Terima kasih"}))
        .await
        .unwrap();
    assert_eq!(again.conversation.id, detail.conversation.id);
}

#[tokio::test]
async fn paused_bot_leaves_real_channel_messages_for_the_owner_but_still_answers_tests() {
    let harness = harness_with_answers(&["Test answer"]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    assert!(harness.conversations.is_bot_enabled(&agent.id).unwrap());
    assert!(!harness.conversations.set_bot_enabled(&agent.id, false).unwrap());
    assert!(!harness.conversations.is_bot_enabled(&agent.id).unwrap());

    let detail = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 801", "body": "Halo"}))
        .await
        .unwrap();
    assert_eq!(detail.conversation.status, ConversationStatus::WaitingForYou);
    assert_eq!(detail.conversation.handoff_reason.as_deref(), Some(BOT_PAUSED_REASON));

    let test_chat = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    let answered = harness.conversations.send_customer_message(&test_chat.id, "Halo").await.unwrap();
    assert_eq!(answered.messages.last().unwrap().text, "Test answer");
    assert!(matches!(harness.conversations.set_bot_enabled("missing", true), Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn bot_failure_hands_the_chat_over_with_the_reason() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let detail = harness.conversations.send_customer_message(&conversation.id, "Ada menu?").await.unwrap();
    assert_eq!(detail.conversation.status, ConversationStatus::WaitingForYou);
    assert_eq!(detail.conversation.handoff_reason.as_deref(), Some(BOT_ERROR_REASON));
    let notice = detail.messages.last().unwrap();
    assert_eq!(notice.author, MessageAuthor::System);
    assert!(notice.text.starts_with("The bot could not answer"));
}

#[tokio::test]
async fn closing_and_reopening_a_chat() {
    let harness = harness_with_answers(&["Welcome back"]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let closed = harness.conversations.close_conversation(&conversation.id).unwrap();
    assert_eq!(closed.status, ConversationStatus::Closed);
    assert!(matches!(harness.conversations.take_over(&conversation.id), Err(AppError::InvalidInput(_))));

    let reopened = harness.conversations.send_customer_message(&conversation.id, "Halo lagi").await.unwrap();
    assert_eq!(reopened.conversation.status, ConversationStatus::BotAnswering);
    assert_eq!(reopened.messages.last().unwrap().text, "Welcome back");
}

#[tokio::test]
async fn only_chatbots_get_test_conversations() {
    let harness = harness_with_answers(&[]);
    let task_agent = harness
        .db
        .create_agent(NewAgent {
            name: "Task".into(),
            kind: AgentKind::Task,
            description: "x".into(),
            flow_yaml: HANDOFF_FLOW.into(),
        })
        .unwrap();
    assert!(matches!(harness.conversations.start_test_conversation(&task_agent.id), Err(AppError::InvalidInput(_))));
    assert!(matches!(harness.conversations.start_test_conversation("missing"), Err(AppError::NotFound(_))));
    assert!(matches!(harness.conversations.get_conversation("missing"), Err(AppError::NotFound(_))));
}

#[test]
fn filters_and_counts() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let other_agent = create_chatbot(&harness.db, HANDOFF_FLOW);
    let new_conversation = |agent_id: &str, handle: &str, origin: Option<&str>| {
        harness
            .db
            .insert_conversation(&NewConversation {
                agent_id: agent_id.into(),
                channel: "whatsapp".into(),
                customer_name: String::new(),
                customer_handle: handle.into(),
                origin: origin.map(str::to_owned),
            })
            .unwrap()
    };
    let from_outreach = new_conversation(&agent.id, "+62 1", Some(OUTREACH_ORIGIN));
    let waiting = new_conversation(&agent.id, "+62 2", None);
    let elsewhere = new_conversation(&other_agent.id, "+62 3", None);
    harness.db.set_conversation_status(&waiting.id, ConversationStatus::WaitingForYou, Some("not_sure")).unwrap();
    harness.db.insert_conversation_message(&from_outreach.id, MessageAuthor::Customer, "Halo", &json!({})).unwrap();

    let ids = |filter: ConversationFilter| -> Vec<String> {
        harness
            .conversations
            .list_conversations(&filter)
            .unwrap()
            .into_iter()
            .map(|conversation| conversation.id)
            .collect()
    };
    assert_eq!(
        ids(ConversationFilter::default()),
        [from_outreach.id.clone(), waiting.id.clone(), elsewhere.id.clone()]
    );
    let waiting_filter = ConversationFilter { status: Some(ConversationStatus::WaitingForYou), ..Default::default() };
    assert_eq!(ids(waiting_filter), vec![waiting.id.clone()]);
    let by_agent = ConversationFilter { agent_id: Some(other_agent.id.clone()), ..Default::default() };
    assert_eq!(ids(by_agent), vec![elsewhere.id.clone()]);
    let by_origin = ConversationFilter { origin: Some(OUTREACH_ORIGIN.into()), ..Default::default() };
    assert_eq!(ids(by_origin), vec![from_outreach.id.clone()]);
    assert!(matches!(
        harness.conversations.list_conversations(&ConversationFilter { limit: Some(0), ..Default::default() }),
        Err(AppError::InvalidInput(_))
    ));

    let listed = harness.conversations.list_conversations(&ConversationFilter::default()).unwrap();
    assert_eq!(listed[0].last_message_text.as_deref(), Some("Halo"));
    assert_eq!(listed[0].customer_name, "+62 1");

    let counts = harness.conversations.count_conversations(None).unwrap();
    assert_eq!(
        counts,
        ConversationCounts {
            all: 3,
            bot_answering: 2,
            waiting_for_you: 1,
            you_replying: 0,
            closed: 0,
            from_outreach: 1
        }
    );
    assert_eq!(harness.conversations.count_conversations(Some(&other_agent.id)).unwrap().all, 1);
}

#[test]
fn describes_known_handoff_reasons_in_plain_words() {
    assert_eq!(describe_handoff_reason(Some("order_to_confirm")), "order ready to confirm");
    assert_eq!(describe_handoff_reason(Some("wants_a_discount")), "wants a discount");
    assert_eq!(describe_handoff_reason(None), "needs your reply");
}

/// A model that streams `text` word by word: the first word after `first_token`, then one word every `per_token`.
#[derive(Debug)]
struct PacedModel {
    text: String,
    first_token: std::time::Duration,
    per_token: std::time::Duration,
}

impl ChatModel for PacedModel {
    fn chat(
        &self,
        _request: graphrt_llm::ChatRequest,
    ) -> BoxFuture<'_, Result<graphrt_llm::ChatStream, graphrt_llm::LlmError>> {
        let words: Vec<String> = self.text.split_inclusive(' ').map(str::to_owned).collect();
        let (first_token, per_token) = (self.first_token, self.per_token);
        Box::pin(async move {
            let deltas = futures::stream::iter(words.into_iter().enumerate()).then(move |(index, word)| async move {
                tokio::time::sleep(if index == 0 { first_token } else { per_token }).await;
                Ok(graphrt_llm::ChatDelta::Text(word))
            });
            let finish = futures::stream::iter([Ok(graphrt_llm::ChatDelta::Finish(graphrt_llm::FinishReason::Stop))]);
            let stream: graphrt_llm::ChatStream = Box::pin(deltas.chain(finish));
            Ok(stream)
        })
    }
}

#[tokio::test]
async fn reply_streams_as_drafts_before_the_finished_message() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let sink = Arc::new(CollectingSink::default());
    let model = Arc::new(PacedModel {
        text: "Ada kak, paket nasi box mulai 25 ribu.".to_owned(),
        first_token: std::time::Duration::from_millis(5),
        // Slower than the draft interval, so every word arrives as its own draft.
        per_token: bot::DRAFT_INTERVAL + std::time::Duration::from_millis(10),
    });
    let conversations = ConversationManager::new(db.clone(), credentials, sink.clone())
        .with_model_registry_source(Arc::new(FixedModelSource { model }));
    let agent = create_chatbot(&db, MEMORY_FLOW);
    let conversation = conversations.start_test_conversation(&agent.id).unwrap().conversation;

    conversations.send_customer_message(&conversation.id, "Ada nasi box?").await.unwrap();

    let payloads = sink.payloads.lock().unwrap();
    let drafts: Vec<&str> = payloads
        .iter()
        .filter(|payload| payload.kind == ConversationEventKind::ReplyDraft)
        .map(|payload| payload.draft.as_deref().unwrap())
        .collect();
    assert_eq!(drafts.first(), Some(&"Ada "));
    assert!(drafts.len() >= 3, "one draft per word, got {drafts:?}");
    assert!(drafts.windows(2).all(|pair| pair[1].starts_with(pair[0])), "drafts only grow: {drafts:?}");
    let last_draft = payloads.iter().rposition(|payload| payload.kind == ConversationEventKind::ReplyDraft).unwrap();
    let bot_message = payloads
        .iter()
        .position(|payload| payload.message.as_ref().is_some_and(|message| message.author == MessageAuthor::Bot))
        .unwrap();
    assert!(last_draft < bot_message, "the finished reply comes after its drafts");
    assert_eq!(payloads[bot_message].message.as_ref().unwrap().text, "Ada kak, paket nasi box mulai 25 ribu.");
    assert!(payloads
        .iter()
        .all(|payload| payload.kind == ConversationEventKind::ReplyDraft || payload.draft.is_none()));
}

/// Records when each event arrived.
#[derive(Debug, Default)]
struct TimedSink {
    events: Mutex<Vec<(std::time::Instant, ConversationEventPayload)>>,
}

impl ConversationEventSink for TimedSink {
    fn send(&self, payload: ConversationEventPayload) {
        self.events.lock().unwrap().push((std::time::Instant::now(), payload));
    }
}

/// Times one bot reply with a model paced like a hosted one (first token after
/// 800 ms, then 40 words at 30 ms): when the customer first sees text, and when
/// the reply is complete. Run with `--ignored --nocapture`.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "timing report, not a check"]
async fn bot_reply_timing_report() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let sink = Arc::new(TimedSink::default());
    let text = "word ".repeat(40);
    let model = Arc::new(PacedModel {
        text: text.trim_end().to_owned(),
        first_token: std::time::Duration::from_millis(800),
        per_token: std::time::Duration::from_millis(30),
    });
    let conversations = ConversationManager::new(db.clone(), credentials, sink.clone())
        .with_model_registry_source(Arc::new(FixedModelSource { model }));
    let agent = create_chatbot(&db, MEMORY_FLOW);
    let conversation = conversations.start_test_conversation(&agent.id).unwrap().conversation;
    let started = std::time::Instant::now();
    conversations.send_customer_message(&conversation.id, "Ada nasi box?").await.unwrap();
    let total = started.elapsed();
    let events = sink.events.lock().unwrap();
    let first_text = events
        .iter()
        .filter(|(at, _)| *at >= started)
        .find(|(_, payload)| {
            payload.message.as_ref().is_some_and(|message| message.author == MessageAuthor::Bot)
                || payload.draft.as_deref().is_some_and(|draft| !draft.is_empty())
        })
        .map(|(at, _)| at.duration_since(started));
    println!("TIMING first visible bot text: {first_text:?}, reply complete: {total:?}");
}

/// Replies with a fixed text, a card with two buttons and a chart (run outputs), and echoes
/// what the bot was told plus the card button it stands for.
const VISUALS_FLOW: &str = r#"
version: "1"
name: chatbot-visuals
conversation:
  - name: card
    type: object
    value:
      $ui: adaptive_card
      version: 1
      title: Delivery
      card:
        type: AdaptiveCard
        version: "1.5"
        body:
          - { type: TextBlock, text: "Deliver **today**?", wrap: true }
        actions:
          - { type: Action.Submit, id: deliver_today, title: "Yes, today" }
          - { type: Action.Submit, id: deliver_later, title: Later }
  - name: chart
    type: object
    value:
      $ui: chart
      version: 1
      type: bar
      title: Orders
      x: { values: [Mon, Tue] }
      series: [{ name: Boxes, values: [12, 18] }]
  - name: broken
    type: object
    value: { $ui: chart, version: 1, type: bar }
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: reply
      type: answer
      answer: "Heard: {{#start.message#}} [{{#sys.card_action#}}]"
    - id: end
      type: end
      outputs:
        - { variable: card, value_selector: [conversation, card] }
        - { variable: chart, value_selector: [conversation, chart] }
        - { variable: broken, value_selector: [conversation, broken] }
  edges:
    - { source: start, target: reply }
    - { source: reply, target: end }
"#;

#[tokio::test]
async fn the_app_gets_a_replys_blocks_and_a_card_button_answers_it() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, VISUALS_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;

    let detail = harness.conversations.send_customer_message(&conversation.id, "Hi").await.unwrap();
    let reply = detail.messages.last().unwrap();
    assert_eq!(reply.author, MessageAuthor::Bot);
    assert_eq!(reply.text, "Heard: Hi []");
    // The valid blocks, in output order; the broken chart is dropped, not shown.
    let kinds: Vec<&str> =
        reply.metadata["visuals"].as_array().unwrap().iter().map(|block| block["$ui"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["adaptive_card", "chart"]);
    assert_eq!(reply.metadata["choices"][0]["action"], "deliver_today");
    assert!(reply.metadata.get("textIsFallback").is_none());

    // A button pressed in the Try it panel: the bot reads the choice in words and gets its id.
    let answer = visuals::CardAnswer {
        action: Some("deliver_later".into()),
        title: "Later".into(),
        values: json!({"note": "after 5 pm"}).as_object().cloned().unwrap(),
    };
    let detail = harness.conversations.send_customer_card_answer(&conversation.id, answer.clone()).await.unwrap();
    let texts = authors_and_texts(&detail);
    assert_eq!(texts[2], (MessageAuthor::Customer, "Later\nnote: after 5 pm".to_owned()));
    assert_eq!(texts[3], (MessageAuthor::Bot, "Heard: Later\nnote: after 5 pm [deliver_later]".to_owned()));
    assert_eq!(detail.messages[2].metadata["cardAction"]["action"], "deliver_later");

    // Typing a number works in the app too.
    let detail = harness.conversations.send_customer_message(&conversation.id, "1").await.unwrap();
    assert_eq!(detail.messages[4].text, "1");
    assert_eq!(detail.messages[5].text, "Heard: Yes, today [deliver_today]");
}

#[tokio::test]
async fn a_card_answer_needs_a_card_in_the_bots_last_message() {
    let harness = harness_with_answers(&["Halo kak"]);
    let agent = create_chatbot(&harness.db, MEMORY_FLOW);
    let conversation = harness.conversations.start_test_conversation(&agent.id).unwrap().conversation;
    harness.conversations.send_customer_message(&conversation.id, "Hi").await.unwrap();
    let answer = visuals::CardAnswer { action: Some("ok".into()), title: "OK".into(), values: Default::default() };
    let refused = harness.conversations.send_customer_card_answer(&conversation.id, answer).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))));
    assert_eq!(harness.conversations.get_conversation(&conversation.id).unwrap().messages.len(), 2);
}

#[tokio::test]
async fn a_text_channel_gets_blocks_as_text_and_a_number_picks_a_card_button() {
    let harness = harness_with_answers(&[]);
    let agent = create_chatbot(&harness.db, VISUALS_FLOW);
    let detail = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": "Hi"}))
        .await
        .unwrap();
    let sent = harness.channel.sent.lock().unwrap().clone();
    assert_eq!(
        sent,
        [(
            MessageAuthor::Bot,
            "Heard: Hi []\n\n*Delivery*\nDeliver *today*?\n\nReply with a number:\n1. Yes, today\n2. Later\n\n*Orders*\nMon: 12\nTue: 18"
                .to_owned()
        )]
    );
    assert!(harness.channel.images.lock().unwrap().is_empty());
    // The app still stores the blocks, so the Inbox shows the card and the chart.
    assert_eq!(detail.messages[1].text, "Heard: Hi []");
    assert_eq!(detail.messages[1].metadata["visuals"].as_array().unwrap().len(), 2);

    let detail = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": " 2. "}))
        .await
        .unwrap();
    assert_eq!(detail.messages[2].text, "2.");
    assert_eq!(
        detail.messages[2].metadata["cardAction"],
        json!({"action": "deliver_later", "title": "Later", "values": {}})
    );
    assert_eq!(detail.messages[3].text, "Heard: Later [deliver_later]");

    // Anything else is an ordinary message.
    let detail = harness
        .conversations
        .receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": "How much is one box?"}))
        .await
        .unwrap();
    assert_eq!(detail.messages[4].metadata, json!({}));
    assert_eq!(detail.messages[5].text, "Heard: How much is one box? []");
}

#[tokio::test]
async fn a_media_channel_gets_the_chart_as_an_image() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    let channel = Arc::new(RecordingChannel { sends_images: true, ..RecordingChannel::default() });
    let conversations = ConversationManager::new(db.clone(), credentials, Arc::new(CollectingSink::default()))
        .with_channel(channel.clone());
    let agent = create_chatbot(&db, VISUALS_FLOW);
    conversations.receive_inbound("whatsapp", &agent.id, &json!({"from": "+62 800", "body": "Hi"})).await.unwrap();

    let images = channel.images.lock().unwrap().clone();
    assert_eq!(images.len(), 1);
    assert!(images[0].png.starts_with(b"\x89PNG"));
    assert_eq!(images[0].caption.as_deref(), Some("Orders"));
    let sent = channel.sent.lock().unwrap().clone();
    assert!(sent[0].1.ends_with("1. Yes, today\n2. Later"), "{}", sent[0].1);
    assert!(!sent[0].1.contains("Orders"));
}

mod blocks_and_files;
