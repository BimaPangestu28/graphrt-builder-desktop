//! Chatbot conversations: customers write, the chatbot agent answers, and the
//! owner takes over when the bot hands a chat over.
//!
//! Layout:
//! - [`ConversationManager`] (this file): the public API behind the Inbox,
//!   the chat detail and the chatbot's "Try it" panel.
//! - [`models`]: conversations and messages as stored and sent to the UI.
//! - `store`: SQLite tables `conversations` and `conversation_messages`.
//! - [`bot`]: one bot turn on graphrt (reply, memory, hand-off outputs).
//! - [`channel`]: the [`channel::ChannelAdapter`] trait and the in-app `test` channel.
//! - [`channels`]: Telegram (long polling), personal WhatsApp (the `whatsapp-web`
//!   plugin, polled) and WhatsApp Business of an online chatbot (mirrored from it).
//! - [`inbound`]: messages a channel delivered: deduplicated, files taken, then answered.
//! - [`visuals`]: UI blocks in replies: shown by the app, written out as text (or
//!   PNG charts) for channels that cannot draw them, and numbered choices read back
//!   as card buttons.
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
//! On a customer channel a hand-off because the bot failed or its steps wait for an
//! approval also tells the customer, once, that a person will answer here.
//!
//! Bot turns are not stored as runs: a chat produces one run per message,
//! which would bury the Runs screen, and the messages already keep what the
//! customer saw. The conversation stores the workflow's `conversation.*`
//! variables between turns instead.
//!
//! Every change is sent to the UI as the Tauri event [`CONVERSATION_EVENT`].

pub mod attachments;
pub mod bot;
pub mod channel;
pub mod channels;
pub mod file_cleanup;
#[cfg(test)]
mod file_tests;
pub mod inbound;
pub mod models;
#[cfg(test)]
mod real_model_tests;
mod store;
pub mod tauri_sink;
#[cfg(test)]
mod tests;
pub mod visuals;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;

use self::attachments::CustomerTurn;
use self::bot::{run_bot_turn, BotTurn};
use self::channel::{
    ChannelAdapter, ChannelRegistry, DeliveryFailure, OutboundButton, OutboundFile, OutboundMessage, TEST_CHANNEL,
};
use self::models::{
    Conversation, ConversationCounts, ConversationDetail, ConversationFilter, ConversationStatus, Message,
    MessageAuthor, NewConversation,
};
pub use self::store::OUTREACH_ORIGIN;
use self::visuals::{compose_reply, CardAnswer, ChannelCapabilities};
use crate::agent_files::{AgentFiles, FileAccess, FileScope};
use crate::chatbot_setup::reply::prepare_reply;
use crate::credentials::CredentialStore;
use crate::desktop::app_settings::AppSettings;
use crate::engine::{agent_tools_for, prepare_engine_and_env, KeychainModelRegistrySource, ModelRegistrySource};
use crate::error::{AppError, AppResult};
use crate::storage::models::AgentKind;
use crate::storage::Database;

/// Name of the Tauri event carrying [`ConversationEventPayload`].
pub const CONVERSATION_EVENT: &str = "conversation-event";

/// Hand-off reason recorded when the bot could not run.
pub const BOT_ERROR_REASON: &str = "bot_error";
/// Notice shown to the owner when a bot turn finished without any reply.
const EMPTY_REPLY_NOTICE: &str =
    "The bot could not answer · its reply was empty. Check the steps that write the answer";
/// Hand-off reason recorded when a customer writes while the Inbox switch has the bot paused.
pub const BOT_PAUSED_REASON: &str = "bot_paused";
/// Hand-off reason recorded when the bot's steps stopped to wait for an approval.
pub const BOT_NEEDS_APPROVAL_REASON: &str = "bot_needs_approval";
/// Seconds between two "typing" signs while the bot works (Telegram shows one for five).
const TYPING_INTERVAL: std::time::Duration = std::time::Duration::from_secs(4);

const TEST_CUSTOMER_NAME: &str = "Test customer";

/// What changed in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationEventKind {
    Created,
    MessageAdded,
    StatusChanged,
    /// The bot's reply while it is being written (`draft`); the finished reply
    /// follows as `message_added`.
    ReplyDraft,
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
    /// The bot's reply so far, for `reply_draft`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<String>,
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
    /// The agents' file workspaces; `None` gives chatbots no file tools (some tests).
    agent_files: Option<Arc<AgentFiles>>,
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
            agent_files: None,
            turn_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Replaces where model clients come from (tests use scripted mock models).
    pub fn with_model_registry_source(mut self, model_source: Arc<dyn ModelRegistrySource>) -> Self {
        self.model_source = model_source;
        self
    }

    /// Gives chatbots the agents' file workspaces (`crate::agent_files`): customers can
    /// attach files and the bot can hand files back, each conversation in its own part.
    pub fn with_agent_files(mut self, agent_files: Arc<AgentFiles>) -> Self {
        self.agent_files = Some(agent_files);
        self
    }

    /// Registers a channel adapter (WhatsApp, Telegram...) next to the test channel.
    pub fn with_channel(mut self, adapter: Arc<dyn ChannelAdapter>) -> Self {
        self.channels = self.channels.with(adapter);
        self
    }

    /// Whether a channel adapter is registered under `channel_name` (the test channel always is).
    pub fn is_channel_connected(&self, channel_name: &str) -> bool {
        self.channels.contains(channel_name)
    }

    /// Whether `channel_name` is connected for the chatbot `agent_id` (its Telegram bot,
    /// the personal WhatsApp linked to it...).
    pub fn is_channel_connected_for(&self, channel_name: &str, agent_id: &str) -> bool {
        self.channels.find(channel_name).is_some_and(|adapter| adapter.is_connected_for(agent_id))
    }

    /// The account `agent_id` answers as on `channel_name`, e.g. `@toko_kue_bot`.
    pub fn channel_account(&self, channel_name: &str, agent_id: &str) -> Option<String> {
        self.channels.find(channel_name).and_then(|adapter| adapter.account_label(agent_id))
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
        if !crate::chatbot_setup::is_channel_enabled(&self.db, agent_id, adapter.name())? {
            return Err(AppError::InvalidInput(format!("this chatbot does not answer on {}", adapter.name())));
        }
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
    /// When the bot's last message offered numbered choices (a card on a text
    /// channel) and `text` is one of the numbers or titles, the message is read as
    /// that card button (see [`visuals::match_reply`]).
    ///
    /// Bot failures do not fail the call: the chat is handed to the owner with
    /// a system message explaining why.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` for blank text.
    pub async fn send_customer_message(&self, conversation_id: &str, text: &str) -> AppResult<ConversationDetail> {
        self.send_customer_message_with_files(conversation_id, text, &[]).await
    }

    /// [`Self::send_customer_message`] with files the customer attached:
    /// `attachment_references` name files stored for this conversation
    /// (`AgentFiles::attach_host_files`). The text may be blank when there are files.
    ///
    /// A message without files that is the number or the title of a choice in the bot's
    /// last message counts as pressing that card button (see `visuals::match_reply`).
    ///
    /// # Errors
    /// As [`Self::send_customer_message`], plus `InvalidInput` when a reference names no
    /// file attached to this conversation, or there are too many.
    pub async fn send_customer_message_with_files(
        &self,
        conversation_id: &str,
        text: &str,
        attachment_references: &[String],
    ) -> AppResult<ConversationDetail> {
        let answer = if attachment_references.is_empty() {
            self.last_exchange_message(conversation_id)?
                .filter(|message| message.author == MessageAuthor::Bot)
                .and_then(|message| visuals::match_reply(&message.metadata, text))
        } else {
            None
        };
        self.receive_customer_message(conversation_id, text, attachment_references, answer).await
    }

    /// The customer pressed a card button in the app (the "Try it" panel): stored as a
    /// customer message saying what was chosen, then answered like any message.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` for a bad answer, or when
    /// the bot's last message has no card.
    pub async fn send_customer_card_answer(
        &self,
        conversation_id: &str,
        answer: CardAnswer,
    ) -> AppResult<ConversationDetail> {
        let answer = answer.validated()?;
        let shows_card = self
            .last_exchange_message(conversation_id)?
            .is_some_and(|message| message.author == MessageAuthor::Bot && visuals::has_card(&message.metadata));
        if !shows_card {
            return Err(AppError::InvalidInput("this card can no longer be answered".into()));
        }
        let text = answer.as_message_text();
        self.receive_customer_message(conversation_id, &text, &[], Some(answer)).await
    }

    /// The latest customer, bot or owner message (system notices are skipped).
    fn last_exchange_message(&self, conversation_id: &str) -> AppResult<Option<Message>> {
        let messages = self.db.list_conversation_messages(conversation_id)?;
        Ok(messages.into_iter().rev().find(|message| message.author != MessageAuthor::System))
    }

    async fn receive_customer_message(
        &self,
        conversation_id: &str,
        text: &str,
        attachment_references: &[String],
        answer: Option<CardAnswer>,
    ) -> AppResult<ConversationDetail> {
        let conversation = self.db.get_conversation(conversation_id)?;
        let attached = self.attached_files(&conversation, attachment_references).await?;
        let customer_turn = CustomerTurn::new(text, attached);
        let conversation = self.store_customer_turn(conversation, &customer_turn, answer.as_ref(), json!({}))?;
        self.answer_customer_turn(&conversation, &customer_turn, answer.as_ref()).await?;
        self.get_conversation(conversation_id)
    }

    /// Stores a customer message (`extra_metadata` merged into its metadata) and reopens a
    /// closed chat with the bot answering. Returns the conversation as it is now.
    fn store_customer_turn(
        &self,
        mut conversation: Conversation,
        customer_turn: &CustomerTurn,
        answer: Option<&CardAnswer>,
        extra_metadata: serde_json::Value,
    ) -> AppResult<Conversation> {
        if conversation.status == ConversationStatus::Closed {
            conversation = self.change_status(&conversation, ConversationStatus::BotAnswering, None)?;
        }
        let mut metadata = customer_turn.metadata.clone();
        if let Some(fields) = metadata.as_object_mut() {
            if let Some(answer) = answer {
                fields.insert(visuals::CARD_ACTION_KEY.into(), json!(answer));
            }
            if let serde_json::Value::Object(extra) = extra_metadata {
                fields.extend(extra);
            }
        }
        let message = self.db.insert_conversation_message(
            &conversation.id,
            MessageAuthor::Customer,
            &customer_turn.stored_text,
            &metadata,
        )?;
        self.emit(ConversationEventKind::MessageAdded, &conversation, Some(message));
        Ok(conversation)
    }

    /// The bot's answer to a stored customer message, while the bot is answering. A
    /// channel whose chats another program answers (an online chatbot) gets none here.
    async fn answer_customer_turn(
        &self,
        conversation: &Conversation,
        customer_turn: &CustomerTurn,
        answer: Option<&CardAnswer>,
    ) -> AppResult<()> {
        if conversation.status != ConversationStatus::BotAnswering {
            return Ok(());
        }
        if self.channels.find(&conversation.channel).is_some_and(|adapter| adapter.answers_remotely()) {
            return Ok(());
        }
        if self.bot_answers(conversation)? {
            self.answer_as_bot(&conversation.id, customer_turn, answer).await
        } else {
            self.hand_off(conversation, Some(BOT_PAUSED_REASON), "Bot is paused · waiting for you")
        }
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
                self.tell_channel_about_status(&conversation);
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
                self.tell_channel_about_status(&conversation);
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
        self.send_operator_reply_with_files(conversation_id, text, &[]).await
    }

    /// [`Self::send_operator_reply`] with files the owner attached: `attachment_references`
    /// name files stored for this conversation (`AgentFiles::attach_host_files`). The text
    /// may be blank when there are files.
    ///
    /// # Errors
    /// As [`Self::send_operator_reply`], plus `InvalidInput` when a reference names no file
    /// attached to this conversation, or there are too many.
    pub async fn send_operator_reply_with_files(
        &self,
        conversation_id: &str,
        text: &str,
        attachment_references: &[String],
    ) -> AppResult<Message> {
        if text.trim().is_empty() && attachment_references.is_empty() {
            return Err(AppError::InvalidInput("write a reply first".into()));
        }
        let current = self.db.get_conversation(conversation_id)?;
        let attached = self.attached_files(&current, attachment_references).await?;
        let reply = CustomerTurn::new(text, attached);
        let conversation =
            if current.status == ConversationStatus::YouReplying { current } else { self.take_over(conversation_id)? };
        self.deliver_and_store(&conversation, MessageAuthor::Operator, &reply.stored_text, reply.metadata, &[]).await
    }

    /// The files `references` name among the attachments of `conversation`.
    async fn attached_files(
        &self,
        conversation: &Conversation,
        references: &[String],
    ) -> AppResult<Vec<crate::agent_files::AttachedFile>> {
        match (&self.agent_files, references.is_empty()) {
            (_, true) => Ok(Vec::new()),
            (Some(agent_files), false) => {
                let scope = FileScope::conversation(&conversation.agent_id, &conversation.id);
                agent_files.attached_files(&scope, references).await
            }
            (None, false) => Err(AppError::InvalidInput("this chat does not take files".into())),
        }
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
        self.tell_channel_about_status(&conversation);
        self.clean_closed_conversation_soon(conversation_id);
        if let Ok(mut turn_locks) = self.turn_locks.lock() {
            turn_locks.remove(conversation_id);
        }
        Ok(conversation)
    }

    /// Removes an attached file the person took off a message before sending it. A file a
    /// message of the conversation already shows is left alone (and that is not an error).
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` when `reference` names no
    /// attachment of it; whatever reading the database reports (nothing is removed then).
    pub async fn discard_attachment(&self, conversation_id: &str, reference: &str) -> AppResult<()> {
        let conversation = self.db.get_conversation(conversation_id)?;
        let Some(agent_files) = &self.agent_files else { return Ok(()) };
        let file_use = self.db.conversation_file_use(Some(conversation_id))?;
        let is_shown =
            file_use.values().flatten().any(|file_use| file_use.referenced.iter().any(|named| named == reference));
        if is_shown {
            return Ok(());
        }
        agent_files
            .discard_attachment(&FileScope::conversation(&conversation.agent_id, conversation_id), reference)
            .await
    }

    /// Removes attachments that were never sent and leftovers of closed conversations
    /// (`crate::agent_files::cleanup`). A file a message still shows is never removed.
    ///
    /// # Errors
    /// Whatever reading the database reports; nothing is removed then.
    pub async fn clean_up_files(&self) -> AppResult<crate::agent_files::cleanup::CleanupReport> {
        match &self.agent_files {
            Some(agent_files) => file_cleanup::clean_everything(&self.db, agent_files).await,
            None => Ok(Default::default()),
        }
    }

    /// Cleans the files of a conversation that was just closed, in the background: closing
    /// a chat never waits for it or fails because of it.
    fn clean_closed_conversation_soon(&self, conversation_id: &str) {
        let Some(agent_files) = self.agent_files.clone() else { return };
        let (db, conversation_id) = (self.db.clone(), conversation_id.to_owned());
        tauri::async_runtime::spawn(async move {
            if let Err(error) = file_cleanup::clean_one(&db, &agent_files, &conversation_id).await {
                log::warn!("could not clean up the files of closed conversation {conversation_id}: {error}");
            }
        });
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
    async fn answer_as_bot(
        &self,
        conversation_id: &str,
        customer_turn: &CustomerTurn,
        answer: Option<&CardAnswer>,
    ) -> AppResult<()> {
        let turn_lock = self.turn_lock(conversation_id)?;
        let _turn_guard = turn_lock.lock().await;
        // Read again under the lock: the previous turn may have changed variables or status.
        let conversation = self.db.get_conversation(conversation_id)?;
        if conversation.status != ConversationStatus::BotAnswering {
            return Ok(());
        }
        let typing = self.keep_typing(&conversation).await;
        let result = self.run_turn(&conversation, customer_turn, answer).await;
        if let Some(typing) = typing {
            typing.abort();
        }
        let turn = match result {
            Ok(turn) => turn,
            Err(AppError::Workflow(message)) if message == bot::PAUSED_RUN_MESSAGE => {
                log::info!("the bot of conversation {conversation_id} waits for an approval");
                let notice = "The bot's steps wait for an approval · reply to the customer yourself";
                self.hand_off(&conversation, Some(BOT_NEEDS_APPROVAL_REASON), notice)?;
                return self.tell_customer_to_wait(&conversation).await;
            }
            Err(error) => {
                log::warn!("the bot of conversation {conversation_id} could not answer: {error}");
                let notice = format!("The bot could not answer · {error}");
                self.hand_off(&conversation, Some(BOT_ERROR_REASON), &notice)?;
                return self.tell_customer_to_wait(&conversation).await;
            }
        };
        self.record_turn(&conversation, turn).await
    }

    /// Runs the chatbot's flow with its saved setup applied (persona, rules,
    /// knowledge; see `crate::chatbot_setup`) and enforces the hand-off rules.
    ///
    /// For a card `answer` the bot reads the choice in words (the button's title and
    /// the card's values) and also gets `sys.card_action` / `sys.card_values`.
    async fn run_turn(
        &self,
        conversation: &Conversation,
        customer_turn: &CustomerTurn,
        answer: Option<&CardAnswer>,
    ) -> AppResult<BotTurn> {
        let agent = self.db.get_agent(&conversation.agent_id)?;
        let answer_text = answer.map(CardAnswer::as_message_text);
        let knowledge_query = answer_text.as_deref().unwrap_or(&customer_turn.knowledge_query);
        let model_text = answer_text.as_deref().unwrap_or(&customer_turn.model_text);
        let prepared = prepare_reply(&self.db, &self.credentials, &agent, knowledge_query).await?;
        let mut sys_values = prepared.sys_values.clone();
        sys_values.extend(answer.map(CardAnswer::sys_values).unwrap_or_default());
        // Chatbots can call other agents as tools, like any run of this agent.
        let tools = agent_tools_for(
            self.db.clone(),
            self.credentials.clone(),
            self.model_source.clone(),
            self.agent_files.clone(),
            &agent.id,
        );
        let file_access = self.file_access(conversation);
        let trusted_hosts = self.db.trusted_lookup_hosts(&agent.id)?;
        let (engine, env) = prepare_engine_and_env(
            &prepared.flow_text,
            &trusted_hosts,
            &self.credentials,
            &self.db,
            &*self.model_source,
            tools,
            file_access.as_ref(),
        )?;
        let on_draft = |draft: &str| self.emit_draft(conversation, draft);
        let mut turn =
            run_bot_turn(&engine, env, conversation, model_text, &sys_values, &customer_turn.files, &on_draft).await?;
        turn.citations = prepared.citations(&turn.retrieved_sources);
        if let (Some(rules), Some(handoff)) = (prepared.handoff_rules, turn.handoff.as_ref()) {
            if !rules.allows(handoff.reason.as_deref()) {
                log::info!(
                    "conversation {}: ignored a hand-off ({:?}) whose rule is switched off",
                    conversation.id,
                    handoff.reason
                );
                turn.handoff = None;
            }
        }
        Ok(turn)
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
        let files = self.reply_files(&conversation, &turn.produced_file_references).await;
        let blocks = visuals::validated_blocks(&turn.visuals, &conversation.id);
        let reply = match attachments::bot_reply(&turn.reply_text, &turn.citations, &files) {
            Some(reply) => Some(reply),
            // Only blocks: nothing to say and no files, but the blocks are the answer.
            None if !blocks.is_empty() => Some((String::new(), json!({}))),
            None => None,
        };
        match reply {
            Some((text, metadata)) => {
                self.deliver_and_store(&conversation, MessageAuthor::Bot, &text, metadata, &blocks).await?;
            }
            // Nothing to say and no hand-off: the customer would wait for an answer that
            // never comes, so the owner gets the chat (e.g. an `answer` step reading a step
            // that did not run).
            None if turn.handoff.is_none() => {
                log::warn!("the bot of conversation {} answered nothing", conversation.id);
                self.hand_off(&conversation, Some(BOT_ERROR_REASON), EMPTY_REPLY_NOTICE)?;
                return self.tell_customer_to_wait(&conversation).await;
            }
            None => {}
        }
        if let Some(handoff) = turn.handoff {
            let reason = handoff.reason.as_deref();
            let notice = format!("Bot handed this to you · {}", describe_handoff_reason(reason));
            self.hand_off(&conversation, reason, &notice)?;
        }
        Ok(())
    }

    /// Whose files a bot turn of `conversation` may use: the conversation's own part of
    /// the agent's workspace.
    fn file_access(&self, conversation: &Conversation) -> Option<FileAccess> {
        self.agent_files
            .clone()
            .map(|files| FileAccess { files, scope: FileScope::conversation(&conversation.agent_id, &conversation.id) })
    }

    /// The cards of the files a bot turn made, looked up in the conversation's part of
    /// the workspace. A reference that names nothing there is dropped.
    async fn reply_files(
        &self,
        conversation: &Conversation,
        references: &[String],
    ) -> Vec<crate::agent_files::FileCard> {
        let Some(access) = self.file_access(conversation).filter(|_| !references.is_empty()) else {
            return Vec::new();
        };
        match access.files.view(&access.scope) {
            Ok(view) => crate::agent_files::cards::cards_for_references(&view, references).await,
            Err(error) => {
                log::warn!("could not open the files of conversation {}: {error}", conversation.id);
                Vec::new()
            }
        }
    }

    /// Sends a bot or owner message on the conversation's channel, then stores it
    /// with `metadata` (a JSON object). A delivery failure is kept in the
    /// metadata rather than lost.
    ///
    /// `blocks` are the reply's UI blocks: stored in the metadata for the app to
    /// draw, and written out as text (charts as images where the channel sends
    /// them) for a channel that cannot draw them (see [`visuals::compose_reply`]).
    async fn deliver_and_store(
        &self,
        conversation: &Conversation,
        author: MessageAuthor,
        text: &str,
        mut metadata: serde_json::Value,
        blocks: &[graphrt_ui::UiBlock],
    ) -> AppResult<Message> {
        let adapter = self.channels.get(&conversation.channel);
        let capabilities =
            adapter.as_ref().map_or_else(|_| ChannelCapabilities::default(), |adapter| adapter.capabilities());
        let language = AppSettings::load_or_default(&self.db).language.unwrap_or_default();
        let reply = compose_reply(text, blocks, capabilities, language);
        let delivery_error = match adapter {
            Ok(adapter) => {
                let buttons = if capabilities.blocks { Vec::new() } else { reply_buttons(&reply.metadata) };
                let files =
                    if capabilities.blocks { Vec::new() } else { self.outbound_files(conversation, &metadata).await };
                let outbound = OutboundMessage {
                    conversation,
                    author,
                    text: &reply.outbound_text,
                    images: &reply.images,
                    buttons: &buttons,
                    files: &files,
                };
                match adapter.send(outbound).await {
                    Ok(()) => None,
                    Err(failure) => {
                        log::warn!("could not deliver a message in conversation {}: {failure}", conversation.id);
                        Some(failure)
                    }
                }
            }
            Err(error) => Some(DeliveryFailure::new(channel::DeliveryProblem::NotConnected, error.to_string())),
        };
        if let Some(fields) = metadata.as_object_mut() {
            fields.extend(reply.metadata);
            if let Some(failure) = delivery_error {
                fields.insert("deliveryError".into(), json!(failure.message));
                fields.insert("deliveryProblem".into(), json!(failure.problem));
            }
        }
        let message = self.db.insert_conversation_message(&conversation.id, author, &reply.stored_text, &metadata)?;
        self.emit(ConversationEventKind::MessageAdded, conversation, Some(message.clone()));
        Ok(message)
    }

    /// The files a message's cards name (`files` of a bot reply, `attachments` of the
    /// owner's reply), read from the conversation's part of the workspace. A file that
    /// cannot be read is left out (the text still names it).
    async fn outbound_files(&self, conversation: &Conversation, metadata: &serde_json::Value) -> Vec<OutboundFile> {
        let Some(access) = self.file_access(conversation) else { return Vec::new() };
        let cards: Vec<crate::agent_files::FileCard> = [attachments::FILES_KEY, attachments::ATTACHMENTS_KEY]
            .iter()
            .filter_map(|key| metadata.get(*key).cloned())
            .filter_map(|cards| serde_json::from_value::<Vec<crate::agent_files::FileCard>>(cards).ok())
            .flatten()
            .collect();
        if cards.is_empty() {
            return Vec::new();
        }
        let view = match access.files.view(&access.scope) {
            Ok(view) => view,
            Err(error) => {
                log::warn!("could not open the files of conversation {}: {error}", conversation.id);
                return Vec::new();
            }
        };
        let mut files = Vec::with_capacity(cards.len());
        for card in cards {
            let Some(path) = view.path_of_reference(&card.reference) else { continue };
            match view.read(&path, 0, crate::agent_files::MAX_ATTACHMENT_BYTES).await {
                Ok(bytes) => files.push(OutboundFile { name: card.name, mime_type: card.mime_type, bytes }),
                Err(error) => log::warn!("could not read {} to send it: {error}", card.name),
            }
        }
        files
    }

    /// Shows "typing" on the customer's channel at once, and again every few seconds until
    /// the returned task is aborted.
    async fn keep_typing(&self, conversation: &Conversation) -> Option<tauri::async_runtime::JoinHandle<()>> {
        if conversation.channel == TEST_CHANNEL {
            return None;
        }
        let adapter = self.channels.find(&conversation.channel)?;
        adapter.typing(conversation).await;
        let conversation = conversation.clone();
        Some(tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(TYPING_INTERVAL).await;
                adapter.typing(&conversation).await;
            }
        }))
    }

    /// Tells a customer on a real channel that a person will answer, after a hand-off the
    /// bot did not explain itself (it failed, or its steps wait for an approval).
    async fn tell_customer_to_wait(&self, conversation: &Conversation) -> AppResult<()> {
        if conversation.channel == TEST_CHANNEL {
            return Ok(());
        }
        let conversation = self.db.get_conversation(&conversation.id)?;
        let language = AppSettings::load_or_default(&self.db).language.unwrap_or_default();
        let text = channels::waiting_message(language);
        self.deliver_and_store(&conversation, MessageAuthor::Bot, text, json!({ "automatic": true }), &[]).await?;
        Ok(())
    }

    /// Lets the conversation's channel know that the owner took over, handed back or
    /// closed it (an online chatbot stops or starts answering). Runs in the background; a
    /// failure is shown in the chat.
    fn tell_channel_about_status(&self, conversation: &Conversation) {
        let Some(adapter) = self.channels.find(&conversation.channel).filter(|adapter| adapter.answers_remotely())
        else {
            return;
        };
        let (db, sink, conversation) = (self.db.clone(), self.sink.clone(), conversation.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(error) = adapter.status_changed(&conversation).await {
                log::warn!("could not tell the channel of conversation {} about its status: {error}", conversation.id);
                let text = format!("The online chatbot was not told about this · {error}");
                if let Ok(message) =
                    db.insert_conversation_message(&conversation.id, MessageAuthor::System, &text, &json!({}))
                {
                    sink.send(ConversationEventPayload {
                        kind: ConversationEventKind::MessageAdded,
                        conversation_id: conversation.id.clone(),
                        agent_id: conversation.agent_id.clone(),
                        status: conversation.status,
                        message: Some(message),
                        draft: None,
                    });
                }
            }
        });
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

    fn emit_draft(&self, conversation: &Conversation, draft: &str) {
        self.sink.send(ConversationEventPayload {
            kind: ConversationEventKind::ReplyDraft,
            conversation_id: conversation.id.clone(),
            agent_id: conversation.agent_id.clone(),
            status: conversation.status,
            message: None,
            draft: Some(draft.to_owned()),
        });
    }

    fn emit(&self, kind: ConversationEventKind, conversation: &Conversation, message: Option<Message>) {
        self.sink.send(ConversationEventPayload {
            kind,
            conversation_id: conversation.id.clone(),
            agent_id: conversation.agent_id.clone(),
            status: conversation.status,
            message,
            draft: None,
        });
    }
}

/// One reply of the chatbot, with what the customer wrote just before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BotReply<'a> {
    pub text: &'a str,
    /// The customer's latest message before the reply; `None` when the bot wrote first.
    pub customer_text: Option<&'a str>,
}

/// The chatbot's reply `message_id` in `detail`, for feedback on it.
///
/// # Errors
/// `NotFound` when the conversation has no such message; `InvalidInput` when the message
/// is not a reply of the chatbot (the customer, the owner and notices cannot be rated).
pub fn find_bot_reply<'a>(detail: &'a ConversationDetail, message_id: &str) -> AppResult<BotReply<'a>> {
    let position = detail
        .messages
        .iter()
        .position(|message| message.id == message_id)
        .ok_or_else(|| AppError::NotFound("this message".into()))?;
    let reply = &detail.messages[position];
    if reply.author != MessageAuthor::Bot {
        return Err(AppError::InvalidInput("only a reply of the chatbot can be rated".into()));
    }
    let customer_text = detail.messages[..position]
        .iter()
        .rev()
        .find(|message| message.author == MessageAuthor::Customer)
        .map(|message| message.text.as_str());
    Ok(BotReply { text: &reply.text, customer_text })
}

/// The buttons of a reply's numbered choices (`metadata.choices`).
fn reply_buttons(metadata: &serde_json::Map<String, serde_json::Value>) -> Vec<OutboundButton> {
    metadata
        .get(visuals::CHOICES_KEY)
        .and_then(serde_json::Value::as_array)
        .map(|choices| {
            choices
                .iter()
                .filter_map(|choice| {
                    let number = choice.get("number").and_then(serde_json::Value::as_u64)?;
                    let title = choice.get("title").and_then(serde_json::Value::as_str)?;
                    Some(OutboundButton { id: number.to_string(), title: title.to_owned() })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Plain words for the hand-off reasons the builder guide suggests; other
/// reasons are shown as the workflow wrote them.
pub fn describe_handoff_reason(reason: Option<&str>) -> String {
    match reason {
        Some("order_to_confirm") => "order ready to confirm".into(),
        Some("asked_for_person") => "customer asked for a person".into(),
        Some("not_sure") => "answer not in the knowledge".into(),
        Some("sounds_upset") => "customer sounds upset".into(),
        Some(BOT_ERROR_REASON) => "the bot could not answer".into(),
        Some(BOT_PAUSED_REASON) => "the bot is paused".into(),
        Some(BOT_NEEDS_APPROVAL_REASON) => "the bot needs an approval".into(),
        Some(other) => other.replace('_', " "),
        None => "needs your reply".into(),
    }
}
