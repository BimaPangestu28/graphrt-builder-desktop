//! A bot reply that carries UI blocks and files in the same message: the app gets both,
//! a text channel gets the blocks written out, and a card button still answers it.

use super::*;
use crate::agent_files::cards::FileCardKind;
use crate::agent_files::{AgentFiles, FileCard};
use crate::conversations::attachments::{FILES_KEY, FILES_ONLY_KEY};

/// A chatbot whose `agent` step makes files and whose outputs show a card and a chart.
const BLOCKS_AND_FILES_FLOW: &str = r#"
version: "1"
name: blocks-and-files-chatbot
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
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: assistant
      type: agent
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.message#}}"
      tools: [files/*, documents/*]
    - id: reply
      type: answer
      answer: "{{#assistant.text#}}"
    - id: end
      type: end
      outputs:
        - { variable: card, value_selector: [conversation, card] }
        - { variable: chart, value_selector: [conversation, chart] }
  edges:
    - { source: start, target: assistant }
    - { source: assistant, target: reply }
    - { source: reply, target: end }
"#;

const WRITE_QUOTE: (&str, &str, &str) = ("c1", "write", r#"{"path":"quotes/quote.md","content":"50 boxes, Friday"}"#);

struct FilesHarness {
    _home: tempfile::TempDir,
    model: Arc<MockModel>,
    channel: Arc<RecordingChannel>,
    conversations: ConversationManager,
    agent: Agent,
}

fn files_harness() -> FilesHarness {
    let home = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(Vec::new()));
    let channel = Arc::new(RecordingChannel::default());
    let conversations = ConversationManager::new(db.clone(), credentials, Arc::new(CollectingSink::default()))
        .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }))
        .with_agent_files(Arc::new(AgentFiles::new(&home.path().join("app-data"))))
        .with_channel(channel.clone());
    let agent = create_chatbot(&db, BLOCKS_AND_FILES_FLOW);
    FilesHarness { _home: home, model, channel, conversations, agent }
}

fn block_kinds(message: &Message) -> Vec<&str> {
    let blocks = message.metadata[visuals::VISUALS_KEY].as_array().map(Vec::as_slice).unwrap_or_default();
    blocks.iter().filter_map(|block| block["$ui"].as_str()).collect()
}

fn file_cards(message: &Message) -> Vec<FileCard> {
    serde_json::from_value(message.metadata[FILES_KEY].clone()).unwrap()
}

#[tokio::test]
async fn a_reply_with_text_carries_its_files_and_its_blocks_together() {
    let harness = files_harness();
    let conversation = harness.conversations.start_test_conversation(&harness.agent.id).unwrap().conversation;
    harness.model.push(MockModel::tool_calls(&[WRITE_QUOTE]));
    harness.model.push(MockModel::text("Here is your quote."));

    let detail = harness.conversations.send_customer_message(&conversation.id, "Quote please").await.unwrap();
    let reply = detail.messages.last().unwrap();
    assert_eq!((reply.author, reply.text.as_str()), (MessageAuthor::Bot, "Here is your quote."));

    // One message holds the file card and the blocks; neither replaces the text.
    let files = file_cards(reply);
    let [quote] = files.as_slice() else { panic!("one file, got {files:?}") };
    assert_eq!((quote.name.as_str(), quote.kind), ("quote.md", FileCardKind::Text));
    assert_eq!(block_kinds(reply), ["adaptive_card", "chart"]);
    assert_eq!(reply.metadata[visuals::CHOICES_KEY][1]["action"], "deliver_later");
    assert!(reply.metadata.get(FILES_ONLY_KEY).is_none());
    assert!(reply.metadata.get(visuals::TEXT_IS_FALLBACK_KEY).is_none());

    // The card of a message that also has files is still answered by its button.
    harness.model.push(MockModel::text("Later it is."));
    let answer =
        visuals::CardAnswer { action: Some("deliver_later".into()), title: "Later".into(), values: Default::default() };
    let detail = harness.conversations.send_customer_card_answer(&conversation.id, answer).await.unwrap();
    assert_eq!(detail.messages[2].metadata[visuals::CARD_ACTION_KEY]["action"], "deliver_later");
    let second_reply = detail.messages.last().unwrap();
    assert_eq!(second_reply.text, "Later it is.");
    // That turn made no file: the reply has its blocks and no stale file card.
    assert!(second_reply.metadata.get(FILES_KEY).is_none());
    assert_eq!(block_kinds(second_reply), ["adaptive_card", "chart"]);
}

#[tokio::test]
async fn a_reply_without_text_keeps_its_files_and_its_blocks() {
    let harness = files_harness();
    let conversation = harness.conversations.start_test_conversation(&harness.agent.id).unwrap().conversation;
    harness.model.push(MockModel::tool_calls(&[WRITE_QUOTE]));
    harness.model.push(MockModel::text(""));

    let detail = harness.conversations.send_customer_message(&conversation.id, "Quote please").await.unwrap();
    let [_, reply] = detail.messages.as_slice() else {
        panic!("a customer message and one reply, got {:?}", detail.messages);
    };
    // The files give the message its text (their names), so the blocks do not replace it.
    assert_eq!(reply.text, "quote.md");
    assert_eq!(reply.metadata[FILES_ONLY_KEY], json!(true));
    assert!(reply.metadata.get(visuals::TEXT_IS_FALLBACK_KEY).is_none());
    assert_eq!(file_cards(reply).len(), 1);
    assert_eq!(block_kinds(reply), ["adaptive_card", "chart"]);
}

#[tokio::test]
async fn a_text_channel_gets_the_blocks_as_text_and_the_app_keeps_files_and_blocks() {
    let harness = files_harness();
    harness.model.push(MockModel::tool_calls(&[WRITE_QUOTE]));
    harness.model.push(MockModel::text("Here is your quote."));

    let inbound = json!({"from": "+62 800", "body": "Quote please"});
    let detail = harness.conversations.receive_inbound("whatsapp", &harness.agent.id, &inbound).await.unwrap();

    let sent = harness.channel.sent.lock().unwrap().clone();
    assert_eq!(
        sent,
        [(
            MessageAuthor::Bot,
            "Here is your quote.\n\n*Delivery*\nDeliver *today*?\n\nReply with a number:\n1. Yes, today\n2. Later\n\n*Orders*\nMon: 12\nTue: 18"
                .to_owned()
        )]
    );
    let reply = &detail.messages[1];
    assert_eq!(reply.text, "Here is your quote.");
    assert_eq!(file_cards(reply)[0].name, "quote.md");
    assert_eq!(block_kinds(reply), ["adaptive_card", "chart"]);
    assert!(reply.metadata.get("deliveryError").is_none());

    // A number still picks the card's button on a message that also carries a file.
    harness.model.push(MockModel::text("Today it is."));
    let inbound = json!({"from": "+62 800", "body": "1"});
    let detail = harness.conversations.receive_inbound("whatsapp", &harness.agent.id, &inbound).await.unwrap();
    assert_eq!(detail.messages[2].metadata[visuals::CARD_ACTION_KEY]["action"], "deliver_today");
    assert_eq!(detail.messages[3].text, "Today it is.");
}
