//! The customer channels against fake servers: a fake Telegram Bot API, a fake Graph API,
//! a fake online chatbot (`graphrt serve --channel whatsapp`), and a scripted
//! `whatsapp-web` plugin. Real HTTP on `127.0.0.1`, the real reply pipeline, a scripted model.

mod telegram_tests;
mod whatsapp_online_tests;
mod whatsapp_web_tests;

use std::sync::{Arc, Mutex};

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};

use crate::agent_files::AgentFiles;
use crate::conversations::models::{ConversationDetail, ConversationFilter};
use crate::conversations::{ConversationEventPayload, ConversationEventSink, ConversationManager};
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::ModelRegistrySource;
use crate::error::AppResult;
use crate::storage::models::{Agent, AgentKind, NewAgent};
use crate::storage::Database;

/// Answers with the model's text.
pub(super) const REPLY_FLOW: &str = r#"
version: "1"
name: channel-bot
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

/// Reads files (an `agent` step with file tools) and shows a chart and a card with two choices.
pub(super) const FILES_AND_CHART_FLOW: &str = r#"
version: "1"
name: channel-files-bot
conversation:
  - name: chart
    type: object
    value:
      $ui: chart
      version: 1
      type: bar
      title: Orders
      x: { values: [Mon, Tue] }
      series: [{ name: Boxes, values: [12, 18] }]
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
          - { type: TextBlock, text: "Deliver today?", wrap: true }
        actions:
          - { type: Action.Submit, id: deliver_today, title: "Yes, today" }
          - { type: Action.Submit, id: deliver_later, title: Later }
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
      tools: [files/*]
    - id: reply
      type: answer
      answer: "{{#assistant.text#}}"
    - id: end
      type: end
      outputs:
        - { variable: chart, value_selector: [conversation, chart] }
        - { variable: card, value_selector: [conversation, card] }
  edges:
    - { source: start, target: assistant }
    - { source: assistant, target: reply }
    - { source: reply, target: end }
"#;

#[derive(Debug, Default)]
pub(super) struct Events {
    pub payloads: Mutex<Vec<ConversationEventPayload>>,
}

impl ConversationEventSink for Events {
    fn send(&self, payload: ConversationEventPayload) {
        self.payloads.lock().unwrap().push(payload);
    }
}

#[derive(Debug)]
pub(super) struct FixedModel {
    pub model: Arc<dyn ChatModel>,
}

impl ModelRegistrySource for FixedModel {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.model.clone()))
    }
}

/// What every channel test needs: storage, an in-memory credential store, a scripted model
/// and a chatbot.
pub(super) struct Base {
    pub _home: tempfile::TempDir,
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub model: Arc<MockModel>,
    pub agent_files: Arc<AgentFiles>,
    pub agent: Agent,
}

impl Base {
    pub fn new(flow_yaml: &str) -> Self {
        let home = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open_in_memory().unwrap());
        let credentials = Arc::new(CredentialStore::in_memory());
        credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
        let agent = db
            .create_agent(NewAgent {
                name: "Toko Kue".into(),
                kind: AgentKind::Chatbot,
                description: "Answers customers".into(),
                flow_yaml: flow_yaml.into(),
            })
            .unwrap();
        Self {
            agent_files: Arc::new(AgentFiles::new(home.path())),
            _home: home,
            db,
            credentials,
            model: Arc::new(MockModel::new(Vec::new())),
            agent,
        }
    }

    /// The manager with these channel adapters.
    pub fn manager(
        &self,
        adapters: Vec<Arc<dyn crate::conversations::channel::ChannelAdapter>>,
    ) -> Arc<ConversationManager> {
        let mut manager =
            ConversationManager::new(self.db.clone(), self.credentials.clone(), Arc::new(Events::default()))
                .with_model_registry_source(Arc::new(FixedModel { model: self.model.clone() }))
                .with_agent_files(self.agent_files.clone());
        for adapter in adapters {
            manager = manager.with_channel(adapter);
        }
        Arc::new(manager)
    }

    /// The only conversation on `channel`, with its messages.
    pub fn only_chat(&self, manager: &ConversationManager, channel: &str) -> ConversationDetail {
        let filter = ConversationFilter { channel: Some(channel.into()), ..ConversationFilter::default() };
        let conversations = manager.list_conversations(&filter).unwrap();
        assert_eq!(conversations.len(), 1, "{conversations:?}");
        manager.get_conversation(&conversations[0].id).unwrap()
    }

    pub fn chats(&self, manager: &ConversationManager, channel: &str) -> usize {
        let filter = ConversationFilter { channel: Some(channel.into()), ..ConversationFilter::default() };
        manager.list_conversations(&filter).unwrap().len()
    }
}
