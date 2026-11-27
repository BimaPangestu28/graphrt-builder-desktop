//! WhatsApp Business (Cloud API) for a chatbot that runs online.
//!
//! Why online: Meta delivers customer messages only to a public HTTPS webhook. Taking them
//! on the owner's computer would mean opening a port to the internet (or a tunnel that
//! changes address and has to be re-registered with Meta), and a laptop that sleeps
//! answers nobody. The chatbot's online copy is always reachable, so it takes the webhook
//! (`graphrt serve --channel whatsapp`, which checks Meta's signature on every delivery
//! with the app secret) and its bot answers there. Nothing listens on this computer.
//!
//! The app's part:
//! - the setup step keeps the four values in the OS credential store (`channel:whatsapp:
//!   <agent id>:<part>`) and checks the access token and phone number ID with Meta;
//! - "Put it online" copies them as secrets of the online copy ([`deploy_secrets`]);
//! - [`WhatsAppOnlineService`] shows the online copy's WhatsApp chats in the Inbox: every
//!   [`SYNC_INTERVAL`] it reads `GET /v1/conversations` and the changed chats, and stores
//!   messages it has not stored before (by a stable id per message);
//! - [`WhatsAppOnlineAdapter`] sends the owner's take-over (`POST /v1/channels/whatsapp/
//!   handoff`) and replies (`POST /v1/channels/whatsapp/messages`) through the online copy,
//!   which sends them with `graphrt-channel`. A reply after WhatsApp's 24 hour window is
//!   refused before it leaves ([`graphrt_channel::whatsapp::service_window_open`]).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use graphrt_channel::whatsapp::{self, WhatsAppCloud};
use graphrt_channel::Secret;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::channel_http_client;
use crate::conversations::channel::{
    ChannelAdapter, ChannelCapabilities, DeliveryFailure, DeliveryProblem, InboundMessage, OutboundMessage,
};
use crate::conversations::inbound::MirroredMessage;
use crate::conversations::models::{Conversation, ConversationStatus, MessageAuthor};
use crate::conversations::ConversationManager;
use crate::credentials::CredentialStore;
use crate::deploy::http::{join_url, DeployHttp, HttpMethod, HttpRequest};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Name of the channel on conversations.
pub const WHATSAPP_CHANNEL: &str = "whatsapp";
/// The variables `graphrt serve --channel whatsapp` reads, in the order the setup step asks.
pub const SECRET_ENV_NAMES: [&str; 4] =
    ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"];
/// How often the online copy's WhatsApp chats are read.
pub const SYNC_INTERVAL: Duration = Duration::from_secs(15);
/// `agent_settings` key of the checked business number ([`WhatsAppBusinessNumber`]).
pub const NUMBER_SETTING_KEY: &str = "whatsapp_business_number";
/// `agent_settings` key of the newest change of the online copy's chats already shown.
const SYNCED_SETTING_KEY: &str = "whatsapp_business_synced_ms";
/// Where Meta's Graph API lives.
const GRAPH_API_BASE: &str = "https://graph.facebook.com/v23.0";
/// The online copy's name of the channel in its URLs.
const SERVER_CHANNEL_NAME: &str = "whatsapp";

/// The credential store name of one value of `agent_id`.
fn credential_name(agent_id: &str, env_name: &str) -> String {
    let part = env_name.trim_start_matches("WHATSAPP_").to_ascii_lowercase();
    format!("whatsapp:{agent_id}:{part}")
}

/// The four values as `(variable, credential name, value)`, for "Put it online".
///
/// # Errors
/// `MissingCredentials` when the WhatsApp step was not finished; credential store errors.
pub fn deploy_secrets(credentials: &CredentialStore, agent_id: &str) -> AppResult<Vec<(&'static str, String, String)>> {
    SECRET_ENV_NAMES
        .iter()
        .map(|env_name| {
            let name = credential_name(agent_id, env_name);
            let value = credentials.read_channel_secret(&name)?.ok_or_else(|| {
                AppError::MissingCredentials("WhatsApp Business (finish the WhatsApp step of this chatbot)".into())
            })?;
            Ok((*env_name, name, value))
        })
        .collect()
}

/// The business number Meta confirmed. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppBusinessNumber {
    /// As Meta shows it, e.g. `+62 812-3456-7890`.
    pub display_phone_number: Option<String>,
    /// The business name customers see.
    pub verified_name: Option<String>,
}

/// What the owner pastes in the setup step. Keep `src/api/channelTypes.ts` in sync.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppBusinessInput {
    pub access_token: String,
    pub phone_number_id: String,
    pub app_secret: String,
}

impl std::fmt::Debug for WhatsAppBusinessInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhatsAppBusinessInput").field("phone_number_id", &self.phone_number_id).finish_non_exhaustive()
    }
}

/// The WhatsApp Business step of a chatbot. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppBusinessSetup {
    pub agent_id: String,
    /// The four values are saved and the number was checked.
    pub saved: bool,
    pub number: Option<WhatsAppBusinessNumber>,
    /// The chatbot runs online with WhatsApp Business turned on.
    pub online: bool,
    /// The callback URL to enter in the Meta app, once the chatbot is online.
    pub webhook_url: Option<String>,
    /// The installed graphrt tools can put WhatsApp Business online.
    pub tools_ready: bool,
}

/// Which chatbots run online with WhatsApp Business, and how to reach them.
pub trait OnlineChatbots: Send + Sync + std::fmt::Debug {
    /// The chatbots whose online copy answers on WhatsApp Business.
    fn whatsapp_agents(&self) -> Vec<String>;
    /// The online copy's address and access key.
    ///
    /// # Errors
    /// When the agent is not online, or its key is missing.
    fn access(&self, agent_id: &str) -> AppResult<(String, String)>;
}

impl OnlineChatbots for crate::deploy::DeployService {
    fn whatsapp_agents(&self) -> Vec<String> {
        self.whatsapp_online_agents()
    }

    fn access(&self, agent_id: &str) -> AppResult<(String, String)> {
        self.online_access(agent_id)
    }
}

/// The WhatsApp Business chats of online chatbots, in the Inbox. One per app.
#[derive(Debug)]
pub struct WhatsAppOnlineService {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    online: Arc<dyn OnlineChatbots>,
    server: Arc<dyn DeployHttp>,
    graph: reqwest::Client,
    graph_base: String,
    manager: OnceLock<Weak<ConversationManager>>,
    /// When each customer last wrote, as the online copy reports: `(agent, chat) → ms`.
    last_inbound: Mutex<HashMap<(String, String), u64>>,
}

impl WhatsAppOnlineService {
    /// # Errors
    /// `Internal` when the HTTP client cannot be built.
    pub fn new(
        db: Arc<Database>,
        credentials: Arc<CredentialStore>,
        online: Arc<dyn OnlineChatbots>,
        server: Arc<dyn DeployHttp>,
    ) -> AppResult<Self> {
        Ok(Self {
            db,
            credentials,
            online,
            server,
            graph: channel_http_client()?,
            graph_base: GRAPH_API_BASE.to_owned(),
            manager: OnceLock::new(),
            last_inbound: Mutex::new(HashMap::new()),
        })
    }

    /// Calls another Graph API server (a fake in tests), e.g. `http://127.0.0.1:1234/v23.0`.
    pub fn with_graph_base(mut self, graph_base: &str) -> Self {
        self.graph_base = graph_base.trim_end_matches('/').to_owned();
        self
    }

    pub fn adapter(self: &Arc<Self>) -> Arc<WhatsAppOnlineAdapter> {
        Arc::new(WhatsAppOnlineAdapter { service: self.clone() })
    }

    pub fn attach(&self, manager: &Arc<ConversationManager>) {
        let _already_attached = self.manager.set(Arc::downgrade(manager));
    }

    /// The step's state for `agent_id`.
    ///
    /// # Errors
    /// Storage errors.
    pub fn setup(&self, agent_id: &str, tools_ready: bool) -> AppResult<WhatsAppBusinessSetup> {
        self.db.get_agent(agent_id)?;
        let saved = deploy_secrets(&self.credentials, agent_id).is_ok();
        let number = self
            .db
            .get_agent_setting(agent_id, NUMBER_SETTING_KEY)?
            .and_then(|value| serde_json::from_value::<WhatsAppBusinessNumber>(value).ok());
        let online = self.online.whatsapp_agents().iter().any(|agent| agent == agent_id);
        let webhook_url = if online {
            self.online.access(agent_id).ok().map(|(url, _)| join_url(&url, "v1/channels/whatsapp/webhook"))
        } else {
            None
        };
        Ok(WhatsAppBusinessSetup {
            agent_id: agent_id.to_owned(),
            saved: saved && number.is_some(),
            number,
            online,
            webhook_url,
            tools_ready,
        })
    }

    /// Checks the access token and phone number ID with Meta and saves the values in the OS
    /// credential store, with a verify token made here (the owner enters it in the Meta app).
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence when Meta refuses or a value is missing.
    pub async fn save(&self, agent_id: &str, input: &WhatsAppBusinessInput) -> AppResult<WhatsAppBusinessNumber> {
        self.db.get_agent(agent_id)?;
        let (token, phone_number_id, app_secret) =
            (input.access_token.trim(), input.phone_number_id.trim(), input.app_secret.trim());
        if app_secret.is_empty() {
            return Err(AppError::InvalidInput(
                "Paste the app secret from App settings › Basic in the Meta app".into(),
            ));
        }
        let number = self.check(token, phone_number_id).await?;
        self.credentials.set_channel_secret(&credential_name(agent_id, SECRET_ENV_NAMES[0]), token)?;
        self.credentials.set_channel_secret(&credential_name(agent_id, SECRET_ENV_NAMES[1]), phone_number_id)?;
        self.credentials.set_channel_secret(&credential_name(agent_id, SECRET_ENV_NAMES[2]), app_secret)?;
        let verify_name = credential_name(agent_id, SECRET_ENV_NAMES[3]);
        if self.credentials.read_channel_secret(&verify_name)?.is_none() {
            self.credentials.set_channel_secret(&verify_name, &uuid::Uuid::new_v4().simple().to_string())?;
        }
        self.db.set_agent_setting(agent_id, NUMBER_SETTING_KEY, &serde_json::to_value(&number)?)?;
        Ok(number)
    }

    /// The verify token to enter in the Meta app (asked for with a button, not shown by default).
    ///
    /// # Errors
    /// `MissingCredentials` before the values were saved.
    pub fn verify_token(&self, agent_id: &str) -> AppResult<String> {
        self.credentials
            .read_channel_secret(&credential_name(agent_id, SECRET_ENV_NAMES[3]))?
            .ok_or_else(|| AppError::MissingCredentials("WhatsApp Business (save the values first)".into()))
    }

    /// Forgets the four values of `agent_id`.
    ///
    /// # Errors
    /// Credential store or storage errors.
    pub fn forget(&self, agent_id: &str) -> AppResult<()> {
        for env_name in SECRET_ENV_NAMES {
            self.credentials.delete_channel_secret(&credential_name(agent_id, env_name))?;
        }
        self.db.delete_agent_setting(agent_id, NUMBER_SETTING_KEY)
    }

    /// Asks Meta which number `phone_number_id` is, with `token`.
    async fn check(&self, token: &str, phone_number_id: &str) -> AppResult<WhatsAppBusinessNumber> {
        // The crate checks the shapes a Cloud API client needs.
        WhatsAppCloud::new(self.graph.clone(), phone_number_id, Secret::new(token)).map_err(|_| {
            AppError::InvalidInput(
                "Check the values: the phone number ID is a long number (WhatsApp › API Setup), and the access \
                 token is not empty"
                    .into(),
            )
        })?;
        let url = format!("{}/{phone_number_id}?fields=display_phone_number,verified_name", self.graph_base);
        let response =
            self.graph.get(url).bearer_auth(token).timeout(Duration::from_secs(20)).send().await.map_err(|_| {
                AppError::InvalidInput("Meta cannot be reached. Check the internet connection and try again".into())
            })?;
        let status = response.status().as_u16();
        let body: Json = response.json().await.unwrap_or(Json::Null);
        match status {
            200 => Ok(WhatsAppBusinessNumber {
                display_phone_number: body["display_phone_number"].as_str().map(str::to_owned),
                verified_name: body["verified_name"].as_str().map(str::to_owned),
            }),
            401 => Err(AppError::InvalidInput(
                "Meta does not accept the access token. It is wrong or expired: make a permanent token of a system \
                 user"
                    .into(),
            )),
            _ if body["error"]["code"].as_i64() == Some(190) => Err(AppError::InvalidInput(
                "Meta does not accept the access token. It is wrong or expired: make a permanent token of a system \
                 user"
                    .into(),
            )),
            _ => Err(AppError::InvalidInput(
                "Meta does not know this phone number ID with this token. Copy the Phone number ID from WhatsApp › \
                 API Setup"
                    .into(),
            )),
        }
    }

    /// Reads the WhatsApp chats of every online chatbot every [`SYNC_INTERVAL`].
    pub fn spawn(self: &Arc<Self>) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                for agent_id in service.online.whatsapp_agents() {
                    if let Err(error) = service.sync(&agent_id).await {
                        log::info!("whatsapp business: could not read the chats of {agent_id}: {error}");
                    }
                }
                tokio::time::sleep(SYNC_INTERVAL).await;
            }
        });
    }

    /// Stores what changed in the online copy's WhatsApp chats of `agent_id` since the last
    /// time. Returns how many messages were new.
    ///
    /// # Errors
    /// When the online copy cannot be reached or answers with an error.
    pub async fn sync(&self, agent_id: &str) -> AppResult<usize> {
        let Some(manager) = self.manager.get().and_then(Weak::upgrade) else { return Ok(0) };
        let (url, api_key) = self.online.access(agent_id)?;
        let list = self.server_json(&join_url(&url, "v1/conversations?limit=100"), &api_key).await?;
        let synced =
            self.db.get_agent_setting(agent_id, SYNCED_SETTING_KEY)?.and_then(|value| value.as_u64()).unwrap_or(0);
        let mut newest = synced;
        let mut added = 0;
        for summary in list["conversations"].as_array().into_iter().flatten() {
            let channel = &summary["channel"];
            if channel["kind"].as_str() != Some("whatsapp") {
                continue;
            }
            let updated = summary["updated_ms"].as_u64().unwrap_or(0);
            let (Some(id), Some(chat)) = (summary["id"].as_str(), channel["chat_id"].as_str()) else { continue };
            if let Ok(mut last_inbound) = self.last_inbound.lock() {
                last_inbound
                    .insert((agent_id.to_owned(), chat.to_owned()), channel["last_inbound_ms"].as_u64().unwrap_or(0));
            }
            if updated <= synced {
                continue;
            }
            newest = newest.max(updated);
            let detail = self.server_json(&join_url(&url, &format!("v1/conversations/{id}")), &api_key).await?;
            let name = channel["customer_name"].as_str();
            for message in detail["messages"].as_array().into_iter().flatten() {
                let author = match message["role"].as_str() {
                    Some("user") => MessageAuthor::Customer,
                    Some("assistant") => MessageAuthor::Bot,
                    _ => continue,
                };
                let text = message["content"].as_str().unwrap_or_default();
                let created = message["created_ms"].as_u64().unwrap_or(0);
                let mirrored = MirroredMessage {
                    external_id: format!("{id}:{created}:{}", message["role"].as_str().unwrap_or_default()),
                    author,
                    text: text.to_owned(),
                };
                if author == MessageAuthor::Bot
                    && manager.claim_operator_message(WHATSAPP_CHANNEL, agent_id, chat, &mirrored)?
                {
                    continue;
                }
                if manager.mirror_channel_message(WHATSAPP_CHANNEL, agent_id, chat, name, &mirrored)? {
                    added += 1;
                }
            }
            let person = channel["human"].as_bool().unwrap_or(false);
            let waiting = channel["waiting_run"].as_str().is_some();
            manager.mirror_channel_status(WHATSAPP_CHANNEL, agent_id, chat, person, waiting)?;
        }
        if newest > synced {
            self.db.set_agent_setting(agent_id, SYNCED_SETTING_KEY, &json!(newest))?;
        }
        Ok(added)
    }

    async fn server_json(&self, url: &str, api_key: &str) -> AppResult<Json> {
        let reply = self.server.get(url.to_owned(), Some(api_key.to_owned())).await?;
        match reply.status {
            200 => Ok(serde_json::from_str(&reply.body).unwrap_or(Json::Null)),
            401 | 403 => Err(AppError::Credentials("the online chatbot did not accept its access key".into())),
            404 => Err(AppError::InvalidInput(
                "the online chatbot keeps no conversations: put it online again with WhatsApp Business on".into(),
            )),
            status => Err(AppError::Internal(format!("the online chatbot answered with an error ({status})"))),
        }
    }

    async fn post(&self, agent_id: &str, path: &str, body: Json) -> Result<(), DeliveryFailure> {
        let (url, api_key) = self
            .online
            .access(agent_id)
            .map_err(|error| DeliveryFailure::new(DeliveryProblem::NotConnected, error.to_string()))?;
        let request = HttpRequest {
            method: HttpMethod::Post,
            url: join_url(&url, path),
            bearer: Some(api_key),
            body: Some(body),
        };
        let reply = self
            .server
            .send(request)
            .await
            .map_err(|_| DeliveryFailure::new(DeliveryProblem::Offline, "the online chatbot cannot be reached"))?;
        match reply.status {
            200..=299 => Ok(()),
            401 | 403 => Err(DeliveryFailure::new(
                DeliveryProblem::NotConnected,
                "the online chatbot did not accept its access key",
            )),
            status => {
                let why = serde_json::from_str::<Json>(&reply.body)
                    .ok()
                    .and_then(|body| body["error"].as_str().map(str::to_owned))
                    .unwrap_or_else(|| format!("error {status}"));
                let problem = if why.contains("24") { DeliveryProblem::OutsideWindow } else { DeliveryProblem::Other };
                Err(DeliveryFailure::new(problem, format!("the online chatbot refused: {why}")))
            }
        }
    }

    fn window_is_closed(&self, agent_id: &str, chat: &str) -> bool {
        let last = self
            .last_inbound
            .lock()
            .ok()
            .and_then(|last_inbound| last_inbound.get(&(agent_id.to_owned(), chat.to_owned())).copied());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or(0);
        last.is_some_and(|last| last > 0 && !whatsapp::service_window_open(last, now))
    }
}

/// The owner's side of a WhatsApp Business chat of an online chatbot.
#[derive(Debug)]
pub struct WhatsAppOnlineAdapter {
    service: Arc<WhatsAppOnlineService>,
}

impl ChannelAdapter for WhatsAppOnlineAdapter {
    fn name(&self) -> &'static str {
        WHATSAPP_CHANNEL
    }

    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: false, markup: graphrt_ui::fallback::Markup::WhatsApp }
    }

    /// A webhook delivery as Meta sends it (for tools that replay one): its first message.
    fn parse_inbound(&self, payload: &Json) -> AppResult<InboundMessage> {
        whatsapp::parse_webhook(payload)
            .into_iter()
            .find_map(|event| match event.event {
                graphrt_channel::InboundEvent::Message(message) if !message.text.trim().is_empty() => {
                    Some(InboundMessage {
                        customer_handle: message.chat_id,
                        customer_name: message.customer.name,
                        text: message.text,
                    })
                }
                _ => None,
            })
            .ok_or_else(|| AppError::InvalidInput("this delivery holds no customer text message".into()))
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), DeliveryFailure>> {
        Box::pin(async move {
            let conversation = outbound.conversation;
            if outbound.author != MessageAuthor::Operator {
                // The online copy sends its bot's answers itself.
                return Ok(());
            }
            if self.service.window_is_closed(&conversation.agent_id, &conversation.customer_handle) {
                return Err(super::delivery_failure(&graphrt_channel::ChannelError::OutsideServiceWindow));
            }
            if !outbound.text.trim().is_empty() {
                let body = json!({ "to": conversation.customer_handle, "text": outbound.text });
                self.service.post(&conversation.agent_id, "v1/channels/whatsapp/messages", body).await?;
            }
            if !outbound.files.is_empty() || !outbound.images.is_empty() {
                return Err(DeliveryFailure::new(
                    DeliveryProblem::Other,
                    "files are not sent on WhatsApp Business from the app: send them from the WhatsApp Business app",
                ));
            }
            Ok(())
        })
    }

    fn is_connected_for(&self, agent_id: &str) -> bool {
        self.service.online.whatsapp_agents().iter().any(|agent| agent == agent_id)
    }

    fn account_label(&self, agent_id: &str) -> Option<String> {
        let number = self.service.db.get_agent_setting(agent_id, NUMBER_SETTING_KEY).ok().flatten()?;
        let number: WhatsAppBusinessNumber = serde_json::from_value(number).ok()?;
        number.display_phone_number.or(number.verified_name)
    }

    fn answers_remotely(&self) -> bool {
        true
    }

    /// Take-over stops the online bot for this customer; hand-back and closing start it again.
    fn status_changed<'a>(&'a self, conversation: &'a Conversation) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            let human = conversation.status == ConversationStatus::YouReplying;
            let body = json!({ "to": conversation.customer_handle, "human": human });
            let path = format!("v1/channels/{SERVER_CHANNEL_NAME}/handoff");
            self.service
                .post(&conversation.agent_id, &path, body)
                .await
                .map_err(|failure| AppError::InvalidInput(failure.message))
        })
    }
}
