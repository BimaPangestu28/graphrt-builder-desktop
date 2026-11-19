//! Saves the builder chat (screen 04) so it survives leaving the screen.
//!
//! The change itself is what matters: a chat message that cannot be saved is
//! logged and dropped, never turned into a failed build or revision.

use std::future::Future;

use crate::error::AppResult;
use crate::storage::models::{Agent, NewBuilderMessage};
use crate::storage::Database;

use super::RevisionResult;

/// Text of the builder's first reply, saved with the model's explanation of the new agent.
pub const BUILD_REPLY_TEXT: &str = "Your agent is ready";

/// Runs a chat revision, then saves the request and the builder's reply: the
/// summary, explanation, changed steps and versions, or the error message when
/// it failed (`AppError` messages never contain secrets).
pub(crate) async fn revise_with_chat_history(
    db: &Database,
    agent_id: &str,
    instruction: &str,
    revision: impl Future<Output = AppResult<RevisionResult>>,
) -> AppResult<RevisionResult> {
    let version_before = db.get_agent(agent_id).ok().map(|agent| agent.current_version);
    let outcome = revision.await;
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return outcome;
    }
    let reply = match &outcome {
        Ok(revision) => NewBuilderMessage {
            changed_step_ids: revision.changed_step_ids.clone(),
            ..NewBuilderMessage::builder_reply(
                &revision.summary,
                Some(revision.explanation.trim().to_owned()),
                (version_before, revision.agent.current_version),
            )
        },
        Err(error) => NewBuilderMessage::builder_failure(&error.to_string(), version_before),
    };
    save_messages(db, agent_id, &[NewBuilderMessage::user_request(instruction, version_before), reply]);
    outcome
}

/// Saves the builder's first reply to a new agent with the model's explanation.
pub(crate) fn record_build(db: &Database, agent: &Agent, explanation: &str) {
    let reply = NewBuilderMessage::builder_reply(
        BUILD_REPLY_TEXT,
        Some(explanation.trim().to_owned()),
        (None, agent.current_version),
    );
    save_messages(db, &agent.id, &[reply]);
}

/// Notes a restore (Undo / Redo or the version history) in the chat; restoring
/// the current steps again adds no version and no message.
pub fn record_restore(db: &Database, agent_before: &Agent, agent_after: &Agent, restored_version: i64) {
    if agent_after.current_version == agent_before.current_version {
        return;
    }
    let reply = NewBuilderMessage::builder_reply(
        &format!("Restored version {restored_version}"),
        None,
        (Some(agent_before.current_version), agent_after.current_version),
    );
    save_messages(db, &agent_after.id, &[reply]);
}

fn save_messages(db: &Database, agent_id: &str, messages: &[NewBuilderMessage]) {
    if let Err(error) = db.add_builder_messages(agent_id, messages) {
        log::warn!("could not save the builder chat of agent {agent_id}: {error}");
    }
}
