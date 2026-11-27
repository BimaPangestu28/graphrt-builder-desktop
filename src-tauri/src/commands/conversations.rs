use tauri::State;

use crate::conversations::models::{Conversation, ConversationCounts, ConversationDetail, ConversationFilter, Message};
use crate::conversations::visuals::CardAnswer;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn list_conversations(
    state: State<'_, AppState>,
    filter: Option<ConversationFilter>,
) -> AppResult<Vec<Conversation>> {
    state.conversations.list_conversations(&filter.unwrap_or_default())
}

#[tauri::command]
pub fn count_conversations(state: State<'_, AppState>, agent_id: Option<String>) -> AppResult<ConversationCounts> {
    state.conversations.count_conversations(agent_id.as_deref())
}

#[tauri::command]
pub fn get_conversation(state: State<'_, AppState>, conversation_id: String) -> AppResult<ConversationDetail> {
    state.conversations.get_conversation(&conversation_id)
}

#[tauri::command]
pub fn start_test_conversation(state: State<'_, AppState>, agent_id: String) -> AppResult<ConversationDetail> {
    state.conversations.start_test_conversation(&agent_id)
}

/// Simulated inbound message for the "Try it" panel; resolves after the bot's turn.
/// `attachments` are the references of files attached to this conversation
/// (`commands::agent_files::pick_chat_attachments`).
#[tauri::command]
pub async fn send_customer_message(
    state: State<'_, AppState>,
    conversation_id: String,
    text: String,
    attachments: Option<Vec<String>>,
) -> AppResult<ConversationDetail> {
    let attachments = attachments.unwrap_or_default();
    state.conversations.send_customer_message_with_files(&conversation_id, &text, &attachments).await
}

/// A card button pressed in the "Try it" panel; resolves after the bot's turn.
#[tauri::command]
pub async fn send_customer_card_answer(
    state: State<'_, AppState>,
    conversation_id: String,
    answer: CardAnswer,
) -> AppResult<ConversationDetail> {
    state.conversations.send_customer_card_answer(&conversation_id, answer).await
}

#[tauri::command]
pub fn take_over(state: State<'_, AppState>, conversation_id: String) -> AppResult<Conversation> {
    state.conversations.take_over(&conversation_id)
}

#[tauri::command]
pub fn hand_back(state: State<'_, AppState>, conversation_id: String) -> AppResult<Conversation> {
    state.conversations.hand_back(&conversation_id)
}

#[tauri::command]
pub async fn send_operator_reply(
    state: State<'_, AppState>,
    conversation_id: String,
    text: String,
    attachments: Option<Vec<String>>,
) -> AppResult<Message> {
    let attachments = attachments.unwrap_or_default();
    state.conversations.send_operator_reply_with_files(&conversation_id, &text, &attachments).await
}

#[tauri::command]
pub fn close_conversation(state: State<'_, AppState>, conversation_id: String) -> AppResult<Conversation> {
    state.conversations.close_conversation(&conversation_id)
}

#[tauri::command]
pub fn set_bot_enabled(state: State<'_, AppState>, agent_id: String, enabled: bool) -> AppResult<bool> {
    state.conversations.set_bot_enabled(&agent_id, enabled)
}

#[tauri::command]
pub fn get_bot_enabled(state: State<'_, AppState>, agent_id: String) -> AppResult<bool> {
    state.conversations.is_bot_enabled(&agent_id)
}
