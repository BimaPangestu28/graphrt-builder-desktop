//! Telegram for chatbots: one bot (token from @BotFather) per chatbot, by long polling.
//!
//! The token lives in the OS credential store (`channel:telegram:<agent id>`); SQLite keeps
//! only who the bot is (`agent_settings` [`BOT_SETTING_KEY`]) and the last update it
//! handled ([`CURSOR_SETTING_KEY`]).
//!
//! Each connected bot has one polling task. It asks Telegram for updates after the stored
//! cursor (`getUpdates`, waiting up to [`POLL_WAIT_SECS`]), and for each update, in order:
//! drops it when its id is not above the cursor (a repeat), fetches the customer's files,
//! stores the message ([`ConversationManager::accept_channel_message`], which also drops a
//! message id seen before), stores the cursor, and only then starts the bot's answer. The
//! next `getUpdates` from the stored cursor confirms the update to Telegram. So a sleep,
//! a lost connection or a restart in the middle loses no message and answers none twice:
//! Telegram keeps updates for 24 hours, and a message stored but not answered is answered
//! at the next start (`answer_unanswered_channel_messages`).
//!
//! Failures are told in plain words ([`TelegramState`]): a wrong or revoked token stops the
//! task until the owner connects a new one; no internet retries with a backoff of
//! [`FIRST_BACKOFF`] up to [`MAX_BACKOFF`]; another program reading the same bot is said
//! as such. While the owner switched Telegram off for the chatbot, the task does not ask
//! for updates, so messages wait at Telegram.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use graphrt_channel::telegram::{self, BotIdentity, TelegramBot};
use graphrt_channel::{Button, Channel, ChannelError, ChatKind, InboundEvent, Secret};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{channel_http_client, delivery_failure, unsupported_message};
use crate::conversations::channel::{
    ChannelAdapter, ChannelCapabilities, DeliveryFailure, DeliveryProblem, InboundMessage, OutboundMessage,
};
use crate::conversations::inbound::{Accepted, ChannelFile, ChannelInbound, MAX_CHANNEL_FILE_BYTES};
use crate::conversations::models::Conversation;
use crate::conversations::ConversationManager;
use crate::credentials::CredentialStore;
use crate::desktop::app_settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::storage::models::AgentKind;
use crate::storage::Database;

/// Name of the channel on conversations.
pub const TELEGRAM_CHANNEL: &str = "telegram";
/// `agent_settings` key of the connected bot ([`TelegramBotRecord`]).
pub const BOT_SETTING_KEY: &str = "telegram_bot";
/// `agent_settings` key of the last update id handled.
pub const CURSOR_SETTING_KEY: &str = "telegram_cursor";
/// Seconds one `getUpdates` waits for a message.
pub const POLL_WAIT_SECS: u64 = 25;
/// First and longest wait after a failed `getUpdates`.
pub const FIRST_BACKOFF: Duration = Duration::from_secs(2);
pub const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// How often a bot whose channel is switched off checks whether it is on again.
const SWITCHED_OFF_RECHECK: Duration = Duration::from_secs(10);

fn secret_name(agent_id: &str) -> String {
    format!("telegram:{agent_id}")
}

/// Who the connected bot is, as stored (no token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramBotRecord {
    pub id: String,
    /// Without the `@`.
    pub username: Option<String>,
    pub name: Option<String>,
}

impl From<BotIdentity> for TelegramBotRecord {
    fn from(identity: BotIdentity) -> Self {
        Self { id: identity.id, username: identity.username, name: identity.name }
    }
}

impl TelegramBotRecord {
    /// `https://t.me/<username>`, where customers open the bot.
    pub fn link(&self) -> Option<String> {
        self.username.as_ref().map(|username| format!("https://t.me/{username}"))
    }
}

/// How a chatbot's Telegram bot is doing. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramState {
    /// Started, the first answer from Telegram has not arrived yet.
    Starting,
    /// Answering customers.
    Connected,
    /// Telegram refused the token (wrong, or revoked in @BotFather). Polling stopped.
    TokenWrong,
    /// No internet connection, or Telegram did not answer. Retrying.
    Offline,
    /// Another program reads this bot's messages (another app or a server). Retrying.
    OtherProgram,
    /// The owner switched Telegram off for this chatbot: messages wait at Telegram.
    SwitchedOff,
}

/// The Telegram connection of a chatbot, for the connect step. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConnection {
    pub agent_id: String,
    pub bot: TelegramBotRecord,
    /// `https://t.me/<username>`.
    pub link: Option<String>,
    pub state: TelegramState,
}

/// The bot of a token, checked with Telegram (not saved). Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramTokenCheck {
    pub bot: TelegramBotRecord,
    pub link: Option<String>,
}

struct RunningBot {
    bot: TelegramBot,
    record: TelegramBotRecord,
    state: Arc<Mutex<TelegramState>>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl std::fmt::Debug for RunningBot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunningBot").field("record", &self.record).finish_non_exhaustive()
    }
}

/// The Telegram bots of every chatbot. One per app, shared as `Arc<TelegramService>`.
#[derive(Debug)]
pub struct TelegramService {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    http: reqwest::Client,
    /// Where the Bot API lives (a fake server in tests).
    api_base: Option<String>,
    manager: OnceLock<Weak<ConversationManager>>,
    bots: Mutex<HashMap<String, RunningBot>>,
}

impl TelegramService {
    /// # Errors
    /// `Internal` when the HTTP client cannot be built.
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>) -> AppResult<Self> {
        Ok(Self {
            db,
            credentials,
            http: channel_http_client()?,
            api_base: None,
            manager: OnceLock::new(),
            bots: Mutex::new(HashMap::new()),
        })
    }

    /// Calls another Bot API server (a fake in tests).
    pub fn with_api_base(mut self, api_base: &str) -> Self {
        self.api_base = Some(api_base.trim_end_matches('/').to_owned());
        self
    }

    /// The adapter to register with `ConversationManager::with_channel`.
    pub fn adapter(self: &Arc<Self>) -> Arc<TelegramAdapter> {
        Arc::new(TelegramAdapter { service: self.clone() })
    }

    /// Gives the polling tasks the conversations to deliver to. Call once, after the
    /// manager was built with [`Self::adapter`].
    pub fn attach(&self, manager: &Arc<ConversationManager>) {
        let _already_attached = self.manager.set(Arc::downgrade(manager));
    }

    fn manager(&self) -> Option<Arc<ConversationManager>> {
        self.manager.get().and_then(Weak::upgrade)
    }

    fn bot_of(&self, token: &str) -> AppResult<TelegramBot> {
        let bot = TelegramBot::new(self.http.clone(), Secret::new(token.trim()))
            .map_err(|_| AppError::InvalidInput(TOKEN_SHAPE_MESSAGE.into()))?;
        Ok(match &self.api_base {
            Some(api_base) => bot.with_base_url(api_base),
            None => bot,
        })
    }

    /// Asks Telegram who the bot of `token` is, without saving anything.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence: not a token, a wrong or revoked token, no internet.
    pub async fn check_token(&self, token: &str) -> AppResult<TelegramTokenCheck> {
        let bot = self.bot_of(token)?;
        let record = TelegramBotRecord::from(bot.get_me().await.map_err(|error| plain_check_error(&error))?);
        Ok(TelegramTokenCheck { link: record.link(), bot: record })
    }

    /// Connects the bot of `token` to the chatbot `agent_id`: checks it, removes a webhook
    /// another program set (the owner moves the bot here), saves the token in the OS
    /// credential store and starts answering. A bot connected before is replaced.
    ///
    /// # Errors
    /// As [`Self::check_token`]; `NotFound` / `InvalidInput` when the agent is not a
    /// chatbot; credential store errors.
    pub async fn connect(self: &Arc<Self>, agent_id: &str, token: &str) -> AppResult<TelegramConnection> {
        let agent = self.db.get_agent(agent_id)?;
        if agent.kind != AgentKind::Chatbot {
            return Err(AppError::InvalidInput(format!("{} is not a chatbot", agent.name)));
        }
        let bot = self.bot_of(token)?;
        let record = TelegramBotRecord::from(bot.get_me().await.map_err(|error| plain_check_error(&error))?);
        if let Some(other) = self.connected_agent_of(&record.id, agent_id)? {
            return Err(AppError::InvalidInput(format!(
                "this bot already answers for {other}: disconnect it there first, or make a new bot with @BotFather"
            )));
        }
        match bot.webhook_url().await {
            Ok(Some(_)) => {
                log::info!(
                    "telegram: removing the webhook of @{:?} so this app can read its messages",
                    record.username
                );
                bot.delete_webhook().await.map_err(|error| plain_check_error(&error))?;
            }
            Ok(None) => {}
            Err(error) => return Err(plain_check_error(&error)),
        }
        let previous = self.db.get_agent_setting(agent_id, BOT_SETTING_KEY)?;
        let same_bot = previous
            .and_then(|value| serde_json::from_value::<TelegramBotRecord>(value).ok())
            .is_some_and(|previous| previous.id == record.id);
        self.credentials.set_channel_secret(&secret_name(agent_id), token.trim())?;
        self.db.set_agent_setting(agent_id, BOT_SETTING_KEY, &serde_json::to_value(&record)?)?;
        if !same_bot {
            // Update ids belong to a bot: a new bot starts from its own oldest waiting update.
            self.db.delete_agent_setting(agent_id, CURSOR_SETTING_KEY)?;
        }
        self.start(agent_id, bot, record.clone());
        log::info!("telegram: connected @{} to chatbot {agent_id}", record.username.as_deref().unwrap_or("?"));
        Ok(TelegramConnection {
            agent_id: agent_id.to_owned(),
            link: record.link(),
            bot: record,
            state: TelegramState::Starting,
        })
    }

    /// Stops answering on Telegram for `agent_id` and forgets the bot and its token.
    ///
    /// # Errors
    /// Credential store or storage errors.
    pub fn disconnect(&self, agent_id: &str) -> AppResult<()> {
        if let Some(running) = self.lock_bots()?.remove(agent_id) {
            running.task.abort();
        }
        self.credentials.delete_channel_secret(&secret_name(agent_id))?;
        self.db.delete_agent_setting(agent_id, BOT_SETTING_KEY)?;
        self.db.delete_agent_setting(agent_id, CURSOR_SETTING_KEY)?;
        Ok(())
    }

    /// Stops every polling task (the app is closing, or a test restarts the app). Nothing
    /// is forgotten: [`Self::start_saved`] picks up where they stopped.
    pub fn stop_all(&self) {
        if let Ok(mut bots) = self.lock_bots() {
            for (_, running) in bots.drain() {
                running.task.abort();
            }
        }
    }

    /// The chatbot's Telegram connection, or `None` when it has no bot.
    pub fn connection(&self, agent_id: &str) -> Option<TelegramConnection> {
        let bots = self.lock_bots().ok()?;
        let running = bots.get(agent_id)?;
        let state = running.state.lock().map(|state| *state).unwrap_or(TelegramState::Starting);
        Some(TelegramConnection {
            agent_id: agent_id.to_owned(),
            bot: running.record.clone(),
            link: running.record.link(),
            state,
        })
    }

    /// Starts the bots saved for chatbots (at app start). A bot whose token is gone from
    /// the credential store is skipped and logged.
    pub fn start_saved(self: &Arc<Self>) {
        let agents = match self.db.agents_with_setting(BOT_SETTING_KEY) {
            Ok(agents) => agents,
            Err(error) => {
                log::warn!("telegram: could not read the connected bots: {error}");
                return;
            }
        };
        for agent_id in agents {
            if let Err(error) = self.start_saved_one(&agent_id) {
                log::warn!("telegram: could not start the bot of chatbot {agent_id}: {error}");
            }
        }
    }

    fn start_saved_one(self: &Arc<Self>, agent_id: &str) -> AppResult<()> {
        let Some(record) = self.db.get_agent_setting(agent_id, BOT_SETTING_KEY)? else { return Ok(()) };
        let record: TelegramBotRecord = serde_json::from_value(record)?;
        let token = self.credentials.read_channel_secret(&secret_name(agent_id))?.ok_or_else(|| {
            AppError::MissingCredentials("the Telegram bot token is not in the credential store".into())
        })?;
        self.start(agent_id, self.bot_of(&token)?, record);
        Ok(())
    }

    /// The other chatbot the bot `bot_id` answers for, by name.
    fn connected_agent_of(&self, bot_id: &str, except_agent: &str) -> AppResult<Option<String>> {
        for agent_id in self.db.agents_with_setting(BOT_SETTING_KEY)? {
            if agent_id == except_agent {
                continue;
            }
            let record = self.db.get_agent_setting(&agent_id, BOT_SETTING_KEY)?;
            if record
                .and_then(|value| serde_json::from_value::<TelegramBotRecord>(value).ok())
                .is_some_and(|r| r.id == bot_id)
            {
                return Ok(Some(self.db.get_agent(&agent_id).map(|agent| agent.name).unwrap_or(agent_id)));
            }
        }
        Ok(None)
    }

    fn start(self: &Arc<Self>, agent_id: &str, bot: TelegramBot, record: TelegramBotRecord) {
        let state = Arc::new(Mutex::new(TelegramState::Starting));
        let task = tauri::async_runtime::spawn(poll(self.clone(), agent_id.to_owned(), bot.clone(), state.clone()));
        let running = RunningBot { bot, record, state, task };
        match self.lock_bots() {
            Ok(mut bots) => {
                if let Some(previous) = bots.insert(agent_id.to_owned(), running) {
                    previous.task.abort();
                }
            }
            Err(error) => {
                log::warn!("telegram: {error}");
                running.task.abort();
            }
        }
    }

    fn bot_for(&self, agent_id: &str) -> Option<TelegramBot> {
        self.lock_bots().ok()?.get(agent_id).map(|running| running.bot.clone())
    }

    fn lock_bots(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, RunningBot>>> {
        self.bots.lock().map_err(|_| AppError::Internal("the Telegram bot table lock is poisoned".into()))
    }

    fn cursor(&self, agent_id: &str) -> Option<i64> {
        self.db.get_agent_setting(agent_id, CURSOR_SETTING_KEY).ok().flatten().and_then(|value| value.as_i64())
    }

    fn save_cursor(&self, agent_id: &str, update_id: i64) -> AppResult<()> {
        self.db.set_agent_setting(agent_id, CURSOR_SETTING_KEY, &json!(update_id))
    }
}

const TOKEN_SHAPE_MESSAGE: &str =
    "this is not a Telegram bot token. Copy the whole token @BotFather sent, it looks like 123456789:AAE…";

/// A failed token check in plain words.
fn plain_check_error(error: &ChannelError) -> AppError {
    let sentence = match error {
        ChannelError::Api { status: 401 | 404, .. } => {
            "Telegram does not know this token. It is wrong, or it was revoked in @BotFather: copy it again"
        }
        ChannelError::Transport { .. } => "Telegram cannot be reached. Check the internet connection and try again",
        ChannelError::Invalid(_) => TOKEN_SHAPE_MESSAGE,
        _ => "Telegram did not accept the token. Try again in a moment",
    };
    AppError::InvalidInput(sentence.into())
}

fn set_state(state: &Mutex<TelegramState>, new_state: TelegramState) {
    if let Ok(mut current) = state.lock() {
        *current = new_state;
    }
}

/// The polling task of one bot (see the module docs).
async fn poll(service: Arc<TelegramService>, agent_id: String, bot: TelegramBot, state: Arc<Mutex<TelegramState>>) {
    let mut failures: u32 = 0;
    let mut removed_webhook = false;
    loop {
        let Some(manager) = service.manager() else {
            log::warn!("telegram: no conversations to deliver to; the bot of {agent_id} stops");
            return;
        };
        match crate::chatbot_setup::is_channel_enabled(&service.db, &agent_id, TELEGRAM_CHANNEL) {
            Ok(true) => {}
            Ok(false) => {
                set_state(&state, TelegramState::SwitchedOff);
                tokio::time::sleep(SWITCHED_OFF_RECHECK).await;
                continue;
            }
            Err(AppError::NotFound(_)) => {
                log::info!("telegram: chatbot {agent_id} was deleted; its bot stops");
                return;
            }
            Err(error) => log::warn!("telegram: {error}"),
        }
        let cursor = service.cursor(&agent_id);
        match bot.get_updates(cursor.map(|cursor| cursor.saturating_add(1)), POLL_WAIT_SECS).await {
            Ok(updates) => {
                failures = 0;
                set_state(&state, TelegramState::Connected);
                for update in updates {
                    handle_update(&service, &manager, &agent_id, &bot, &update).await;
                }
            }
            Err(ChannelError::Api { status: 401 | 404, .. }) => {
                log::warn!("telegram: the token of chatbot {agent_id} was refused; polling stops");
                set_state(&state, TelegramState::TokenWrong);
                return;
            }
            Err(ChannelError::Api { status: 409, .. }) => {
                failures = failures.saturating_add(1);
                // A webhook set after connecting (another program) blocks polling: remove it once.
                if !removed_webhook && matches!(bot.webhook_url().await, Ok(Some(_))) {
                    removed_webhook = true;
                    if bot.delete_webhook().await.is_ok() {
                        continue;
                    }
                }
                set_state(&state, TelegramState::OtherProgram);
                tokio::time::sleep(backoff_after(failures)).await;
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                log::info!("telegram: no updates for chatbot {agent_id} ({error}); retrying");
                set_state(&state, TelegramState::Offline);
                tokio::time::sleep(backoff_after(failures)).await;
            }
        }
    }
}

/// The wait after `failures` failed calls in a row: doubling from [`FIRST_BACKOFF`] up to [`MAX_BACKOFF`].
pub fn backoff_after(failures: u32) -> Duration {
    let factor = 2_u32.saturating_pow(failures.saturating_sub(1).min(8));
    FIRST_BACKOFF.saturating_mul(factor).min(MAX_BACKOFF)
}

/// One update: stored, confirmed, then answered in the background (see the module docs).
async fn handle_update(
    service: &TelegramService,
    manager: &Arc<ConversationManager>,
    agent_id: &str,
    bot: &TelegramBot,
    update: &serde_json::Value,
) {
    let parsed = telegram::parse_update(update);
    let Some(update_id) = parsed.update_id else { return };
    if service.cursor(agent_id).is_some_and(|cursor| update_id <= cursor) {
        log::info!("telegram: update {update_id} of chatbot {agent_id} came again; dropped");
        return;
    }
    let accepted = match parsed.event {
        InboundEvent::Message(message) => receive(service, manager, agent_id, bot, &message).await,
        _ => None,
    };
    if let Err(error) = service.save_cursor(agent_id, update_id) {
        // The message is stored: a repeat after a restart is dropped by its message id.
        log::warn!("telegram: could not store the update cursor of chatbot {agent_id}: {error}");
    }
    if let Some(stored) = accepted {
        let manager = manager.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = manager.answer_channel_message(stored).await {
                log::warn!("telegram: could not answer a message: {error}");
            }
        });
    }
}

/// Stores one customer message. `None` when there is nothing to answer.
async fn receive(
    service: &TelegramService,
    manager: &Arc<ConversationManager>,
    agent_id: &str,
    bot: &TelegramBot,
    message: &graphrt_channel::InboundMessage,
) -> Option<Box<crate::conversations::inbound::StoredInbound>> {
    if message.chat_kind != ChatKind::Private {
        return None;
    }
    if message.choice.is_some() {
        // Ends the spinner of the tapped button; nothing depends on it.
        if let Err(error) = bot.typing(message).await {
            log::info!("telegram: could not confirm a button tap: {error}");
        }
    }
    if message.unsupported.is_some() && message.attachments.is_empty() && message.text.trim().is_empty() {
        let language = AppSettings::load_or_default(&service.db).language.unwrap_or_default();
        if let Err(error) = bot.send_text(&message.chat_id, unsupported_message(language), &[]).await {
            log::info!("telegram: could not answer an unsupported message: {error}");
        }
        return None;
    }
    let text = match telegram::command(&message.text) {
        // The first message of every Telegram chat: a greeting the bot can answer.
        Some(("start", rest)) if rest.trim().is_empty() => "Hello!".to_owned(),
        Some(("start", rest)) => rest.trim().to_owned(),
        _ => message.text.clone(),
    };
    let mut files = Vec::new();
    let mut missed_files = 0;
    for attachment in &message.attachments {
        match bot.download(attachment, MAX_CHANNEL_FILE_BYTES).await {
            Ok(download) => files.push(ChannelFile {
                name: download.name.or_else(|| attachment.name.clone()).unwrap_or_else(|| "photo.jpg".to_owned()),
                bytes: download.bytes,
            }),
            Err(error) => {
                log::info!("telegram: a customer file was not fetched: {error}");
                missed_files += 1;
            }
        }
    }
    let inbound = ChannelInbound {
        message_id: message.id.clone(),
        customer_handle: message.chat_id.clone(),
        customer_name: message.customer.name.clone(),
        text,
        files,
        missed_files,
    };
    match manager.accept_channel_message(TELEGRAM_CHANNEL, agent_id, inbound).await {
        Ok(Accepted::Stored(stored)) => Some(stored),
        Ok(Accepted::Duplicate | Accepted::ChannelOff) => None,
        Err(error) => {
            log::warn!("telegram: could not store a message for chatbot {agent_id}: {error}");
            None
        }
    }
}

/// Sends replies of a chatbot through its own bot.
#[derive(Debug)]
pub struct TelegramAdapter {
    service: Arc<TelegramService>,
}

impl ChannelAdapter for TelegramAdapter {
    fn name(&self) -> &'static str {
        TELEGRAM_CHANNEL
    }

    /// Telegram shows pictures and Markdown (sent as Telegram HTML), not cards: those are
    /// written out, with their choices as buttons too.
    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: true, markup: graphrt_ui::fallback::Markup::Markdown }
    }

    /// An update as `getUpdates` returns it (for tools that replay one).
    fn parse_inbound(&self, payload: &serde_json::Value) -> AppResult<InboundMessage> {
        match telegram::parse_update(payload).event {
            InboundEvent::Message(message) if !message.text.trim().is_empty() => Ok(InboundMessage {
                customer_handle: message.chat_id,
                customer_name: message.customer.name,
                text: message.text,
            }),
            _ => Err(AppError::InvalidInput("this Telegram update is not a customer text message".into())),
        }
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), DeliveryFailure>> {
        Box::pin(async move {
            let bot = self.service.bot_for(&outbound.conversation.agent_id).ok_or_else(|| {
                DeliveryFailure::new(DeliveryProblem::NotConnected, "Telegram is not connected for this chatbot")
            })?;
            let chat = &outbound.conversation.customer_handle;
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
            if !outbound.text.trim().is_empty() {
                let buttons: Vec<Button> = outbound
                    .buttons
                    .iter()
                    .map(|button| Button { id: button.id.clone(), title: button.title.clone() })
                    .collect();
                bot.send_text(chat, outbound.text, &buttons).await.map_err(|error| delivery_failure(&error))?;
            }
            Ok(())
        })
    }

    fn is_connected_for(&self, agent_id: &str) -> bool {
        self.service.bot_for(agent_id).is_some()
    }

    fn account_label(&self, agent_id: &str) -> Option<String> {
        let connection = self.service.connection(agent_id)?;
        connection.bot.username.map(|username| format!("@{username}")).or(connection.bot.name)
    }

    fn typing<'a>(&'a self, conversation: &'a Conversation) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let Some(bot) = self.service.bot_for(&conversation.agent_id) else { return };
            if let Err(error) = bot.send_chat_action(&conversation.customer_handle, "typing").await {
                log::info!("telegram: no typing sign: {error}");
            }
        })
    }
}
