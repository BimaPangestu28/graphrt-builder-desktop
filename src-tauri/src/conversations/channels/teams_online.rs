//! Microsoft Teams for a chatbot that runs online.
//!
//! Why online: Teams delivers messages only to the HTTPS messaging endpoint of an Azure
//! Bot. Taking them on the owner's computer would mean opening a port to the internet,
//! and a laptop that sleeps answers nobody. The chatbot's online copy takes the endpoint
//! (`graphrt serve --channel teams`, which checks the Bot Framework token of every
//! delivery) and its bot answers there. Nothing listens on this computer.
//!
//! The app's part, as for WhatsApp Business ([`super::whatsapp_online`]):
//! - the setup step keeps the bot's three values in the OS credential store
//!   (`channel:teams:<agent id>:<part>`) and checks them with Microsoft (a token for the
//!   Bot Connector is issued only for a right app id, secret and tenant);
//! - "Put it online" copies them as secrets of the online copy ([`deploy_secrets`]);
//! - [`TeamsOnlineService`] shows the online copy's Teams chats in the Inbox, and
//!   [`TeamsOnlineAdapter`] sends the owner's take-over and replies through it.

use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::channel_http_client;
use super::online_sync::{post_to_online_copy, sync_online_chats, OnlineChannel};
use super::whatsapp_online::OnlineChatbots;
use crate::conversations::channel::{
    ChannelAdapter, ChannelCapabilities, DeliveryFailure, DeliveryProblem, InboundMessage, OutboundMessage,
};
use crate::conversations::models::{Conversation, ConversationStatus, MessageAuthor};
use crate::conversations::ConversationManager;
use crate::credentials::CredentialStore;
use crate::deploy::http::{join_url, DeployHttp};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Name of the channel on conversations.
pub const TEAMS_CHANNEL: &str = "teams";
/// The variables `graphrt serve --channel teams` reads, in the order the setup step asks.
pub const SECRET_ENV_NAMES: [&str; 3] = ["TEAMS_APP_ID", "TEAMS_APP_PASSWORD", "TEAMS_TENANT_ID"];
/// How often the online copy's Teams chats are read.
pub const SYNC_INTERVAL: Duration = Duration::from_secs(15);
/// `agent_settings` key: the values were checked with Microsoft.
pub const CHECKED_SETTING_KEY: &str = "teams_bot_checked";
const SYNCED_SETTING_KEY: &str = "teams_synced_ms";
/// Where Microsoft Entra issues tokens.
const LOGIN_BASE: &str = "https://login.microsoftonline.com";

fn credential_name(agent_id: &str, env_name: &str) -> String {
    let part = env_name.trim_start_matches("TEAMS_").to_ascii_lowercase();
    format!("teams:{agent_id}:{part}")
}

/// The three values as `(variable, credential name, value)`, for "Put it online".
///
/// # Errors
/// `MissingCredentials` when the Teams step was not finished; credential store errors.
pub fn deploy_secrets(credentials: &CredentialStore, agent_id: &str) -> AppResult<Vec<(&'static str, String, String)>> {
    SECRET_ENV_NAMES
        .iter()
        .map(|env_name| {
            let name = credential_name(agent_id, env_name);
            let value = credentials.read_channel_secret(&name)?.ok_or_else(|| {
                AppError::MissingCredentials("Microsoft Teams (finish the Teams step of this chatbot)".into())
            })?;
            Ok((*env_name, name, value))
        })
        .collect()
}

/// What the owner pastes in the Teams step. Keep `src/api/channelTypes.ts` in sync.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamsBotInput {
    pub app_id: String,
    pub app_password: String,
    pub tenant_id: String,
}

impl std::fmt::Debug for TeamsBotInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TeamsBotInput").field("app_id", &self.app_id).finish_non_exhaustive()
    }
}

/// The Teams step of a chatbot. Keep `src/api/channelTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamsSetup {
    pub agent_id: String,
    /// The three values are saved and Microsoft accepted them.
    pub saved: bool,
    /// The chatbot runs online with Teams turned on.
    pub online: bool,
    /// The messaging endpoint to enter in the Azure Bot, once the chatbot is online.
    pub messaging_endpoint: Option<String>,
    /// The installed graphrt tools can put Teams online.
    pub tools_ready: bool,
}

/// The Teams chats of online chatbots, in the Inbox. One per app.
#[derive(Debug)]
pub struct TeamsOnlineService {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    online: Arc<dyn OnlineChatbots>,
    server: Arc<dyn DeployHttp>,
    http: reqwest::Client,
    login_base: String,
    manager: OnceLock<Weak<ConversationManager>>,
}

/// `value` for a form body: every byte but `A-Z a-z 0-9 - . _ ~` percent encoded.
fn form_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn is_guid(value: &str) -> bool {
    value.len() == 36 && value.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

impl TeamsOnlineService {
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
            http: channel_http_client()?,
            login_base: LOGIN_BASE.to_owned(),
            manager: OnceLock::new(),
        })
    }

    /// Gets tokens from another login server (a fake in tests).
    pub fn with_login_base(mut self, login_base: &str) -> Self {
        self.login_base = login_base.trim_end_matches('/').to_owned();
        self
    }

    pub fn adapter(self: &Arc<Self>) -> Arc<TeamsOnlineAdapter> {
        Arc::new(TeamsOnlineAdapter { service: self.clone() })
    }

    pub fn attach(&self, manager: &Arc<ConversationManager>) {
        let _already_attached = self.manager.set(Arc::downgrade(manager));
    }

    /// The step's state for `agent_id`.
    ///
    /// # Errors
    /// Storage errors.
    pub fn setup(&self, agent_id: &str, tools_ready: bool) -> AppResult<TeamsSetup> {
        self.db.get_agent(agent_id)?;
        let saved = deploy_secrets(&self.credentials, agent_id).is_ok()
            && self.db.get_agent_setting(agent_id, CHECKED_SETTING_KEY)?.is_some();
        let online = self.online.teams_agents().iter().any(|agent| agent == agent_id);
        let messaging_endpoint = if online {
            self.online.access(agent_id).ok().map(|(url, _)| join_url(&url, "v1/channels/teams/webhook"))
        } else {
            None
        };
        Ok(TeamsSetup { agent_id: agent_id.to_owned(), saved, online, messaging_endpoint, tools_ready })
    }

    /// Checks the values with Microsoft and saves them in the OS credential store.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence when a value is not one or Microsoft refuses them.
    pub async fn save(&self, agent_id: &str, input: &TeamsBotInput) -> AppResult<()> {
        self.db.get_agent(agent_id)?;
        let (app_id, password, tenant) = (input.app_id.trim(), input.app_password.trim(), input.tenant_id.trim());
        if !is_guid(app_id) {
            return Err(AppError::InvalidInput(
                "Copy the Microsoft App ID from the Configuration page of the Azure Bot: it looks like \
                 1a2b3c4d-1234-..."
                    .into(),
            ));
        }
        if !is_guid(tenant) {
            return Err(AppError::InvalidInput(
                "Copy the App Tenant ID from the Configuration page of the Azure Bot: it looks like 9f8e7d6c-..."
                    .into(),
            ));
        }
        if password.is_empty() {
            return Err(AppError::InvalidInput("Paste the client secret value of the bot's app".into()));
        }
        self.check(app_id, password, tenant).await?;
        let values = [app_id, password, tenant];
        for (env_name, value) in SECRET_ENV_NAMES.iter().zip(values) {
            self.credentials.set_channel_secret(&credential_name(agent_id, env_name), value)?;
        }
        self.db.set_agent_setting(agent_id, CHECKED_SETTING_KEY, &json!(true))
    }

    /// Forgets the three values of `agent_id`.
    ///
    /// # Errors
    /// Credential store or storage errors.
    pub fn forget(&self, agent_id: &str) -> AppResult<()> {
        for env_name in SECRET_ENV_NAMES {
            self.credentials.delete_channel_secret(&credential_name(agent_id, env_name))?;
        }
        self.db.delete_agent_setting(agent_id, CHECKED_SETTING_KEY)
    }

    /// Asks Microsoft for a Bot Connector token with the values: it is issued only when
    /// the app id, secret and tenant belong together.
    async fn check(&self, app_id: &str, password: &str, tenant: &str) -> AppResult<()> {
        let url = format!("{}/{tenant}/oauth2/v2.0/token", self.login_base);
        let form = [
            ("grant_type", "client_credentials"),
            ("client_id", app_id),
            ("client_secret", password),
            ("scope", "https://api.botframework.com/.default"),
        ];
        let body =
            form.iter().map(|(name, value)| format!("{name}={}", form_encode(value))).collect::<Vec<_>>().join("&");
        let response = self
            .http
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|_| {
                AppError::InvalidInput(
                    "Microsoft cannot be reached. Check the internet connection and try again".into(),
                )
            })?;
        let status = response.status().as_u16();
        let answer: Json = response.json().await.unwrap_or(Json::Null);
        if status == 200 && answer["access_token"].is_string() {
            return Ok(());
        }
        let code = answer["error"].as_str().unwrap_or_default();
        let sentence = match code {
            "invalid_client" => {
                "Microsoft does not accept the client secret. Copy its Value (not its Secret ID), or make a new one"
            }
            "unauthorized_client" | "invalid_request" => {
                "Microsoft does not know this App ID in this tenant. Check both on the Configuration page of the Azure \
                 Bot"
            }
            _ => "Microsoft did not accept the values. Check them on the Configuration page of the Azure Bot",
        };
        Err(AppError::InvalidInput(sentence.into()))
    }

    /// Reads the Teams chats of every online chatbot every [`SYNC_INTERVAL`].
    pub fn spawn(self: &Arc<Self>) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                for agent_id in service.online.teams_agents() {
                    if let Err(error) = service.sync(&agent_id).await {
                        log::info!("teams: could not read the chats of {agent_id}: {error}");
                    }
                }
                tokio::time::sleep(SYNC_INTERVAL).await;
            }
        });
    }

    /// Stores what changed in the online copy's Teams chats of `agent_id`. Returns how many
    /// messages were new.
    ///
    /// # Errors
    /// When the online copy cannot be reached or answers with an error.
    pub async fn sync(&self, agent_id: &str) -> AppResult<usize> {
        let Some(manager) = self.manager.get().and_then(Weak::upgrade) else { return Ok(0) };
        let (url, api_key) = self.online.access(agent_id)?;
        let channel = OnlineChannel {
            kind: "teams",
            app_channel: TEAMS_CHANNEL,
            synced_key: SYNCED_SETTING_KEY,
            feature_name: "Microsoft Teams",
        };
        sync_online_chats(&self.db, self.server.as_ref(), &manager, (&url, &api_key), agent_id, channel, |_, _| {})
            .await
    }
}

/// The owner's side of a Teams chat of an online chatbot.
#[derive(Debug)]
pub struct TeamsOnlineAdapter {
    service: Arc<TeamsOnlineService>,
}

impl ChannelAdapter for TeamsOnlineAdapter {
    fn name(&self) -> &'static str {
        TEAMS_CHANNEL
    }

    fn capabilities(&self) -> ChannelCapabilities {
        ChannelCapabilities { blocks: false, images: false, markup: graphrt_ui::fallback::Markup::Markdown }
    }

    /// An activity as Teams sends it (for tools that replay one).
    fn parse_inbound(&self, payload: &Json) -> AppResult<InboundMessage> {
        match graphrt_channel::teams::parse_activity(payload).event {
            graphrt_channel::InboundEvent::Message(message) if !message.text.trim().is_empty() => Ok(InboundMessage {
                customer_handle: message.chat_id,
                customer_name: message.customer.name,
                text: message.text,
            }),
            _ => Err(AppError::InvalidInput("this Teams activity is not a message".into())),
        }
    }

    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, Result<(), DeliveryFailure>> {
        Box::pin(async move {
            let conversation = outbound.conversation;
            if outbound.author != MessageAuthor::Operator {
                // The online copy sends its bot's answers itself.
                return Ok(());
            }
            let access = self.service.online.access(&conversation.agent_id);
            if !outbound.text.trim().is_empty() {
                let body = json!({ "to": conversation.customer_handle, "text": outbound.text });
                post_to_online_copy(self.service.server.as_ref(), access, "v1/channels/teams/messages", body).await?;
            }
            if !outbound.files.is_empty() || !outbound.images.is_empty() {
                return Err(DeliveryFailure::new(
                    DeliveryProblem::Other,
                    "files are not sent to Teams from the app: share them in Teams yourself",
                ));
            }
            Ok(())
        })
    }

    fn is_connected_for(&self, agent_id: &str) -> bool {
        self.service.online.teams_agents().iter().any(|agent| agent == agent_id)
    }

    fn account_label(&self, _agent_id: &str) -> Option<String> {
        Some("Microsoft Teams".to_owned())
    }

    fn answers_remotely(&self) -> bool {
        true
    }

    /// Take-over stops the online bot for this person; hand-back and closing start it again.
    fn status_changed<'a>(&'a self, conversation: &'a Conversation) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            let human = conversation.status == ConversationStatus::YouReplying;
            let body = json!({ "to": conversation.customer_handle, "human": human });
            let access = self.service.online.access(&conversation.agent_id);
            post_to_online_copy(self.service.server.as_ref(), access, "v1/channels/teams/handoff", body)
                .await
                .map_err(|failure| AppError::InvalidInput(failure.message))
        })
    }
}
