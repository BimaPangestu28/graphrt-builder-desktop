//! The connect step of a chatbot's customer channels: Telegram (a bot token from
//! @BotFather), Slack (an app's bot and app tokens, by Socket Mode), the personal WhatsApp
//! linked with the `whatsapp-web` plugin, and WhatsApp Business and Microsoft Teams for a
//! chatbot that runs online. See `crate::conversations::channels`.
//!
//! Tokens go to the OS credential store and never come back to the webview; only the
//! WhatsApp verify token is shown, on request, because the owner types it into the Meta app.

use tauri::State;

use crate::conversations::channels::slack::{SlackAppRecord, SlackConnection, SlackTokens};
use crate::conversations::channels::teams_online::{TeamsBotInput, TeamsSetup};
use crate::conversations::channels::telegram::{TelegramConnection, TelegramTokenCheck};
use crate::conversations::channels::whatsapp_online::{
    WhatsAppBusinessInput, WhatsAppBusinessNumber, WhatsAppBusinessSetup,
};
use crate::conversations::channels::whatsapp_web::WhatsAppWebChannel;
use crate::error::AppResult;
use crate::state::AppState;

/// Asks Telegram who the bot of `token` is (nothing is saved).
#[tauri::command]
pub async fn check_telegram_token(state: State<'_, AppState>, token: String) -> AppResult<TelegramTokenCheck> {
    state.telegram.check_token(&token).await
}

/// Connects a Telegram bot to the chatbot and starts answering on it.
#[tauri::command]
pub async fn connect_telegram(
    state: State<'_, AppState>,
    agent_id: String,
    token: String,
) -> AppResult<TelegramConnection> {
    let telegram = state.telegram.clone();
    telegram.connect(&agent_id, &token).await
}

/// Stops answering on Telegram and forgets the bot's token.
#[tauri::command]
pub fn disconnect_telegram(state: State<'_, AppState>, agent_id: String) -> AppResult<()> {
    state.telegram.disconnect(&agent_id)
}

/// The chatbot's Telegram bot and how it is doing, or `null` without one.
#[tauri::command]
pub fn get_telegram_connection(state: State<'_, AppState>, agent_id: String) -> Option<TelegramConnection> {
    state.telegram.connection(&agent_id)
}

/// Checks the two tokens of a Slack app with Slack (nothing is saved).
#[tauri::command]
pub async fn check_slack_tokens(state: State<'_, AppState>, tokens: SlackTokens) -> AppResult<SlackAppRecord> {
    state.slack.check(&tokens).await
}

/// Connects a Slack app to the chatbot and starts answering in Slack.
#[tauri::command]
pub async fn connect_slack(
    state: State<'_, AppState>,
    agent_id: String,
    tokens: SlackTokens,
) -> AppResult<SlackConnection> {
    let slack = state.slack.clone();
    slack.connect(&agent_id, &tokens).await
}

/// Stops answering in Slack and forgets the app's tokens.
#[tauri::command]
pub fn disconnect_slack(state: State<'_, AppState>, agent_id: String) -> AppResult<()> {
    state.slack.disconnect(&agent_id)
}

/// The chatbot's Slack app and how it is doing, or `null` without one.
#[tauri::command]
pub fn get_slack_connection(state: State<'_, AppState>, agent_id: String) -> Option<SlackConnection> {
    state.slack.connection(&agent_id)
}

/// Which chatbot answers the personal WhatsApp, and how it is doing.
#[tauri::command]
pub fn get_whatsapp_web_channel(state: State<'_, AppState>) -> WhatsAppWebChannel {
    state.whatsapp_web.channel()
}

/// Lets a chatbot answer the personal WhatsApp (`null`: none does).
#[tauri::command]
pub fn set_whatsapp_web_chatbot(state: State<'_, AppState>, agent_id: Option<String>) -> AppResult<WhatsAppWebChannel> {
    state.whatsapp_web.assign(agent_id.as_deref())
}

/// The WhatsApp Business step of a chatbot.
#[tauri::command]
pub fn get_whatsapp_business_setup(state: State<'_, AppState>, agent_id: String) -> AppResult<WhatsAppBusinessSetup> {
    state.whatsapp_online.setup(&agent_id, state.deploy.cli_knows_channels())
}

/// Checks the WhatsApp Business values with Meta and saves them in the OS credential store.
#[tauri::command]
pub async fn save_whatsapp_business(
    state: State<'_, AppState>,
    agent_id: String,
    input: WhatsAppBusinessInput,
) -> AppResult<WhatsAppBusinessNumber> {
    state.whatsapp_online.save(&agent_id, &input).await
}

/// The verify token to type into the Meta app.
#[tauri::command]
pub fn reveal_whatsapp_verify_token(state: State<'_, AppState>, agent_id: String) -> AppResult<String> {
    state.whatsapp_online.verify_token(&agent_id)
}

/// Forgets the WhatsApp Business values of the chatbot.
#[tauri::command]
pub fn forget_whatsapp_business(state: State<'_, AppState>, agent_id: String) -> AppResult<()> {
    state.whatsapp_online.forget(&agent_id)
}

/// The Microsoft Teams step of a chatbot.
#[tauri::command]
pub fn get_teams_setup(state: State<'_, AppState>, agent_id: String) -> AppResult<TeamsSetup> {
    state.teams_online.setup(&agent_id, state.deploy.cli_knows_channels())
}

/// Checks the Azure Bot's values with Microsoft and saves them in the OS credential store.
#[tauri::command]
pub async fn save_teams_bot(state: State<'_, AppState>, agent_id: String, input: TeamsBotInput) -> AppResult<()> {
    state.teams_online.save(&agent_id, &input).await
}

/// Forgets the Azure Bot's values of the chatbot.
#[tauri::command]
pub fn forget_teams_bot(state: State<'_, AppState>, agent_id: String) -> AppResult<()> {
    state.teams_online.forget(&agent_id)
}
