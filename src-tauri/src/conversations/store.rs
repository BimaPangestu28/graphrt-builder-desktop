//! Conversations and their messages in SQLite (tables `conversations` and
//! `conversation_messages`, see `storage/migrations.rs`).
//!
//! Status changes only check that the conversation exists; which transitions
//! are allowed is decided by `ConversationManager`.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, Row, ToSql};

use super::models::{
    Conversation, ConversationCounts, ConversationFilter, ConversationStatus, Message, MessageAuthor, NewConversation,
};
use crate::error::{AppError, AppResult};
use crate::storage::{now_rfc3339, Database};

/// Origin of conversations an outreach agent started (the "From outreach" chip).
pub const OUTREACH_ORIGIN: &str = "outreach";

const DEFAULT_LIST_LIMIT: i64 = 200;
const MAX_LIST_LIMIT: i64 = 1000;

/// Columns of a conversation row plus its latest message, for `map_conversation_row`.
const CONVERSATION_SELECT: &str = "
    SELECT c.id, c.agent_id, c.channel, c.customer_name, c.customer_handle, c.status, c.origin,
           c.handoff_reason, c.summary, c.suggested_reply, c.variables_json, c.created_at, c.updated_at,
           last_message.text AS last_message_text, last_message.author AS last_message_author
    FROM conversations c
    LEFT JOIN conversation_messages last_message ON last_message.rowid = (
        SELECT m.rowid FROM conversation_messages m
        WHERE m.conversation_id = c.id AND m.author != 'system' ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
    )";

impl ToSql for ConversationStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_db_text()))
    }
}

impl FromSql for ConversationStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        Self::from_db_text(text)
            .ok_or_else(|| FromSqlError::Other(format!("unknown conversation status {text:?}").into()))
    }
}

impl ToSql for MessageAuthor {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_db_text()))
    }
}

impl FromSql for MessageAuthor {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        Self::from_db_text(text).ok_or_else(|| FromSqlError::Other(format!("unknown message author {text:?}").into()))
    }
}

impl Database {
    /// Opens a conversation in `BotAnswering` with no variables.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent, `InvalidInput` for a blank channel or customer handle.
    pub fn insert_conversation(&self, new_conversation: &NewConversation) -> AppResult<Conversation> {
        let channel = required_text(&new_conversation.channel, "channel")?;
        let customer_handle = required_text(&new_conversation.customer_handle, "customer handle")?;
        let customer_name = match new_conversation.customer_name.trim() {
            "" => customer_handle.clone(),
            name => name.to_owned(),
        };
        let conversation_id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let connection = self.lock()?;
        ensure_agent_exists(&connection, &new_conversation.agent_id)?;
        connection.execute(
            "INSERT INTO conversations (id, agent_id, channel, customer_name, customer_handle, status, origin,
                                        variables_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8, ?8)",
            params![
                conversation_id,
                new_conversation.agent_id,
                channel,
                customer_name,
                customer_handle,
                ConversationStatus::BotAnswering,
                new_conversation.origin,
                now,
            ],
        )?;
        fetch_conversation(&connection, &conversation_id)
    }

    /// # Errors
    /// `NotFound` for an unknown conversation.
    pub fn get_conversation(&self, conversation_id: &str) -> AppResult<Conversation> {
        fetch_conversation(&*self.lock()?, conversation_id)
    }

    /// Conversations matching `filter`, most recently active first.
    ///
    /// # Errors
    /// `InvalidInput` when `limit` is not positive.
    pub fn list_conversations(&self, filter: &ConversationFilter) -> AppResult<Vec<Conversation>> {
        let limit = resolve_limit(filter.limit)?;
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "{CONVERSATION_SELECT}
             WHERE (?1 IS NULL OR c.status = ?1) AND (?2 IS NULL OR c.agent_id = ?2)
               AND (?3 IS NULL OR c.origin = ?3) AND (?4 IS NULL OR c.channel = ?4)
             ORDER BY c.updated_at DESC, c.rowid DESC
             LIMIT ?5"
        ))?;
        let conversations = statement
            .query_map(
                params![filter.status, filter.agent_id, filter.origin, filter.channel, limit],
                map_conversation_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(conversations)
    }

    /// Counts for the Inbox filter chips, optionally for one agent.
    pub fn count_conversations(&self, agent_id: Option<&str>) -> AppResult<ConversationCounts> {
        let connection = self.lock()?;
        let counts = connection.query_row(
            "SELECT COUNT(*),
                    COUNT(*) FILTER (WHERE status = 'bot_answering'),
                    COUNT(*) FILTER (WHERE status = 'waiting_for_you'),
                    COUNT(*) FILTER (WHERE status = 'you_replying'),
                    COUNT(*) FILTER (WHERE status = 'closed'),
                    COUNT(*) FILTER (WHERE origin = ?2)
             FROM conversations WHERE (?1 IS NULL OR agent_id = ?1)",
            params![agent_id, OUTREACH_ORIGIN],
            |row| {
                Ok(ConversationCounts {
                    all: row.get(0)?,
                    bot_answering: row.get(1)?,
                    waiting_for_you: row.get(2)?,
                    you_replying: row.get(3)?,
                    closed: row.get(4)?,
                    from_outreach: row.get(5)?,
                })
            },
        )?;
        Ok(counts)
    }

    /// The customer's latest conversation with the agent on `channel` that is not closed.
    pub fn find_open_conversation(
        &self,
        agent_id: &str,
        channel: &str,
        customer_handle: &str,
    ) -> AppResult<Option<Conversation>> {
        let connection = self.lock()?;
        let conversation = connection
            .query_row(
                &format!(
                    "{CONVERSATION_SELECT}
                     WHERE c.agent_id = ?1 AND c.channel = ?2 AND c.customer_handle = ?3 AND c.status != 'closed'
                     ORDER BY c.updated_at DESC LIMIT 1"
                ),
                params![agent_id, channel, customer_handle],
                map_conversation_row,
            )
            .optional()?;
        Ok(conversation)
    }

    /// Sets the status. `handoff_reason` is kept only while waiting for you;
    /// other statuses clear it.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation.
    pub fn set_conversation_status(
        &self,
        conversation_id: &str,
        status: ConversationStatus,
        handoff_reason: Option<&str>,
    ) -> AppResult<Conversation> {
        let handoff_reason = if status == ConversationStatus::WaitingForYou { handoff_reason } else { None };
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE conversations SET status = ?2, handoff_reason = ?3, updated_at = ?4 WHERE id = ?1",
            params![conversation_id, status, handoff_reason, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(conversation_not_found(conversation_id));
        }
        fetch_conversation(&connection, conversation_id)
    }

    /// Stores what the bot's workflow left for the next turn. `summary` and
    /// `suggested_reply` are only replaced when the workflow produced them.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` when `variables` is not an object.
    pub fn save_conversation_turn(
        &self,
        conversation_id: &str,
        variables: &serde_json::Value,
        summary: Option<&str>,
        suggested_reply: Option<&str>,
    ) -> AppResult<Conversation> {
        if !variables.is_object() {
            return Err(AppError::InvalidInput("conversation variables must be a JSON object".into()));
        }
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE conversations
             SET variables_json = ?2, summary = COALESCE(?3, summary),
                 suggested_reply = COALESCE(?4, suggested_reply), updated_at = ?5
             WHERE id = ?1",
            params![conversation_id, variables.to_string(), summary, suggested_reply, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(conversation_not_found(conversation_id));
        }
        fetch_conversation(&connection, conversation_id)
    }

    /// Appends a message and marks the conversation as just active.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation; `InvalidInput` for blank text.
    pub fn insert_conversation_message(
        &self,
        conversation_id: &str,
        author: MessageAuthor,
        text: &str,
        metadata: &serde_json::Value,
    ) -> AppResult<Message> {
        let text = required_text(text, "message text")?;
        let message_id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let connection = self.lock()?;
        let transaction = connection.unchecked_transaction()?;
        let changed = transaction
            .execute("UPDATE conversations SET updated_at = ?2 WHERE id = ?1", params![conversation_id, now])?;
        if changed == 0 {
            return Err(conversation_not_found(conversation_id));
        }
        transaction.execute(
            "INSERT INTO conversation_messages (id, conversation_id, author, text, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![message_id, conversation_id, author, text, metadata.to_string(), now],
        )?;
        transaction.commit()?;
        Ok(Message {
            id: message_id,
            conversation_id: conversation_id.to_owned(),
            author,
            text,
            metadata: metadata.clone(),
            created_at: now,
        })
    }

    /// Messages of a conversation, oldest first.
    ///
    /// # Errors
    /// `NotFound` for an unknown conversation.
    pub fn list_conversation_messages(&self, conversation_id: &str) -> AppResult<Vec<Message>> {
        let connection = self.lock()?;
        fetch_conversation(&connection, conversation_id)?;
        let mut statement = connection.prepare(
            "SELECT id, conversation_id, author, text, metadata_json, created_at FROM conversation_messages
             WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC",
        )?;
        let messages = statement.query_map([conversation_id], map_message_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }
}

fn fetch_conversation(connection: &Connection, conversation_id: &str) -> AppResult<Conversation> {
    connection
        .query_row(&format!("{CONVERSATION_SELECT} WHERE c.id = ?1"), [conversation_id], map_conversation_row)
        .optional()?
        .ok_or_else(|| conversation_not_found(conversation_id))
}

fn ensure_agent_exists(connection: &Connection, agent_id: &str) -> AppResult<()> {
    let exists: bool =
        connection.query_row("SELECT EXISTS (SELECT 1 FROM agents WHERE id = ?1)", [agent_id], |row| row.get(0))?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("agent {agent_id}")))
    }
}

fn conversation_not_found(conversation_id: &str) -> AppError {
    AppError::NotFound(format!("conversation {conversation_id}"))
}

fn required_text(text: &str, what: &str) -> AppResult<String> {
    match text.trim() {
        "" => Err(AppError::InvalidInput(format!("{what} must not be empty"))),
        trimmed => Ok(trimmed.to_owned()),
    }
}

fn resolve_limit(limit: Option<i64>) -> AppResult<i64> {
    match limit {
        None => Ok(DEFAULT_LIST_LIMIT),
        Some(limit) if limit < 1 => Err(AppError::InvalidInput(format!("limit must be at least 1, got {limit}"))),
        Some(limit) => Ok(limit.min(MAX_LIST_LIMIT)),
    }
}

fn parse_json_column(row: &Row<'_>, column_name: &str) -> rusqlite::Result<serde_json::Value> {
    let json_text: String = row.get(column_name)?;
    serde_json::from_str(&json_text).map_err(|parse_error| {
        let column_index = row.as_ref().column_index(column_name).unwrap_or(0);
        rusqlite::Error::FromSqlConversionFailure(column_index, rusqlite::types::Type::Text, Box::new(parse_error))
    })
}

fn map_conversation_row(row: &Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        channel: row.get("channel")?,
        customer_name: row.get("customer_name")?,
        customer_handle: row.get("customer_handle")?,
        status: row.get("status")?,
        origin: row.get("origin")?,
        handoff_reason: row.get("handoff_reason")?,
        summary: row.get("summary")?,
        suggested_reply: row.get("suggested_reply")?,
        variables: parse_json_column(row, "variables_json")?,
        last_message_text: row.get("last_message_text")?,
        last_message_author: row.get("last_message_author")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_message_row(row: &Row<'_>) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get("id")?,
        conversation_id: row.get("conversation_id")?,
        author: row.get("author")?,
        text: row.get("text")?,
        metadata: parse_json_column(row, "metadata_json")?,
        created_at: row.get("created_at")?,
    })
}
