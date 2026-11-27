//! Messages a customer channel delivered (Telegram, personal WhatsApp, WhatsApp Business of
//! an online chatbot), on their way into the Inbox.
//!
//! A channel calls [`ConversationManager::accept_channel_message`] first: it drops a message
//! whose channel id is stored already (channels deliver again when they are not sure a
//! message arrived), stores the customer's files with the same checks as a file chosen in
//! the app, and stores the message. Only then does the channel confirm the message to its
//! server (Telegram's update cursor), and [`ConversationManager::answer_channel_message`]
//! runs the bot. A crash between the two leaves a stored, unanswered message, which
//! [`ConversationManager::answer_unanswered_channel_messages`] answers at the next start.
//!
//! A chat another program answers (the online chatbot of WhatsApp Business) is mirrored
//! instead: [`ConversationManager::mirror_channel_message`] stores what the customer and
//! the online bot wrote, and the local bot never runs.

use serde_json::json;

use super::attachments::{CustomerTurn, ATTACHMENTS_KEY};
use super::models::{Conversation, ConversationFilter, ConversationStatus, MessageAuthor, NewConversation};
use super::visuals::{self, CardAnswer};
use super::{channels, ConversationEventKind, ConversationManager, TEST_CHANNEL};
use crate::agent_files::abilities::FlowFileUse;
use crate::agent_files::{FileCard, FileScope, MAX_ATTACHMENTS_PER_MESSAGE};
use crate::desktop::app_settings::AppSettings;
use crate::error::{AppError, AppResult};

/// Metadata key of the id a channel gave a customer message.
pub const CHANNEL_MESSAGE_ID_KEY: &str = "channelMessageId";
/// Metadata key of how many files of a customer message were not taken.
pub const FILES_NOT_TAKEN_KEY: &str = "filesNotTaken";
/// Largest file taken from a customer on a channel (what `graphrt serve` takes by default).
pub const MAX_CHANNEL_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// Stored text of a message that only had files, none of which could be taken.
const ONLY_REFUSED_FILES_TEXT: &str = "(sent a file that could not be taken)";

/// A file a customer sent, fetched from the channel. Untrusted: checked when stored.
#[derive(Clone, PartialEq, Eq)]
pub struct ChannelFile {
    /// The channel's name for it (or a made-up one). Untrusted.
    pub name: String,
    pub bytes: Vec<u8>,
}

impl std::fmt::Debug for ChannelFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChannelFile").field("name", &self.name).field("bytes", &self.bytes.len()).finish()
    }
}

/// One customer message as a channel delivered it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelInbound {
    /// The channel's id of the message, unique for the channel account.
    pub message_id: String,
    /// Where replies go: a Telegram chat id, a phone number...
    pub customer_handle: String,
    /// The name the channel shows for the customer. Untrusted.
    pub customer_name: Option<String>,
    pub text: String,
    pub files: Vec<ChannelFile>,
    /// Files the channel had but could not hand over (too large, download failed).
    pub missed_files: usize,
}

/// What [`ConversationManager::accept_channel_message`] did.
#[derive(Debug)]
pub enum Accepted {
    /// The message was stored before: nothing to do.
    Duplicate,
    /// The owner switched this channel off for the chatbot: the message was not stored.
    ChannelOff,
    /// Stored; answer it with [`ConversationManager::answer_channel_message`].
    Stored(Box<StoredInbound>),
}

/// A stored customer message that waits for the bot.
#[derive(Debug)]
pub struct StoredInbound {
    conversation: Conversation,
    customer_turn: CustomerTurn,
    answer: Option<CardAnswer>,
    files_not_taken: usize,
    /// Nothing but files that were not taken: the bot has nothing to read.
    nothing_to_read: bool,
}

impl StoredInbound {
    pub fn conversation_id(&self) -> &str {
        &self.conversation.id
    }
}

/// A message of a chat another program answers, as that program keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirroredMessage {
    /// Unique within the channel account, stable between syncs.
    pub external_id: String,
    /// `Customer`, `Bot` (the online chatbot) or `Operator` (a person of the team).
    pub author: MessageAuthor,
    pub text: String,
}

impl ConversationManager {
    /// Stores a message a channel delivered (see the module docs).
    ///
    /// # Errors
    /// `InvalidInput` for an unknown channel, a message without id or customer, or an
    /// agent that is not a chatbot; `NotFound` for an unknown agent; storage errors.
    pub async fn accept_channel_message(
        &self,
        channel_name: &str,
        agent_id: &str,
        inbound: ChannelInbound,
    ) -> AppResult<Accepted> {
        let adapter = self.channels.get(channel_name)?;
        self.ensure_chatbot(agent_id)?;
        if inbound.message_id.trim().is_empty() || inbound.customer_handle.trim().is_empty() {
            return Err(AppError::InvalidInput("a channel message needs an id and a customer".into()));
        }
        if !crate::chatbot_setup::is_channel_enabled(&self.db, agent_id, adapter.name())? {
            return Ok(Accepted::ChannelOff);
        }
        if self.db.has_channel_message(agent_id, adapter.name(), &inbound.message_id)? {
            log::info!("{channel_name}: dropped message {} delivered again", inbound.message_id);
            return Ok(Accepted::Duplicate);
        }
        let conversation = self.open_channel_conversation(
            adapter.name(),
            agent_id,
            &inbound.customer_handle,
            inbound.customer_name.as_deref(),
        )?;
        let (references, refused) = self.store_channel_files(&conversation, inbound.files).await?;
        let files_not_taken = refused + inbound.missed_files;
        let attached = self.attached_files(&conversation, &references).await?;
        let text = inbound.text.trim();
        let nothing_to_read = text.is_empty() && attached.is_empty();
        let answer = if attached.is_empty() && !text.is_empty() {
            self.last_exchange_message(&conversation.id)?
                .filter(|message| message.author == MessageAuthor::Bot)
                .and_then(|message| visuals::match_reply(&message.metadata, text))
        } else {
            None
        };
        let customer_turn = CustomerTurn::new(if nothing_to_read { ONLY_REFUSED_FILES_TEXT } else { text }, attached);
        let mut extra = json!({ CHANNEL_MESSAGE_ID_KEY: inbound.message_id });
        if files_not_taken > 0 {
            extra[FILES_NOT_TAKEN_KEY] = json!(files_not_taken);
        }
        let conversation = self.store_customer_turn(conversation, &customer_turn, answer.as_ref(), extra)?;
        Ok(Accepted::Stored(Box::new(StoredInbound {
            conversation,
            customer_turn,
            answer,
            files_not_taken,
            nothing_to_read,
        })))
    }

    /// Answers a message [`Self::accept_channel_message`] stored: the bot's turn, or the
    /// hand-off the status flow asks for. When only files arrived and none could be taken,
    /// the customer is asked to write instead.
    ///
    /// # Errors
    /// Storage errors; a failing bot hands the chat to the owner instead.
    pub async fn answer_channel_message(&self, stored: Box<StoredInbound>) -> AppResult<()> {
        let StoredInbound { conversation, customer_turn, answer, files_not_taken, nothing_to_read } = *stored;
        if files_not_taken > 0 {
            let text = format!(
                "{files_not_taken} file(s) from the customer were not taken (larger than 10 MB, or a kind this \
                 chatbot does not read)"
            );
            self.add_system_message(&conversation, &text, json!({}))?;
        }
        if nothing_to_read {
            if conversation.status == ConversationStatus::BotAnswering
                && !self.channels.find(&conversation.channel).is_some_and(|adapter| adapter.answers_remotely())
            {
                let language = AppSettings::load_or_default(&self.db).language.unwrap_or_default();
                let text = channels::files_not_taken_message(language);
                self.deliver_and_store(&conversation, MessageAuthor::Bot, text, json!({ "automatic": true }), &[])
                    .await?;
            }
            return Ok(());
        }
        self.answer_customer_turn(&conversation, &customer_turn, answer.as_ref()).await
    }

    /// Answers customer messages that were stored but never answered (the app stopped in
    /// between), on every channel the local bot answers. Returns how many it answered.
    ///
    /// # Errors
    /// Storage errors.
    pub async fn answer_unanswered_channel_messages(&self) -> AppResult<usize> {
        let filter = ConversationFilter {
            status: Some(ConversationStatus::BotAnswering),
            limit: Some(200),
            ..ConversationFilter::default()
        };
        let mut answered = 0;
        for conversation in self.db.list_conversations(&filter)? {
            let local = conversation.channel != TEST_CHANNEL
                && self.channels.find(&conversation.channel).is_some_and(|adapter| !adapter.answers_remotely());
            if !local || conversation.last_message_author != Some(MessageAuthor::Customer) {
                continue;
            }
            let Some(last) = self.last_exchange_message(&conversation.id)? else { continue };
            let references: Vec<String> = last
                .metadata
                .get(ATTACHMENTS_KEY)
                .cloned()
                .and_then(|cards| serde_json::from_value::<Vec<FileCard>>(cards).ok())
                .unwrap_or_default()
                .into_iter()
                .map(|card| card.reference)
                .collect();
            let attached = self.attached_files(&conversation, &references).await.unwrap_or_default();
            let text = if last.metadata.get(super::attachments::FILES_ONLY_KEY).is_some() { "" } else { &last.text };
            let customer_turn = CustomerTurn::new(text, attached);
            log::info!("answering a message of conversation {} left unanswered at the last stop", conversation.id);
            self.answer_customer_turn(&conversation, &customer_turn, None).await?;
            answered += 1;
        }
        Ok(answered)
    }

    /// Stores one message of a chat another program answers (see the module docs). The
    /// chat is found (or opened) by the customer's handle; a customer message reopens a
    /// closed chat. Returns `false` when the message was stored before.
    ///
    /// # Errors
    /// As [`Self::accept_channel_message`].
    pub fn mirror_channel_message(
        &self,
        channel_name: &str,
        agent_id: &str,
        customer_handle: &str,
        customer_name: Option<&str>,
        message: &MirroredMessage,
    ) -> AppResult<bool> {
        let adapter = self.channels.get(channel_name)?;
        self.ensure_chatbot(agent_id)?;
        if self.db.has_channel_message(agent_id, adapter.name(), &message.external_id)? {
            return Ok(false);
        }
        let text = message.text.trim();
        if text.is_empty() {
            return Ok(false);
        }
        let mut conversation = match self.db.latest_channel_conversation(agent_id, adapter.name(), customer_handle)? {
            Some(conversation) => conversation,
            None => self.open_channel_conversation(adapter.name(), agent_id, customer_handle, customer_name)?,
        };
        if conversation.status == ConversationStatus::Closed && message.author == MessageAuthor::Customer {
            conversation = self.change_status(&conversation, ConversationStatus::BotAnswering, None)?;
        }
        let metadata = json!({ CHANNEL_MESSAGE_ID_KEY: message.external_id });
        let stored = self.db.insert_conversation_message(&conversation.id, message.author, text, &metadata)?;
        self.emit(ConversationEventKind::MessageAdded, &conversation, Some(stored));
        Ok(true)
    }

    /// A message the owner sent through another program comes back from it as that
    /// program's answer: marks the owner's stored message with the program's id instead of
    /// storing it twice. Returns whether one was found.
    ///
    /// # Errors
    /// Storage errors.
    pub fn claim_operator_message(
        &self,
        channel_name: &str,
        agent_id: &str,
        customer_handle: &str,
        message: &MirroredMessage,
    ) -> AppResult<bool> {
        let Some(conversation) = self.db.latest_channel_conversation(agent_id, channel_name, customer_handle)? else {
            return Ok(false);
        };
        self.db.claim_channel_message(&conversation.id, MessageAuthor::Operator, &message.text, &message.external_id)
    }

    /// Follows the status another program reports for a mirrored chat: `person` when a
    /// person of the team answers there, `waiting` when its run waits for an approval.
    ///
    /// # Errors
    /// Storage errors.
    pub fn mirror_channel_status(
        &self,
        channel_name: &str,
        agent_id: &str,
        customer_handle: &str,
        person: bool,
        waiting: bool,
    ) -> AppResult<()> {
        let Some(conversation) = self.db.latest_channel_conversation(agent_id, channel_name, customer_handle)? else {
            return Ok(());
        };
        let wanted = match (conversation.status, person, waiting) {
            (ConversationStatus::Closed, _, _) => return Ok(()),
            (_, true, _) => ConversationStatus::YouReplying,
            (_, false, true) => ConversationStatus::WaitingForYou,
            (ConversationStatus::WaitingForYou, false, false) => ConversationStatus::BotAnswering,
            (status, false, false) => status,
        };
        if wanted == conversation.status {
            return Ok(());
        }
        let reason = (wanted == ConversationStatus::WaitingForYou).then_some(super::BOT_NEEDS_APPROVAL_REASON);
        let conversation = self.change_status(&conversation, wanted, reason)?;
        if wanted == ConversationStatus::WaitingForYou {
            self.add_system_message(
                &conversation,
                "The online chatbot waits for an approval · answer it on the phone page or in Runs",
                json!({ "handoffReason": reason }),
            )?;
        }
        Ok(())
    }

    /// The customer's open chat with the agent on the channel, or a new one.
    fn open_channel_conversation(
        &self,
        channel_name: &str,
        agent_id: &str,
        customer_handle: &str,
        customer_name: Option<&str>,
    ) -> AppResult<Conversation> {
        if let Some(conversation) = self.db.find_open_conversation(agent_id, channel_name, customer_handle)? {
            return Ok(conversation);
        }
        let conversation = self.db.insert_conversation(&NewConversation {
            agent_id: agent_id.to_owned(),
            channel: channel_name.to_owned(),
            customer_name: customer_name.map(clean_customer_name).unwrap_or_default(),
            customer_handle: customer_handle.to_owned(),
            origin: None,
        })?;
        self.emit(ConversationEventKind::Created, &conversation, None);
        Ok(conversation)
    }

    /// Stores the customer's files in the conversation's part of the workspace. Returns
    /// the references of the stored ones and how many were refused.
    async fn store_channel_files(
        &self,
        conversation: &Conversation,
        files: Vec<super::inbound::ChannelFile>,
    ) -> AppResult<(Vec<String>, usize)> {
        if files.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let Some(agent_files) = &self.agent_files else { return Ok((Vec::new(), files.len())) };
        let agent = self.db.get_agent(&conversation.agent_id)?;
        let abilities = FlowFileUse::of(&agent.flow_yaml).abilities();
        if !abilities.takes_attachments() {
            return Ok((Vec::new(), files.len()));
        }
        let scope = FileScope::conversation(&conversation.agent_id, &conversation.id);
        let (mut references, mut refused) = (Vec::new(), 0);
        for file in files {
            if references.len() >= MAX_ATTACHMENTS_PER_MESSAGE
                || u64::try_from(file.bytes.len()).unwrap_or(u64::MAX) > MAX_CHANNEL_FILE_BYTES
            {
                refused += 1;
                continue;
            }
            match agent_files.attach_channel_file(&scope, abilities, &file.name, file.bytes).await {
                Ok(card) => references.push(card.reference),
                Err(problem) => {
                    log::info!("conversation {}: a customer file was not taken: {problem}", conversation.id);
                    refused += 1;
                }
            }
        }
        Ok((references, refused))
    }
}

/// A customer's display name as it is shown: one line, no control characters, at most 80
/// characters. The customer chose it.
fn clean_customer_name(name: &str) -> String {
    name.chars().filter(|character| !character.is_control()).take(80).collect::<String>().trim().to_owned()
}
