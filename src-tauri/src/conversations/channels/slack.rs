//! Slack for chatbots: one Slack app per chatbot, by Socket Mode.
//!
//! Socket Mode means the app connects out to Slack over a WebSocket, so nothing listens
//! on this computer and no public address is needed: it works behind a company firewall
//! and picks up after sleep. It takes two tokens of the same Slack app, both kept in the
//! OS credential store (`channel:slack:<agent id>:bot` and `...:app`): the bot token
//! (`xoxb-`) sends, the app level token (`xapp-`) opens the socket. SQLite keeps only who
//! the app is (`agent_settings` [`APP_SETTING_KEY`]).
//!
//! A direct message to the app is one conversation. A mention of the app in a channel
//! starts a thread, and the thread is the conversation. Slack acknowledges every event
//! the socket delivers; a message delivered twice is dropped by its id
//! ([`ConversationManager::accept_channel_message`]).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use graphrt_channel::slack::{SlackBot, SocketEvent, SocketMode};
use graphrt_channel::{Button, Channel, ChannelError, InboundEvent, Secret};
use serde::{Deserialize, Serialize};

use super::{channel_http_client, delivery_failure, unsupported_message};
use crate::conversations::channel::{
    ChannelAdapter, ChannelCapabilities, DeliveryFailure, DeliveryProblem, InboundMessage, OutboundMessage,
};
use crate::conversations::inbound::{Accepted, ChannelFile, ChannelInbound, MAX_CHANNEL_FILE_BYTES};
use crate::conversations::ConversationManager;
use crate::credentials::CredentialStore;
use crate::desktop::app_settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::storage::models::AgentKind;
use crate::storage::Database;

/// Name of the channel on conversations.
pub const SLACK_CHANNEL: &str = "slack";
/// `agent_settings` key of the connected app ([`SlackAppRecord`]).
pub const APP_SETTING_KEY: &str = "slack_app";
/// First and longest wait after the socket could not open.
const FIRST_BACKOFF: Duration = Duration::from_secs(2);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// How often an app whose channel is switched off checks whether it is on again.
const SWITCHED_OFF_RECHECK: Duration = Duration::from_secs(10);

fn secret_name(agent_id: &str, part: &str) -> String {
    format!("slack:{agent_id}:{part}")
}

/// Who the connected app is, as stored (no token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackAppRecord {
    /// The bot user of the app (`U...`).
    pub bot_user_id: String,
    /// The workspace's name.
    pub team: Option<String>,
}

/// How a chatbot's Slack app is doing. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackState {
    /// Started, the socket is not open yet.
    Starting,
    /// Answering people.
    Connected,
    /// Slack refused a token (wrong, or the app was removed from the workspace). Stopped.
    TokenWrong,
    /// No internet connection, or Slack did not answer. Retrying.
    Offline,
    /// The owner switched Slack off for this chatbot.
    SwitchedOff,
}

/// The Slack connection of a chatbot, for the connect step. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackConnection {
    pub agent_id: String,
    pub app: SlackAppRecord,
    pub state: SlackState,
}

/// The two tokens the owner pastes. Keep `src/api/channelTypes.ts` in sync.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackTokens {
    pub bot_token: String,
    pub app_token: String,
}

impl std::fmt::Debug for SlackTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SlackTokens(<redacted>)")
    }
}

struct RunningApp {
    bot: SlackBot,
    record: SlackAppRecord,
    state: Arc<Mutex<SlackState>>,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// The Slack apps of every chatbot. One per app, shared as `Arc<SlackService>`.
#[derive(Debug)]
pub struct SlackService {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    http: reqwest::Client,
    /// Where the Web API lives (a fake server in tests).
    api_base: Option<String>,
    manager: OnceLock<Weak<ConversationManager>>,
    apps: Mutex<HashMap<String, RunningApp>>,
}

impl std::fmt::Debug for RunningApp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunningApp").field("record", &self.record).finish_non_exhaustive()
    }
}

const BOT_TOKEN_MESSAGE: &str =
    "this is not a Slack bot token. Copy the Bot User OAuth Token from OAuth & Permissions, it starts with xoxb-";
const APP_TOKEN_MESSAGE: &str =
    "this is not a Slack app token. Make one under Basic Information › App-Level Tokens with connections:write, it \
     starts with xapp-";

/// A failed check in plain words.
fn plain_check_error(error: &ChannelError, which: &str) -> AppError {
    let sentence = match error {
        ChannelError::Api { description, .. } if description == "missing_scope" => format!(
            "Slack accepted the {which} but it lacks a permission: add the scopes the steps list and install the app \
             again"
        ),
        ChannelError::Api { .. } => format!(
            "Slack does not accept the {which}. It is wrong, or the app was removed from the workspace: copy it again"
        ),
        ChannelError::Transport { .. } => {
            "Slack cannot be reached. Check the internet connection and try again".to_owned()
        }
        _ => format!("Slack did not accept the {which}. Try again in a moment"),
    };
    AppError::InvalidInput(sentence)
}

impl SlackService {
    /// # Errors
    /// `Internal` when the HTTP client cannot be built.
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>) -> AppResult<Self> {
        Ok(Self {
            db,
            credentials,
            http: channel_http_client()?,
            api_base: None,
            manager: OnceLock::new(),
            apps: Mutex::new(HashMap::new()),
        })
    }

    /// Calls another Web API server (a fake in tests).
    pub fn with_api_base(mut self, api_base: &str) -> Self {
        self.api_base = Some(api_base.trim_end_matches('/').to_owned());
        self
    }

    pub fn adapter(self: &Arc<Self>) -> Arc<SlackAdapter> {
        Arc::new(SlackAdapter { service: self.clone() })
    }

    /// Gives the socket tasks the conversations to deliver to. Call once.
    pub fn attach(&self, manager: &Arc<ConversationManager>) {
        let _already_attached = self.manager.set(Arc::downgrade(manager));
    }

    fn manager(&self) -> Option<Arc<ConversationManager>> {
        self.manager.get().and_then(Weak::upgrade)
    }

    fn clients(&self, tokens: &SlackTokens) -> AppResult<(SlackBot, SocketMode)> {
        let bot = SlackBot::new(self.http.clone(), Secret::new(tokens.bot_token.trim()))
            .map_err(|_| AppError::InvalidInput(BOT_TOKEN_MESSAGE.into()))?;
        let socket = SocketMode::new(self.http.clone(), Secret::new(tokens.app_token.trim()))
            .map_err(|_| AppError::InvalidInput(APP_TOKEN_MESSAGE.into()))?;
        Ok(match &self.api_base {
            Some(base) => (bot.with_base_url(base), socket.with_base_url(base)),
            None => (bot, socket),
        })
    }

    /// Checks both tokens with Slack (who the bot is, and that the socket opens), without saving.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence: not a token, a wrong token, a missing scope, no internet.
    pub async fn check(&self, tokens: &SlackTokens) -> AppResult<SlackAppRecord> {
        let (bot, socket) = self.clients(tokens)?;
        let identity = bot.identity().await.map_err(|error| plain_check_error(&error, "bot token"))?;
        socket.connect().await.map_err(|error| plain_check_error(&error, "app token"))?.close().await;
        Ok(SlackAppRecord { bot_user_id: identity.user_id, team: identity.team })
    }

    /// Connects the Slack app of `tokens` to the chatbot `agent_id`: checks them, saves them
    /// in the OS credential store and starts answering. An app connected before is replaced.
    ///
    /// # Errors
    /// As [`Self::check`]; `InvalidInput` when the agent is not a chatbot or the app answers
    /// for another chatbot; credential store errors.
    pub async fn connect(self: &Arc<Self>, agent_id: &str, tokens: &SlackTokens) -> AppResult<SlackConnection> {
        let agent = self.db.get_agent(agent_id)?;
        if agent.kind != AgentKind::Chatbot {
            return Err(AppError::InvalidInput(format!("{} is not a chatbot", agent.name)));
        }
        let record = self.check(tokens).await?;
        if let Some(other) = self.connected_agent_of(&record.bot_user_id, agent_id)? {
            return Err(AppError::InvalidInput(format!(
                "this Slack app already answers for {other}: disconnect it there first, or make another app"
            )));
        }
        self.credentials.set_channel_secret(&secret_name(agent_id, "bot"), tokens.bot_token.trim())?;
        self.credentials.set_channel_secret(&secret_name(agent_id, "app"), tokens.app_token.trim())?;
        self.db.set_agent_setting(agent_id, APP_SETTING_KEY, &serde_json::to_value(&record)?)?;
        self.start(agent_id, tokens, record.clone())?;
        log::info!("slack: connected an app of {} to chatbot {agent_id}", record.team.as_deref().unwrap_or("?"));
        Ok(SlackConnection { agent_id: agent_id.to_owned(), app: record, state: SlackState::Starting })
    }

    /// Stops answering in Slack for `agent_id` and forgets the app and its tokens.
    ///
    /// # Errors
    /// Credential store or storage errors.
    pub fn disconnect(&self, agent_id: &str) -> AppResult<()> {
        if let Some(running) = self.lock_apps()?.remove(agent_id) {
            running.task.abort();
        }
        self.credentials.delete_channel_secret(&secret_name(agent_id, "bot"))?;
        self.credentials.delete_channel_secret(&secret_name(agent_id, "app"))?;
        self.db.delete_agent_setting(agent_id, APP_SETTING_KEY)
    }

    /// Stops every socket (the app is closing). [`Self::start_saved`] picks up again.
    pub fn stop_all(&self) {
        if let Ok(mut apps) = self.lock_apps() {
            for (_, running) in apps.drain() {
                running.task.abort();
            }
        }
    }

    /// The chatbot's Slack connection, or `None` without an app.
    pub fn connection(&self, agent_id: &str) -> Option<SlackConnection> {
        let apps = self.lock_apps().ok()?;
        let running = apps.get(agent_id)?;
        let state = running.state.lock().map(|state| *state).unwrap_or(SlackState::Starting);
        Some(SlackConnection { agent_id: agent_id.to_owned(), app: running.record.clone(), state })
    }

    /// Starts the apps saved for chatbots (at app start). An app whose tokens are gone from
    /// the credential store is skipped and logged.
    pub fn start_saved(self: &Arc<Self>) {
        let agents = match self.db.agents_with_setting(APP_SETTING_KEY) {
            Ok(agents) => agents,
            Err(error) => {
                log::warn!("slack: could not read the connected apps: {error}");
                return;
            }
        };
        for agent_id in agents {
            if let Err(error) = self.start_saved_one(&agent_id) {
                log::warn!("slack: could not start the app of chatbot {agent_id}: {error}");
            }
        }
    }

    fn start_saved_one(self: &Arc<Self>, agent_id: &str) -> AppResult<()> {
        let Some(record) = self.db.get_agent_setting(agent_id, APP_SETTING_KEY)? else { return Ok(()) };
        let record: SlackAppRecord = serde_json::from_value(record)?;
        let read = |part: &str| {
            self.credentials
                .read_channel_secret(&secret_name(agent_id, part))?
                .ok_or_else(|| AppError::MissingCredentials("the Slack tokens are not in the credential store".into()))
        };
        let tokens = SlackTokens { bot_token: read("bot")?, app_token: read("app")? };
        self.start(agent_id, &tokens, record)
    }

    fn connected_agent_of(&self, bot_user_id: &str, except_agent: &str) -> AppResult<Option<String>> {
        for agent_id in self.db.agents_with_setting(APP_SETTING_KEY)? {
            if agent_id == except_agent {
                continue;
            }
            let record = self.db.get_agent_setting(&agent_id, APP_SETTING_KEY)?;
            if record
                .and_then(|value| serde_json::from_value::<SlackAppRecord>(value).ok())
                .is_some_and(|r| r.bot_user_id == bot_user_id)
            {
                return Ok(Some(self.db.get_agent(&agent_id).map(|agent| agent.name).unwrap_or(agent_id)));
            }
        }
        Ok(None)
    }

    fn start(self: &Arc<Self>, agent_id: &str, tokens: &SlackTokens, record: SlackAppRecord) -> AppResult<()> {
        let (bot, socket) = self.clients(tokens)?;
        let state = Arc::new(Mutex::new(SlackState::Starting));
        let task =
            tauri::async_runtime::spawn(listen(self.clone(), agent_id.to_owned(), bot.clone(), socket, state.clone()));
        let running = RunningApp { bot, record, state, task };
        let mut apps = self.lock_apps()?;
        if let Some(previous) = apps.insert(agent_id.to_owned(), running) {
            previous.task.abort();
        }
        Ok(())
    }

    fn bot_for(&self, agent_id: &str) -> Option<SlackBot> {
        self.lock_apps().ok()?.get(agent_id).map(|running| running.bot.clone())
    }

    fn lock_apps(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, RunningApp>>> {
        self.apps.lock().map_err(|_| AppError::Internal("the Slack app table lock is poisoned".into()))
    }
}

fn set_state(state: &Mutex<SlackState>, new_state: SlackState) {
    if let Ok(mut current) = state.lock() {
        *current = new_state;
    }
}

/// The wait after `failures` failed connections in a row, doubling up to [`MAX_BACKOFF`].
fn backoff_after(failures: u32) -> Duration {
    let factor = 2_u32.saturating_pow(failures.saturating_sub(1).min(8));
    FIRST_BACKOFF.saturating_mul(factor).min(MAX_BACKOFF)
}

/// The socket task of one app: connect, take events, connect again when Slack asks or
/// the connection breaks.
async fn listen(
    service: Arc<SlackService>,
    agent_id: String,
    bot: SlackBot,
    socket: SocketMode,
    state: Arc<Mutex<SlackState>>,
) {
    let mut failures: u32 = 0;
    loop {
        let Some(manager) = service.manager() else {
            log::warn!("slack: no conversations to deliver to; the app of {agent_id} stops");
            return;
        };
        match crate::chatbot_setup::is_channel_enabled(&service.db, &agent_id, SLACK_CHANNEL) {
            Ok(true) => {}
            Ok(false) => {
                set_state(&state, SlackState::SwitchedOff);
                tokio::time::sleep(SWITCHED_OFF_RECHECK).await;
                continue;
            }
            Err(AppError::NotFound(_)) => {
                log::info!("slack: chatbot {agent_id} was deleted; its app stops");
                return;
            }
            Err(error) => log::warn!("slack: {error}"),
        }
        let mut connection = match socket.connect().await {
            Ok(connection) => {
                failures = 0;
                set_state(&state, SlackState::Connected);
                connection
            }
            Err(ChannelError::Api { description, .. })
                if matches!(
                    description.as_str(),
                    "invalid_auth" | "not_authed" | "token_revoked" | "account_inactive"
                ) =>
            {
                log::warn!("slack: the app token of chatbot {agent_id} was refused; the app stops");
                set_state(&state, SlackState::TokenWrong);
                return;
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                log::info!("slack: no socket for chatbot {agent_id} ({error}); retrying");
                set_state(&state, SlackState::Offline);
                tokio::time::sleep(backoff_after(failures)).await;
                continue;
            }
        };
        loop {
            match connection.next().await {
                Ok(Some(SocketEvent::Event(InboundEvent::Message(message)))) => {
                    if let Some(stored) = receive(&service, &manager, &agent_id, &bot, &message).await {
                        let manager = manager.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = manager.answer_channel_message(stored).await {
                                log::warn!("slack: could not answer a message: {error}");
                            }
                        });
                    }
                }
                Ok(Some(SocketEvent::Event(_))) => {}
                Ok(Some(SocketEvent::Reconnect)) | Ok(None) => break,
                Err(error) => {
                    log::info!("slack: the socket of chatbot {agent_id} broke ({error}); connecting again");
                    break;
                }
            }
        }
    }
}

/// Stores one message. `None` when there is nothing to answer.
async fn receive(
    service: &SlackService,
    manager: &Arc<ConversationManager>,
    agent_id: &str,
    bot: &SlackBot,
    message: &graphrt_channel::InboundMessage,
) -> Option<Box<crate::conversations::inbound::StoredInbound>> {
    if message.choice.is_some() {
        // Replaces the tapped buttons with the choice; nothing depends on it.
        if let Err(error) = bot.typing(message).await {
            log::info!("slack: could not mark a button tap: {error}");
        }
    }
    if message.unsupported.is_some() && message.attachments.is_empty() && message.text.trim().is_empty() {
        let language = AppSettings::load_or_default(&service.db).language.unwrap_or_default();
        if let Err(error) = bot.send_text(&message.chat_id, unsupported_message(language), &[]).await {
            log::info!("slack: could not answer an unsupported message: {error}");
        }
        return None;
    }
    let mut files = Vec::new();
    let mut missed_files = 0;
    for attachment in &message.attachments {
        match bot.download(attachment, MAX_CHANNEL_FILE_BYTES).await {
            Ok(download) => files.push(ChannelFile {
                name: download.name.or_else(|| attachment.name.clone()).unwrap_or_else(|| "file".to_owned()),
                bytes: download.bytes,
            }),
            Err(error) => {
                log::info!("slack: a file was not fetched: {error}");
                missed_files += 1;
            }
        }
    }
    let inbound = ChannelInbound {
        message_id: message.id.clone(),
        customer_handle: message.chat_id.clone(),
        customer_name: message.customer.name.clone().or_else(|| Some(message.customer.id.clone())),
        text: message.text.clone(),
        files,
        missed_files,
    };
    match manager.accept_channel_message(SLACK_CHANNEL, agent_id, inbound).await {
        Ok(Accepted::Stored(stored)) => Some(stored),
        Ok(Accepted::Duplicate | Accepted::ChannelOff) => None,
        Err(error) => {
            log::warn!("slack: could not store a message for chatbot {agent_id}: {error}");
            None
        }
    }
}

/// Sends replies of a chatbot through its own Slack app.
#[derive(Debug)]
pub struct SlackAdapter {
    service: Arc<SlackService>,
}

impl ChannelAdapter for SlackAdapter {
    fn name(&self) -> &'static str {
        SLACK_CHANNEL
    }

    /// Slack shows Markdown (sent as `mrkdwn`), pictures and buttons; cards are written out
    /// with their choices as Block Kit buttons.
    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: true, markup: graphrt_ui::fallback::Markup::Markdown }
    }

    /// An Events API `event_callback` (for tools that replay one).
    fn parse_inbound(&self, payload: &serde_json::Value) -> AppResult<InboundMessage> {
        match graphrt_channel::slack::parse_event_callback(payload) {
            InboundEvent::Message(message) if !message.text.trim().is_empty() => Ok(InboundMessage {
                customer_handle: message.chat_id,
                customer_name: message.customer.name,
                text: message.text,
            }),
            _ => Err(AppError::InvalidInput("this Slack event is not a message".into())),
        }
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), DeliveryFailure>> {
        Box::pin(async move {
            let bot = self.service.bot_for(&outbound.conversation.agent_id).ok_or_else(|| {
                DeliveryFailure::new(DeliveryProblem::NotConnected, "Slack is not connected for this chatbot")
            })?;
            let chat = &outbound.conversation.customer_handle;
            if !outbound.text.trim().is_empty() {
                let buttons: Vec<Button> = outbound
                    .buttons
                    .iter()
                    .map(|button| Button { id: button.id.clone(), title: button.title.clone() })
                    .collect();
                bot.send_text(chat, outbound.text, &buttons).await.map_err(|error| delivery_failure(&error))?;
            }
            for image in outbound.images {
                let file = graphrt_channel::OutboundFile {
                    name: "chart.png".to_owned(),
                    mime_type: "image/png".to_owned(),
                    bytes: image.png.clone(),
                    caption: image.caption.clone(),
                };
                bot.send_file(chat, &file).await.map_err(|error| delivery_failure(&error))?;
            }
            for file in outbound.files {
                let file = graphrt_channel::OutboundFile {
                    name: file.name.clone(),
                    mime_type: file.mime_type.clone(),
                    bytes: file.bytes.clone(),
                    caption: None,
                };
                bot.send_file(chat, &file).await.map_err(|error| delivery_failure(&error))?;
            }
            Ok(())
        })
    }

    fn is_connected_for(&self, agent_id: &str) -> bool {
        self.service.bot_for(agent_id).is_some()
    }

    fn account_label(&self, agent_id: &str) -> Option<String> {
        self.service.connection(agent_id)?.app.team
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_never_print_and_the_wait_grows_to_a_minute() {
        let tokens = SlackTokens { bot_token: "xoxb-secret".into(), app_token: "xapp-secret".into() };
        assert!(!format!("{tokens:?}").contains("secret"));
        assert_eq!(backoff_after(1), Duration::from_secs(2));
        assert_eq!(backoff_after(20), MAX_BACKOFF);
    }
}
