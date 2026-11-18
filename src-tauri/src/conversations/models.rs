//! Conversation records. These are also the payloads returned to the frontend
//! (camelCase JSON); keep `src/api/conversationTypes.ts` in sync.

use serde::{Deserialize, Serialize};

/// Who is answering a conversation right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationStatus {
    /// The chatbot answers every customer message.
    BotAnswering,
    /// The bot handed the chat over (order to confirm, question it cannot answer...)
    /// and stopped answering until the owner replies or hands it back.
    WaitingForYou,
    /// The owner took over; the bot stays quiet until handed back.
    YouReplying,
    Closed,
}

impl ConversationStatus {
    /// The stored TEXT value (identical to the serde name).
    pub(crate) fn as_db_text(self) -> &'static str {
        match self {
            Self::BotAnswering => "bot_answering",
            Self::WaitingForYou => "waiting_for_you",
            Self::YouReplying => "you_replying",
            Self::Closed => "closed",
        }
    }

    pub(crate) fn from_db_text(text: &str) -> Option<Self> {
        [Self::BotAnswering, Self::WaitingForYou, Self::YouReplying, Self::Closed]
            .into_iter()
            .find(|status| status.as_db_text() == text)
    }
}

/// Who wrote a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageAuthor {
    Customer,
    Bot,
    /// The owner, replying after taking over.
    Operator,
    /// Notices such as "Bot handed this to you".
    System,
}

impl MessageAuthor {
    /// The stored TEXT value (identical to the serde name).
    pub(crate) fn as_db_text(self) -> &'static str {
        match self {
            Self::Customer => "customer",
            Self::Bot => "bot",
            Self::Operator => "operator",
            Self::System => "system",
        }
    }

    pub(crate) fn from_db_text(text: &str) -> Option<Self> {
        [Self::Customer, Self::Bot, Self::Operator, Self::System].into_iter().find(|author| author.as_db_text() == text)
    }
}

/// One chat between a chatbot agent and a customer on one channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub agent_id: String,
    /// Channel adapter name: `test` (the in-app Try it panel), later `whatsapp`, `telegram`...
    pub channel: String,
    pub customer_name: String,
    /// The customer's address on the channel (phone number, chat id...).
    pub customer_handle: String,
    pub status: ConversationStatus,
    /// How the chat started, e.g. `outreach` when an agent messaged first; `None` when the customer did.
    pub origin: Option<String>,
    /// Why the bot handed the chat over (workflow output `handoff_reason`), while it waits for you.
    pub handoff_reason: Option<String>,
    /// Latest `summary` output of the bot's workflow.
    pub summary: Option<String>,
    /// Latest `suggested_reply` output of the bot's workflow, offered to the owner.
    pub suggested_reply: Option<String>,
    /// The workflow's `conversation.*` variables, carried from one turn to the next.
    pub variables: serde_json::Value,
    pub last_message_text: Option<String>,
    pub last_message_author: Option<MessageAuthor>,
    /// RFC 3339 timestamps; `updated_at` moves with every message and status change.
    pub created_at: String,
    pub updated_at: String,
}

/// One message of a conversation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub author: MessageAuthor,
    pub text: String,
    /// Extra facts, e.g. `{"handoffReason": "..."}` on a hand-off notice or
    /// `{"deliveryError": "..."}` when the channel could not send a reply.
    pub metadata: serde_json::Value,
    pub created_at: String,
}

/// A conversation with all its messages, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

/// Fields needed to open a conversation; id, status and timestamps are assigned by storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConversation {
    pub agent_id: String,
    pub channel: String,
    pub customer_name: String,
    pub customer_handle: String,
    pub origin: Option<String>,
}

/// Inbox filters; every field is optional and they combine with AND.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationFilter {
    pub status: Option<ConversationStatus>,
    pub agent_id: Option<String>,
    pub origin: Option<String>,
    pub channel: Option<String>,
    /// Defaults to 200.
    pub limit: Option<i64>,
}

/// Number of conversations per Inbox filter chip.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCounts {
    pub all: i64,
    pub bot_answering: i64,
    pub waiting_for_you: i64,
    pub you_replying: i64,
    pub closed: i64,
    pub from_outreach: i64,
}
