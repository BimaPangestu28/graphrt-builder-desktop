//! Chatbot setup (screen 14): persona, hand-off rules, knowledge and channels.
//! See `crate::chatbot_setup` for how the saved setup reaches the bot.

use tauri::State;

use crate::chatbot_setup::{self, ChannelLink, ChatbotSettings, ChatbotSetup};
use crate::conversations::ConversationManager;
use crate::error::AppResult;
use crate::state::AppState;

/// The chatbot's setup; defaults derived from the agent until saved once.
#[tauri::command]
pub fn get_chatbot_setup(state: State<'_, AppState>, agent_id: String) -> AppResult<ChatbotSetup> {
    let conversations = state.conversations.clone();
    let links = channel_links(&conversations, &agent_id);
    chatbot_setup::get_chatbot_setup(&state.db, &agent_id, &links)
}

/// Saves the setup; the bot's next reply uses it.
#[tauri::command]
pub fn save_chatbot_settings(
    state: State<'_, AppState>,
    agent_id: String,
    settings: ChatbotSettings,
) -> AppResult<ChatbotSetup> {
    let conversations = state.conversations.clone();
    let links = channel_links(&conversations, &agent_id);
    chatbot_setup::save_chatbot_settings(&state.db, &agent_id, settings, &links)
}

/// Lets the chatbot answer from a knowledge base.
#[tauri::command]
pub fn attach_chatbot_knowledge(
    state: State<'_, AppState>,
    agent_id: String,
    knowledge_base_id: String,
) -> AppResult<ChatbotSetup> {
    let conversations = state.conversations.clone();
    let links = channel_links(&conversations, &agent_id);
    chatbot_setup::attach_knowledge_base(&state.db, &agent_id, &knowledge_base_id, &links)
}

/// Stops the chatbot answering from a knowledge base.
#[tauri::command]
pub fn detach_chatbot_knowledge(
    state: State<'_, AppState>,
    agent_id: String,
    knowledge_base_id: String,
) -> AppResult<ChatbotSetup> {
    let conversations = state.conversations.clone();
    let links = channel_links(&conversations, &agent_id);
    chatbot_setup::detach_knowledge_base(&state.db, &agent_id, &knowledge_base_id, &links)
}

/// How each channel is connected for `agent_id`, as the setup screen lists it.
fn channel_links<'a>(conversations: &'a ConversationManager, agent_id: &'a str) -> impl Fn(&str) -> ChannelLink + 'a {
    move |channel| ChannelLink {
        connected: conversations.is_channel_connected_for(channel, agent_id),
        account: conversations.channel_account(channel, agent_id),
    }
}
