//! The builder chat of each agent (screen 04), removed with its agent (`ON DELETE CASCADE`).
//!
//! A change request and the builder's reply are saved together after the change
//! finishes (or fails), so the chat reads back as request/reply pairs in order.

use rusqlite::{params, Row};

use super::agents::ensure_agent_exists;
use super::models::{BuilderMessage, NewBuilderMessage};
use super::{now_rfc3339, Database};
use crate::error::AppResult;

const MESSAGE_COLUMNS: &str =
    "id, agent_id, role, text, explanation, status, version_before, version_after, changed_step_ids, created_at";

impl Database {
    /// Saves `messages` for the agent in one transaction, in the given order.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent (nothing is saved).
    pub fn add_builder_messages(
        &self,
        agent_id: &str,
        messages: &[NewBuilderMessage],
    ) -> AppResult<Vec<BuilderMessage>> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        ensure_agent_exists(&transaction, agent_id)?;
        let mut saved_messages = Vec::with_capacity(messages.len());
        for new_message in messages {
            let message = to_saved_message(agent_id, new_message);
            transaction.execute(
                &format!(
                    "INSERT INTO builder_messages ({MESSAGE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
                ),
                params![
                    message.id,
                    message.agent_id,
                    message.role,
                    message.text,
                    message.explanation,
                    message.status,
                    message.version_before,
                    message.version_after,
                    serde_json::to_string(&message.changed_step_ids)?,
                    message.created_at,
                ],
            )?;
            saved_messages.push(message);
        }
        transaction.commit()?;
        Ok(saved_messages)
    }

    /// The agent's builder chat, oldest first.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn list_builder_messages(&self, agent_id: &str) -> AppResult<Vec<BuilderMessage>> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        // rowid keeps a request before its reply when both share a timestamp.
        let mut statement = connection.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM builder_messages WHERE agent_id = ?1 ORDER BY created_at, rowid"
        ))?;
        let messages = statement.query_map([agent_id], map_message_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }
}

fn to_saved_message(agent_id: &str, new_message: &NewBuilderMessage) -> BuilderMessage {
    BuilderMessage {
        id: uuid::Uuid::new_v4().to_string(),
        agent_id: agent_id.to_owned(),
        role: new_message.role,
        text: new_message.text.clone(),
        explanation: new_message.explanation.clone(),
        status: new_message.status,
        version_before: new_message.version_before,
        version_after: new_message.version_after,
        changed_step_ids: new_message.changed_step_ids.clone(),
        created_at: now_rfc3339(),
    }
}

fn map_message_row(row: &Row<'_>) -> rusqlite::Result<BuilderMessage> {
    let changed_step_ids_text: String = row.get("changed_step_ids")?;
    let changed_step_ids = serde_json::from_str(&changed_step_ids_text).map_err(|parse_error| {
        let column_index = row.as_ref().column_index("changed_step_ids").unwrap_or(0);
        rusqlite::Error::FromSqlConversionFailure(column_index, rusqlite::types::Type::Text, Box::new(parse_error))
    })?;
    Ok(BuilderMessage {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        role: row.get("role")?,
        text: row.get("text")?,
        explanation: row.get("explanation")?,
        status: row.get("status")?,
        version_before: row.get("version_before")?,
        version_after: row.get("version_after")?,
        changed_step_ids,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::storage::models::{BuilderMessageRole, BuilderMessageStatus};
    use crate::storage::test_support::{create_test_agent, test_database};

    fn change_reply() -> NewBuilderMessage {
        NewBuilderMessage {
            changed_step_ids: vec!["write".into(), "send".into()],
            ..NewBuilderMessage::builder_reply("Changed 2 steps", Some("I made it shorter.".into()), (Some(1), 2))
        }
    }

    #[test]
    fn saves_and_lists_messages_in_order() {
        let database = test_database();
        let agent = create_test_agent(&database, "Inbox");
        database
            .add_builder_messages(
                &agent.id,
                &[NewBuilderMessage::user_request("Make it shorter", Some(1)), change_reply()],
            )
            .unwrap();
        database
            .add_builder_messages(
                &agent.id,
                &[
                    NewBuilderMessage::user_request("Add a step", Some(2)),
                    NewBuilderMessage::builder_failure("model error: offline", Some(2)),
                ],
            )
            .unwrap();

        let messages = database.list_builder_messages(&agent.id).unwrap();
        let texts: Vec<&str> = messages.iter().map(|message| message.text.as_str()).collect();
        assert_eq!(texts, ["Make it shorter", "Changed 2 steps", "Add a step", "model error: offline"]);
        assert_eq!(messages[0].role, BuilderMessageRole::User);
        assert_eq!(messages[1].role, BuilderMessageRole::Builder);
        assert_eq!(messages[1].explanation.as_deref(), Some("I made it shorter."));
        assert_eq!(messages[1].changed_step_ids, ["write", "send"]);
        assert_eq!((messages[1].version_before, messages[1].version_after), (Some(1), Some(2)));
        assert_eq!(messages[3].status, BuilderMessageStatus::Failed);
        assert_eq!(messages[3].version_after, None);
    }

    #[test]
    fn blank_explanations_are_not_stored() {
        let reply = NewBuilderMessage::builder_reply("Changed 1 step", Some("  ".into()), (None, 1));
        assert_eq!(reply.explanation, None);
    }

    #[test]
    fn messages_are_per_agent_and_go_with_their_agent() {
        let database = test_database();
        let first_agent = create_test_agent(&database, "First");
        let second_agent = create_test_agent(&database, "Second");
        database.add_builder_messages(&first_agent.id, &[change_reply()]).unwrap();
        assert!(database.list_builder_messages(&second_agent.id).unwrap().is_empty());

        database.delete_agent(&first_agent.id).unwrap();
        let connection = database.lock().unwrap();
        let remaining: i64 =
            connection.query_row("SELECT COUNT(*) FROM builder_messages", [], |row| row.get(0)).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn unknown_agents_are_not_found() {
        let database = test_database();
        assert!(matches!(database.list_builder_messages("ghost"), Err(AppError::NotFound(_))));
        assert!(matches!(database.add_builder_messages("ghost", &[change_reply()]), Err(AppError::NotFound(_))));
    }
}
