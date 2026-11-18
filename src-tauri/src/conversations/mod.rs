//! Chatbot conversations: customers write, the chatbot agent answers, and the
//! owner takes over when the bot hands a chat over.
//!
//! Layout:
//! - [`ConversationManager`] (this file): the public API behind the Inbox,
//!   the chat detail and the chatbot's "Try it" panel.
//! - [`models`]: conversations and messages as stored and sent to the UI.
//! - `store`: SQLite tables `conversations` and `conversation_messages`.
//! - [`bot`]: one bot turn on graphrt (reply, memory, hand-off outputs).
//! - [`channel`]: the [`channel::ChannelAdapter`] trait; only the in-app
//!   `test` channel exists so far.
//!
//! Status flow:
//! ```text
//! bot_answering --handoff output / bot error / bot paused--> waiting_for_you
//! bot_answering | waiting_for_you --take over / owner reply--> you_replying
//! waiting_for_you | you_replying --hand back--> bot_answering
//! any --close--> closed --customer writes again--> bot_answering
//! ```
//! The bot answers only in `bot_answering`. Turns of one conversation run one
//! at a time, and a reply that finishes after the owner took over is dropped.
//!
//! Bot turns are not stored as runs: a chat produces one run per message,
//! which would bury the Runs screen, and the messages already keep what the
//! customer saw. The conversation stores the workflow's `conversation.*`
//! variables between turns instead.
//!
//! Every change is sent to the UI as the Tauri event [`CONVERSATION_EVENT`].

pub mod bot;
pub mod channel;
pub mod models;
mod store;
pub mod tauri_sink;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;

use self::bot::{run_bot_turn, BotTurn};
use self::channel::{ChannelAdapter, ChannelRegistry, OutboundMessage, TEST_CHANNEL};
use self::models::{
    Conversation, ConversationCounts, ConversationDetail, ConversationFilter, ConversationStatus, Message,
    MessageAuthor, NewConversation,
};
pub use self::store::OUTREACH_ORIGIN;
use crate::credentials::CredentialStore;
use crate::engine::{prepare_engine_and_env, KeychainModelRegistrySource, ModelRegistrySource};
use crate::error::{AppError, AppResult};
use crate::storage::models::AgentKind;
use crate::storage::Database;

/// Name of the Tauri event carrying [`ConversationEventPayload`].
pub const CONVERSATION_EVENT: &str = "conversation-event";

/// Hand-off reason recorded when the bot could not run.
pub const BOT_ERROR_REASON: &str = "bot_error";
/// Hand-off reason recorded when a customer writes while the Inbox switch has the bot paused.
pub const BOT_PAUSED_REASON: &str = "bot_paused";

const TEST_CUSTOMER_NAME: &str = "Test customer";

/// What changed in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationEventKind {
    Created,
    MessageAdded,
    StatusChanged,
}

/// Sent to the frontend whenever a conversation gets a message or changes status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEventPayload {
    pub kind: ConversationEventKind,
    pub conversation_id: String,
    pub agent_id: String,
    pub status: ConversationStatus,
    /// The new message, for `message_added`.
    pub message: Option<Message>,
}

/// Delivers conversation events to the UI. The app uses a Tauri emitter; tests collect them.
pub trait ConversationEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, payload: ConversationEventPayload);
}

/// Settings key of the Inbox "Bot is answering" switch for one agent.
fn bot_enabled_setting_key(agent_id: &str) -> String {
    format!("chatbot.bot_enabled.{agent_id}")
}

/// Runs chatbot conversations. One per app, shared as `Arc<ConversationManager>`.
#[derive(Debug)]
pub struct ConversationManager {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    sink: Arc<dyn ConversationEventSink>,
    model_source: Arc<dyn ModelRegistrySource>,
    channels: ChannelRegistry,
    /// One lock per conversation so its bot turns never overlap.
    turn_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl ConversationManager {
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>, sink: Arc<dyn ConversationEventSink>) -> Self {
        Self {
            db,
            credentials,
            sink,
            model_source: Arc::new(KeychainModelRegistrySource),
            channels: ChannelRegistry::default(),
            turn_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Replaces where model clients come from (tests use scripted mock models).
    pub fn with_model_registry_source(mut self, model_source: Arc<dyn ModelRegistrySource>) -> Self {
        self.model_source = model_source;
        self
    }

    /// Registers a channel adapter (WhatsApp, Telegram...) next to the test channel.
    pub fn with_channel(mut self, adapter: Arc<dyn ChannelAdapter>) -> Self {
        self.channels = self.channels.with(adapter);
        self
    }

    /// # Errors
    /// `InvalidInput` for a non-positive limit.
    pub fn list_conversations(&self, filter: &ConversationFilter) -> AppResult<Vec<Conversation>> {
        self.db.list_conversations(filter)
    }

    pub fn count_conversations(&self, agent_id: Option<&str>) -> AppResult<ConversationCounts> {
        self.db.count_conversations(agent_id)
    }

    /// # Errors
    /// `NotFound` for an unknown conversation.
    pub fn get_conversation(&self, conversation_id: &str) -> AppResult<ConversationDetail> {
        Ok(ConversationDetail {
            conversation: self.db.get_conversation(conversation_id)?,
            messages: self.db.list_conversation_messages(conversation_id)?,
        })
    }

    /// Opens a new chat on the in-app test channel (the "Try it" panel).
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` when it is not a chatbot.
    pub fn start_test_conversation(&self, agent_id: &str) -> AppResult<ConversationDetail> {
        self.ensure_chatbot(agent_id)?;
        let conversation = self.db.insert_conversation(&NewConversation {
            agent_id: agent_id.to_owned(),
            channel: TEST_CHANNEL.to_owned(),
            customer_name: TEST_CUSTOMER_NAME.to_owned(),
            customer_handle: format!("test-{}", uuid::Uuid::new_v4().simple()),
            origin: None,
        })?;
        self.emit(ConversationEventKind::Created, &conversation, None);
        Ok(ConversationDetail { conversation, messages: Vec::new() })
    }

    /// A message a channel delivered: finds the customer's open chat with the
    /// agent (or opens one) and handles it like [`Self::send_customer_message`].
    ///
    /// # Errors
    /// `InvalidInput` for an unknown channel or a payload it cannot read;
    /// `NotFound` / `InvalidInput` when the agent is missing or not a chatbot.
    pub async fn receive_inbound(
        &self,
        channel_name: &str,
        agent_id: &str,
        payload: &serde_json::Value,
    ) -> AppResult<ConversationDetail> {
        let adapter = self.channels.get(channel_name)?;
        let inbound = adapter.parse_inbound(payload)?;
        self.ensure_chatbot(agent_id)?;
        let conversation = match self.db.find_open_conversation(agent_id, adapter.name(), &inbound.customer_handle)? {
            Some(conversation) => conversation,
            None => {
                let conversation = self.db.insert_conversation(&NewConversation {
                    agent_id: agent_id.to_owned(),
                    channel: adapter.name().to_owned(),
                    customer_name: inbound.customer_name.clone().unwrap_or_default(),
                    customer_handle: inbound.customer_handle.clone(),
                    origin: None,
                })?;
                self.emit(ConversationEventKind::Created, &conversation, None);
                conversation
            }
        };
        self.send_customer_message(&conversation.id, &inbound.text).await
    }

    /// Stores a customer message and, while the bot is answering, runs the
    /// bot's turn before returning. A closed chat reopens with the bot answering.
    ///
    /// Bot failures do not fail the call: the chat is handed to the owner with
    /// a system message explaining why.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` for blank text.
    pub async fn send_customer_message(&self, conversation_id: &str, text: &str) -> AppResult<ConversationDetail> {
        let mut conversation = self.db.get_conversation(conversation_id)?;
        if conversation.status == ConversationStatus::Closed {
            conversation = self.change_status(&conversation, ConversationStatus::BotAnswering, None)?;
        }
        let message =
            self.db.insert_conversation_message(conversation_id, MessageAuthor::Customer, text, &json!({}))?;
        self.emit(ConversationEventKind::MessageAdded, &conversation, Some(message.clone()));

        if conversation.status == ConversationStatus::BotAnswering {
            if self.bot_answers(&conversation)? {
                self.answer_as_bot(conversation_id, &message.text).await?;
            } else {
                self.hand_off(&conversation, Some(BOT_PAUSED_REASON), "Bot is paused · waiting for you")?;
            }
        }
        self.get_conversation(conversation_id)
    }

    /// The owner takes the chat: the bot stops answering it.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` when it is closed.
    pub fn take_over(&self, conversation_id: &str) -> AppResult<Conversation> {
        let conversation = self.db.get_conversation(conversation_id)?;
        match conversation.status {
            ConversationStatus::YouReplying => Ok(conversation),
            ConversationStatus::Closed => Err(AppError::InvalidInput("this chat is closed".into())),
            ConversationStatus::BotAnswering | ConversationStatus::WaitingForYou => {
                let conversation = self.change_status(&conversation, ConversationStatus::YouReplying, None)?;
                self.add_system_message(&conversation, "You took over · bot paused", json!({}))?;
                Ok(conversation)
            }
        }
    }

    /// Gives the chat back to the bot; it answers the customer's next message.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` when the bot is
    /// already answering or the chat is closed.
    pub fn hand_back(&self, conversation_id: &str) -> AppResult<Conversation> {
        let conversation = self.db.get_conversation(conversation_id)?;
        match conversation.status {
            ConversationStatus::WaitingForYou | ConversationStatus::YouReplying => {
                let conversation = self.change_status(&conversation, ConversationStatus::BotAnswering, None)?;
                self.add_system_message(&conversation, "You handed this back to the bot", json!({}))?;
                Ok(conversation)
            }
            ConversationStatus::BotAnswering => Err(AppError::InvalidInput("the bot is already answering".into())),
            ConversationStatus::Closed => Err(AppError::InvalidInput("this chat is closed".into())),
        }
    }

    /// Sends the owner's reply to the customer. Replying takes the chat over.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` for blank text or a closed chat.
    pub async fn send_operator_reply(&self, conversation_id: &str, text: &str) -> AppResult<Message> {
        if text.trim().is_empty() {
            return Err(AppError::InvalidInput("write a reply first".into()));
        }
        let current = self.db.get_conversation(conversation_id)?;
        let conversation =
            if current.status == ConversationStatus::YouReplying { current } else { self.take_over(conversation_id)? };
        self.deliver_and_store(&conversation, MessageAuthor::Operator, text).await
    }

    /// Closes the chat. A later customer message reopens it.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation.
    pub fn close_conversation(&self, conversation_id: &str) -> AppResult<Conversation> {
        let conversation = self.db.get_conversation(conversation_id)?;
        if conversation.status == ConversationStatus::Closed {
            return Ok(conversation);
        }
        let conversation = self.change_status(&conversation, ConversationStatus::Closed, None)?;
        self.add_system_message(&conversation, "Chat closed", json!({}))?;
        if let Ok(mut turn_locks) = self.turn_locks.lock() {
            turn_locks.remove(conversation_id);
        }
        Ok(conversation)
    }

    /// The Inbox "Bot is answering" switch. While off, customer messages on real
    /// channels wait for the owner; the in-app test channel always gets answers.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn set_bot_enabled(&self, agent_id: &str, enabled: bool) -> AppResult<bool> {
        self.db.get_agent(agent_id)?;
        self.db.set_setting(&bot_enabled_setting_key(agent_id), if enabled { "true" } else { "false" })?;
        Ok(enabled)
    }

    /// Whether the bot answers for `agent_id` (on unless switched off).
    pub fn is_bot_enabled(&self, agent_id: &str) -> AppResult<bool> {
        Ok(self.db.get_setting(&bot_enabled_setting_key(agent_id))?.as_deref() != Some("false"))
    }

    fn ensure_chatbot(&self, agent_id: &str) -> AppResult<()> {
        let agent = self.db.get_agent(agent_id)?;
        if agent.kind != AgentKind::Chatbot {
            return Err(AppError::InvalidInput(format!("{} is not a chatbot", agent.name)));
        }
        Ok(())
    }

    fn bot_answers(&self, conversation: &Conversation) -> AppResult<bool> {
        Ok(conversation.channel == TEST_CHANNEL || self.is_bot_enabled(&conversation.agent_id)?)
    }

    fn turn_lock(&self, conversation_id: &str) -> AppResult<Arc<tokio::sync::Mutex<()>>> {
        let mut turn_locks =
            self.turn_locks.lock().map_err(|_| AppError::Internal("conversation turn table lock poisoned".into()))?;
        Ok(turn_locks.entry(conversation_id.to_owned()).or_default().clone())
    }

    /// Runs one bot turn and records its reply, memory and hand-off.
    async fn answer_as_bot(&self, conversation_id: &str, message_text: &str) -> AppResult<()> {
        let turn_lock = self.turn_lock(conversation_id)?;
        let _turn_guard = turn_lock.lock().await;
        // Read again under the lock: the previous turn may have changed variables or status.
        let conversation = self.db.get_conversation(conversation_id)?;
        if conversation.status != ConversationStatus::BotAnswering {
            return Ok(());
        }
        let turn = match self.run_turn(&conversation, message_text).await {
            Ok(turn) => turn,
            Err(error) => {
                log::warn!("the bot of conversation {conversation_id} could not answer: {error}");
                let notice = format!("The bot could not answer · {error}");
                return self.hand_off(&conversation, Some(BOT_ERROR_REASON), &notice);
            }
        };
        self.record_turn(&conversation, turn).await
    }

    async fn run_turn(&self, conversation: &Conversation, message_text: &str) -> AppResult<BotTurn> {
        let agent = self.db.get_agent(&conversation.agent_id)?;
        let (engine, env) = prepare_engine_and_env(&agent.flow_yaml, &self.credentials, &self.db, &*self.model_source)?;
        run_bot_turn(&engine, env, conversation, message_text).await
    }

    async fn record_turn(&self, conversation: &Conversation, turn: BotTurn) -> AppResult<()> {
        let conversation = self.db.save_conversation_turn(
            &conversation.id,
            &turn.variables,
            turn.summary.as_deref(),
            turn.suggested_reply.as_deref(),
        )?;
        if conversation.status != ConversationStatus::BotAnswering {
            log::info!("dropped a bot reply in conversation {}: the owner took over", conversation.id);
            return Ok(());
        }
        if !turn.reply_text.is_empty() {
            self.deliver_and_store(&conversation, MessageAuthor::Bot, &turn.reply_text).await?;
        }
        if let Some(handoff) = turn.handoff {
            let reason = handoff.reason.as_deref();
            let notice = format!("Bot handed this to you · {}", describe_handoff_reason(reason));
            self.hand_off(&conversation, reason, &notice)?;
        }
        Ok(())
    }

    /// Sends a bot or owner message on the conversation's channel, then stores it.
    /// A delivery failure is kept in the message metadata rather than lost.
    async fn deliver_and_store(
        &self,
        conversation: &Conversation,
        author: MessageAuthor,
        text: &str,
    ) -> AppResult<Message> {
        let metadata = match self.channels.get(&conversation.channel) {
            Ok(adapter) => match adapter.send(OutboundMessage { conversation, author, text }).await {
                Ok(()) => json!({}),
                Err(error) => {
                    log::warn!("could not deliver a message in conversation {}: {error}", conversation.id);
                    json!({ "deliveryError": error.to_string() })
                }
            },
            Err(error) => json!({ "deliveryError": error.to_string() }),
        };
        let message = self.db.insert_conversation_message(&conversation.id, author, text, &metadata)?;
        self.emit(ConversationEventKind::MessageAdded, conversation, Some(message.clone()));
        Ok(message)
    }

    fn hand_off(&self, conversation: &Conversation, reason: Option<&str>, notice: &str) -> AppResult<()> {
        let conversation = self.change_status(conversation, ConversationStatus::WaitingForYou, reason)?;
        self.add_system_message(&conversation, notice, json!({ "handoffReason": reason }))?;
        Ok(())
    }

    fn change_status(
        &self,
        conversation: &Conversation,
        status: ConversationStatus,
        handoff_reason: Option<&str>,
    ) -> AppResult<Conversation> {
        let conversation = self.db.set_conversation_status(&conversation.id, status, handoff_reason)?;
        self.emit(ConversationEventKind::StatusChanged, &conversation, None);
        Ok(conversation)
    }

    fn add_system_message(
        &self,
        conversation: &Conversation,
        text: &str,
        metadata: serde_json::Value,
    ) -> AppResult<Message> {
        let message = self.db.insert_conversation_message(&conversation.id, MessageAuthor::System, text, &metadata)?;
        self.emit(ConversationEventKind::MessageAdded, conversation, Some(message.clone()));
        Ok(message)
    }

    fn emit(&self, kind: ConversationEventKind, conversation: &Conversation, message: Option<Message>) {
        self.sink.send(ConversationEventPayload {
            kind,
            conversation_id: conversation.id.clone(),
            agent_id: conversation.agent_id.clone(),
            status: conversation.status,
            message,
        });
    }
}

/// Plain words for the hand-off reasons the builder guide suggests; other
/// reasons are shown as the workflow wrote them.
pub fn describe_handoff_reason(reason: Option<&str>) -> String {
    match reason {
        Some("order_to_confirm") => "order ready to confirm".into(),
        Some("asked_for_person") => "customer asked for a person".into(),
        Some("not_sure") => "answer not in the knowledge".into(),
        Some(BOT_ERROR_REASON) => "the bot could not answer".into(),
        Some(BOT_PAUSED_REASON) => "the bot is paused".into(),
        Some(other) => other.replace('_', " "),
        None => "needs your reply".into(),
    }
}
