//! The owner's personal WhatsApp, linked with the `whatsapp-web` plugin (QR code), as a
//! chatbot channel on this computer.
//!
//! The plugin does not push messages, so every [`POLL_INTERVAL`] the service asks it for
//! unread chats (`whatsapp-web.list_chats`), reads the new messages of each
//! (`whatsapp-web.read_messages`, which marks the chat as read on the phone) and stores
//! those it has not stored before (by WhatsApp's message id). The bot's replies go out
//! with `whatsapp-web.send_message`, one at a time.
//!
//! The plugin's safety limits stay as they are: a minimum time between two sends and a
//! daily cap (`WHATSAPP_WEB_MIN_SEND_INTERVAL_SECONDS`, `WHATSAPP_WEB_DAILY_SEND_LIMIT`).
//! A reply the cap refuses is stored with its delivery problem, for the owner to see.
//! Group chats are left alone. Only one chatbot answers the personal number: the one the
//! owner linked it to in the connect step ([`ASSIGNED_SETTING_KEY`]).

use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::conversations::channel::{
    ChannelAdapter, ChannelCapabilities, DeliveryFailure, DeliveryProblem, InboundMessage, OutboundMessage,
};
use crate::conversations::inbound::{Accepted, ChannelInbound};
use crate::conversations::ConversationManager;
use crate::error::{AppError, AppResult};
use crate::storage::models::AgentKind;
use crate::storage::Database;

/// Name of the channel on conversations.
pub const WHATSAPP_WEB_CHANNEL: &str = "whatsapp-web";
/// The plugin that drives the personal WhatsApp.
pub const PLUGIN: &str = "whatsapp-web";
/// Settings key of the chatbot that answers the personal number (empty: none).
pub const ASSIGNED_SETTING_KEY: &str = "chatbot.whatsapp_web.agent";
/// How often unread chats are looked for.
pub const POLL_INTERVAL: Duration = Duration::from_secs(20);
/// Most chats read in one round, and most messages read of one chat.
const MAX_CHATS_PER_ROUND: u64 = 10;
const MAX_MESSAGES_PER_CHAT: u64 = 20;

/// How the personal WhatsApp channel is doing. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppWebState {
    /// No chatbot answers the personal number.
    Off,
    /// Not read yet since the app started.
    Starting,
    /// Reading and answering.
    Connected,
    /// WhatsApp Web is not linked (scan the QR code again) or the plugin is not ready.
    NotLinked,
}

/// The personal WhatsApp channel, for the connect step. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppWebChannel {
    /// The chatbot that answers the personal number.
    pub agent_id: Option<String>,
    pub state: WhatsAppWebState,
}

/// Runs the plugin's steps (the plugin service in the app, a script in tests).
pub trait PluginSteps: Send + Sync + std::fmt::Debug {
    /// Runs node kind `kind` of `plugin` once with `config` and returns its outputs.
    fn run<'a>(&'a self, plugin: &'a str, kind: &'a str, config: Json) -> BoxFuture<'a, AppResult<Map<String, Json>>>;
}

impl PluginSteps for crate::plugins::PluginService {
    fn run<'a>(&'a self, plugin: &'a str, kind: &'a str, config: Json) -> BoxFuture<'a, AppResult<Map<String, Json>>> {
        Box::pin(async move { Ok(self.run_action(plugin, kind, config).await?.outputs) })
    }
}

/// The personal WhatsApp of the owner as a chatbot channel. One per app.
#[derive(Debug)]
pub struct WhatsAppWebService {
    db: Arc<Database>,
    plugins: Arc<dyn PluginSteps>,
    manager: OnceLock<Weak<ConversationManager>>,
    state: Mutex<WhatsAppWebState>,
    /// One plugin call at a time (the plugin drives one browser).
    plugin_lock: tokio::sync::Mutex<()>,
}

impl WhatsAppWebService {
    pub fn new(db: Arc<Database>, plugins: Arc<dyn PluginSteps>) -> Self {
        Self {
            db,
            plugins,
            manager: OnceLock::new(),
            state: Mutex::new(WhatsAppWebState::Starting),
            plugin_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn adapter(self: &Arc<Self>) -> Arc<WhatsAppWebAdapter> {
        Arc::new(WhatsAppWebAdapter { service: self.clone() })
    }

    pub fn attach(&self, manager: &Arc<ConversationManager>) {
        let _already_attached = self.manager.set(Arc::downgrade(manager));
    }

    /// The chatbot that answers the personal number.
    pub fn assigned_agent(&self) -> Option<String> {
        self.db.get_setting(ASSIGNED_SETTING_KEY).ok().flatten().filter(|agent_id| !agent_id.is_empty())
    }

    /// Lets `agent_id` answer the personal number (`None`: no chatbot does).
    ///
    /// # Errors
    /// `NotFound` / `InvalidInput` when the agent is not a chatbot; storage errors.
    pub fn assign(&self, agent_id: Option<&str>) -> AppResult<WhatsAppWebChannel> {
        if let Some(agent_id) = agent_id {
            let agent = self.db.get_agent(agent_id)?;
            if agent.kind != AgentKind::Chatbot {
                return Err(AppError::InvalidInput(format!("{} is not a chatbot", agent.name)));
            }
        }
        self.db.set_setting(ASSIGNED_SETTING_KEY, agent_id.unwrap_or_default())?;
        self.set_state(WhatsAppWebState::Starting);
        Ok(self.channel())
    }

    pub fn channel(&self) -> WhatsAppWebChannel {
        let agent_id = self.assigned_agent();
        let state = if agent_id.is_none() {
            WhatsAppWebState::Off
        } else {
            self.state.lock().map(|state| *state).unwrap_or(WhatsAppWebState::Starting)
        };
        WhatsAppWebChannel { agent_id, state }
    }

    fn set_state(&self, state: WhatsAppWebState) {
        if let Ok(mut current) = self.state.lock() {
            *current = state;
        }
    }

    /// Looks for unread chats every [`POLL_INTERVAL`] while a chatbot answers the number.
    pub fn spawn(self: &Arc<Self>) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if let Err(error) = service.poll_once().await {
                    log::info!("personal whatsapp: {error}");
                }
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        });
    }

    async fn run(&self, kind: &str, config: Json) -> AppResult<Map<String, Json>> {
        let _one_at_a_time = self.plugin_lock.lock().await;
        self.plugins.run(PLUGIN, kind, config).await
    }

    /// One round: reads the unread chats and answers their new messages, in order. Returns
    /// how many messages were stored.
    ///
    /// # Errors
    /// When the plugin cannot list the chats (not linked, not installed...).
    pub async fn poll_once(&self) -> AppResult<usize> {
        let Some(agent_id) = self.assigned_agent() else { return Ok(0) };
        let Some(manager) = self.manager.get().and_then(Weak::upgrade) else { return Ok(0) };
        if !crate::chatbot_setup::is_channel_enabled(&self.db, &agent_id, WHATSAPP_WEB_CHANNEL)? {
            return Ok(0);
        }
        let listed = match self
            .run("whatsapp-web.list_chats", json!({ "unread_only": true, "limit": MAX_CHATS_PER_ROUND }))
            .await
        {
            Ok(listed) => listed,
            Err(error) => {
                self.set_state(WhatsAppWebState::NotLinked);
                return Err(error);
            }
        };
        self.set_state(WhatsAppWebState::Connected);
        let mut stored_count = 0;
        for chat in rows(&listed) {
            let unread = chat["unread_count"].as_u64().unwrap_or(0);
            let Some(name) = chat["name"].as_str().filter(|_| unread > 0) else { continue };
            let limit = unread.clamp(1, MAX_MESSAGES_PER_CHAT);
            let read = match self.run("whatsapp-web.read_messages", json!({ "chat_name": name, "limit": limit })).await
            {
                Ok(read) => read,
                Err(error) => {
                    log::info!("personal whatsapp: could not read a chat: {error}");
                    continue;
                }
            };
            let messages = rows(&read);
            // The newest `unread` messages of the customer are the new ones.
            let from_customer: Vec<&Json> =
                messages.iter().filter(|message| message["from_me"].as_bool() == Some(false)).collect();
            let skip = from_customer.len().saturating_sub(usize::try_from(unread).unwrap_or(usize::MAX));
            for message in from_customer.into_iter().skip(skip) {
                let chat_id = message["chat_id"].as_str().unwrap_or_default();
                if chat_id.ends_with("@g.us") {
                    continue;
                }
                let (Some(id), Some(text)) = (message["id"].as_str(), message["text"].as_str()) else { continue };
                if text.trim().is_empty() {
                    continue;
                }
                let inbound = ChannelInbound {
                    message_id: id.to_owned(),
                    customer_handle: handle_of(chat_id, name),
                    customer_name: Some(name.to_owned()),
                    text: text.to_owned(),
                    files: Vec::new(),
                    missed_files: 0,
                };
                match manager.accept_channel_message(WHATSAPP_WEB_CHANNEL, &agent_id, inbound).await {
                    Ok(Accepted::Stored(stored)) => {
                        stored_count += 1;
                        // Answered before the next message: one plugin call at a time, in order.
                        if let Err(error) = manager.answer_channel_message(stored).await {
                            log::warn!("personal whatsapp: could not answer a message: {error}");
                        }
                    }
                    Ok(Accepted::Duplicate | Accepted::ChannelOff) => {}
                    Err(error) => log::warn!("personal whatsapp: could not store a message: {error}"),
                }
            }
        }
        Ok(stored_count)
    }
}

/// The rows of a plugin step's `data` (a list, or an object with the list under `chats` / `messages`).
fn rows(outputs: &Map<String, Json>) -> Vec<Json> {
    let data = outputs.get("data").cloned().unwrap_or(Json::Null);
    match data {
        Json::Array(rows) => rows,
        Json::Object(mut object) => ["chats", "messages", "items"]
            .iter()
            .find_map(|key| object.remove(*key))
            .and_then(|rows| rows.as_array().cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Where replies go: `+<number>` for a chat with a person (`6281234@c.us`), else the
/// chat's exact name.
fn handle_of(chat_id: &str, name: &str) -> String {
    match chat_id.strip_suffix("@c.us") {
        Some(number) if !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()) => format!("+{number}"),
        _ => name.to_owned(),
    }
}

/// Sends the chatbot's and the owner's replies from the personal number.
#[derive(Debug)]
pub struct WhatsAppWebAdapter {
    service: Arc<WhatsAppWebService>,
}

impl ChannelAdapter for WhatsAppWebAdapter {
    fn name(&self) -> &'static str {
        WHATSAPP_WEB_CHANNEL
    }

    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: false, markup: graphrt_ui::fallback::Markup::WhatsApp }
    }

    fn parse_inbound(&self, payload: &Json) -> AppResult<InboundMessage> {
        let text = payload["text"].as_str().map(str::trim).filter(|text| !text.is_empty());
        let chat = payload["chat_name"].as_str().filter(|chat| !chat.is_empty());
        match (text, chat) {
            (Some(text), Some(chat)) => Ok(InboundMessage {
                customer_handle: handle_of(payload["chat_id"].as_str().unwrap_or_default(), chat),
                customer_name: Some(chat.to_owned()),
                text: text.to_owned(),
            }),
            _ => Err(AppError::InvalidInput("a personal WhatsApp message needs `text` and `chat_name`".into())),
        }
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), DeliveryFailure>> {
        Box::pin(async move {
            let handle = &outbound.conversation.customer_handle;
            if !outbound.text.trim().is_empty() {
                let mut config = json!({ "text": outbound.text });
                let target = if handle.starts_with('+') { "phone" } else { "chat_name" };
                config[target] = json!(handle);
                self.service.run("whatsapp-web.send_message", config).await.map_err(|error| plugin_failure(&error))?;
            }
            if !outbound.files.is_empty() {
                return Err(DeliveryFailure::new(
                    DeliveryProblem::Other,
                    "files are not sent from your personal WhatsApp by the chatbot: send them from your phone",
                ));
            }
            Ok(())
        })
    }

    fn is_connected_for(&self, agent_id: &str) -> bool {
        self.service.assigned_agent().as_deref() == Some(agent_id)
    }
}

/// A failed plugin step in plain words.
fn plugin_failure(error: &AppError) -> DeliveryFailure {
    let text = error.to_string();
    if text.contains("rate_limited") || text.contains("daily") {
        DeliveryFailure::new(
            DeliveryProblem::RateLimited,
            "the personal WhatsApp sending limit was reached (the plugin's safety limit): the message was not sent",
        )
    } else if text.contains("needs_login") || text.contains("not linked") || text.contains("logged") {
        DeliveryFailure::new(DeliveryProblem::NotConnected, "WhatsApp Web is not linked: scan the QR code again")
    } else {
        DeliveryFailure::new(DeliveryProblem::Other, format!("personal WhatsApp did not send it: {text}"))
    }
}
