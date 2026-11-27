//! Teams: build agents together on a team server (`graphrt collab`, Graphrt's hosted
//! server or a company's own).
//!
//! - **The server** is one address in Settings > Team server (Graphrt's by default, any
//!   `https://` address, or `http://localhost` for testing). "Check connection" says in
//!   plain words what is wrong (wrong address, invalid certificate, not a team server).
//!   Changing servers keeps every local agent.
//! - **Sign in** with the server's identity provider in the browser (a loopback redirect,
//!   the password never reaches the app) or by joining with an invite link. The refresh
//!   token is kept in the OS keychain under `collab:<server key>`, never in SQLite.
//! - **Share** turns a local agent into a project of a team: the agent keeps living in
//!   SQLite as before, and [`session`] keeps it in sync both ways (each local save becomes
//!   an update, each change of others a local save), with who is there.
//! - **Offline**: the shared document is kept with the agent, so edits made offline are
//!   sent and merged when the server is back.
//!
//! Nothing here runs or reaches the network until someone picks Share or Join: single
//! player use is unchanged.

mod merge;
pub mod session;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use graphrt_collab::client::{Api, ClientError, LoopbackLogin, Tokens};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Graphrt's hosted team server, unless the build names another (`GRAPHRT_COLLAB_DEFAULT_URL`).
pub const DEFAULT_SERVER: &str = match option_env!("GRAPHRT_COLLAB_DEFAULT_URL") {
    Some(url) => url,
    None => "https://collab.graphrt.com",
};

/// App setting: the team server address.
const SETTING_SERVER: &str = "collab_server";
/// Agent setting: which project of which team an agent is ([`Link`]).
pub(crate) const AGENT_LINK: &str = "collab_link";
/// Agent setting: the shared document as last known (offline edits included), base64.
pub(crate) const AGENT_STATE: &str = "collab_state";
/// Agent setting: the project JSON both sides last agreed on.
pub(crate) const AGENT_SYNCED: &str = "collab_synced";
/// How long a sign in in the browser may take.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Access tokens are renewed this long before they expire.
const RENEW_MARGIN: Duration = Duration::from_secs(90);

/// Tauri events: an agent changed by others (reload it), and the sharing state of an agent.
pub const COLLAB_CHANGED_EVENT: &str = "collab-changed";
pub const COLLAB_AGENT_EVENT: &str = "collab-agent";

/// Where the app reports to the UI.
pub trait CollabEvents: Send + Sync + std::fmt::Debug {
    /// `agent_id` was changed by someone else: reload it.
    fn changed(&self, agent_id: &str);
    /// The sharing state of `agent_id` (connection, people) changed.
    fn agent(&self, agent_id: &str);
}

/// Events to the webview.
#[derive(Debug)]
pub struct TauriCollabEvents {
    app_handle: tauri::AppHandle,
}

impl TauriCollabEvents {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl CollabEvents for TauriCollabEvents {
    fn changed(&self, agent_id: &str) {
        use tauri::Emitter as _;
        if let Err(error) = self.app_handle.emit(COLLAB_CHANGED_EVENT, json!({ "agentId": agent_id })) {
            eprintln!("warning: collab: {error}");
        }
    }

    fn agent(&self, agent_id: &str) {
        use tauri::Emitter as _;
        if let Err(error) = self.app_handle.emit(COLLAB_AGENT_EVENT, json!({ "agentId": agent_id })) {
            eprintln!("warning: collab: {error}");
        }
    }
}

/// Which project an agent is shared as.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub server: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub project_id: String,
}

/// What Settings > Team server shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabStatus {
    pub server: String,
    pub default_server: String,
    pub signed_in: bool,
    /// `{id, name, email, color}` of the signed in account.
    pub account: Option<Value>,
}

/// Why a server check failed, in words the UI translates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerProblem {
    /// Not an address at all.
    Address,
    /// `http://` to another computer (only localhost may skip HTTPS).
    PlainHttp,
    /// Nothing answers (wrong host or port, offline, firewall).
    Unreachable,
    /// The certificate is not valid for the name, expired or unknown.
    Tls,
    /// Something answers, but it is not a Graphrt team server.
    NotCollab,
    /// It answered with an error.
    Http,
}

/// The result of "Check connection".
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    pub server: String,
    pub ok: bool,
    pub problem: Option<ServerProblem>,
    pub detail: Option<String>,
    /// How people sign in there: with the browser, with invite links.
    pub sign_in_with_browser: bool,
    pub sign_in_with_invite: bool,
    /// The identity providers, one sign in button each (e.g. Google and Microsoft).
    /// Empty for a server with one unnamed provider: one "Sign in" button.
    pub sign_in_providers: Vec<SignInChoice>,
    /// `hosted` or `self_hosted`.
    pub mode: Option<String>,
}

/// An identity provider of the server, a sign in button.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SignInChoice {
    pub id: String,
    pub name: String,
}

/// The sharing state of one agent, for its header.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCollab {
    pub shared: bool,
    pub link: Option<Link>,
    /// `connecting`, `connected`, `offline`, `signed_out`, `removed`, `other_server`.
    pub connection: String,
    pub role: Option<String>,
    pub read_only: bool,
    /// Who else is in the project: `{id, name, color, role}`.
    pub people: Vec<Value>,
    pub message: Option<String>,
}

/// A cached access token.
#[derive(Debug, Clone)]
struct Access {
    token: String,
    until: Instant,
}

#[derive(Debug, Default)]
struct Cache {
    access: Option<Access>,
    scoped: HashMap<String, Access>,
    account: Option<Value>,
}

/// The team features of the app.
#[derive(Debug)]
pub struct Collab {
    pub(crate) db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    pub(crate) events: Arc<dyn CollabEvents>,
    cache: tokio::sync::Mutex<Cache>,
    pub(crate) sessions: Mutex<HashMap<String, session::SessionHandle>>,
}

/// The keychain name of the sign in on `server`: a short hash of its address.
fn server_key(server: &str) -> String {
    use sha2::Digest as _;
    let digest = sha2::Sha256::digest(server.as_bytes());
    digest.iter().take(12).map(|b| format!("{b:02x}")).collect()
}

fn client_error(error: ClientError) -> AppError {
    match error {
        ClientError::Address(why) => AppError::InvalidInput(why),
        ClientError::Http { status: 401, message } => {
            AppError::Credentials(if message.is_empty() { "sign in again".into() } else { message })
        }
        ClientError::Http { status: 403, message } => AppError::Conflict(message),
        ClientError::Http { status: 404, message } => AppError::NotFound(message),
        ClientError::Http { message, status } => {
            AppError::Internal(format!("the team server answered {status}: {message}"))
        }
        other => AppError::Internal(other.to_string()),
    }
}

/// The device name the server shows next to a sign in.
fn device_name() -> String {
    let host = std::env::var("HOSTNAME").or_else(|_| std::env::var("COMPUTERNAME")).unwrap_or_default();
    if host.is_empty() {
        "Graphrt Desktop".into()
    } else {
        format!("Graphrt Desktop on {host}")
    }
}

impl Collab {
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>, events: Arc<dyn CollabEvents>) -> Self {
        Self {
            db,
            credentials,
            events,
            cache: tokio::sync::Mutex::new(Cache::default()),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// The team server address.
    pub fn server(&self) -> String {
        self.db
            .get_setting(SETTING_SERVER)
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_SERVER.to_owned())
    }

    fn api(&self) -> AppResult<Api> {
        Api::new(&self.server()).map_err(client_error)
    }

    /// What Settings > Team server shows.
    pub async fn status(&self) -> AppResult<CollabStatus> {
        let server = self.server();
        let signed_in = self.credentials.read_collab_secret(&server_key(&server))?.is_some();
        let account = if signed_in { self.cache.lock().await.account.clone() } else { None };
        let account = match (signed_in, account) {
            (true, None) => self.account().await.ok(),
            (_, account) => account,
        };
        Ok(CollabStatus { server, default_server: DEFAULT_SERVER.to_owned(), signed_in, account })
    }

    /// Check a server address as typed (nothing is saved).
    pub async fn check(&self, address: &str) -> ServerCheck {
        let failed = |server: String, problem, detail: Option<String>| ServerCheck {
            server,
            ok: false,
            problem: Some(problem),
            detail,
            sign_in_with_browser: false,
            sign_in_with_invite: false,
            sign_in_providers: Vec::new(),
            mode: None,
        };
        let api = match Api::new(address) {
            Ok(api) => api,
            Err(ClientError::Address(why)) if why.contains("plain http") => {
                return failed(address.trim().to_owned(), ServerProblem::PlainHttp, Some(why));
            }
            Err(error) => return failed(address.trim().to_owned(), ServerProblem::Address, Some(error.to_string())),
        };
        let server = api.base().to_owned();
        match api.info().await {
            Ok(info) => ServerCheck {
                server,
                ok: true,
                problem: None,
                detail: None,
                sign_in_with_browser: info.sign_in.oidc,
                sign_in_with_invite: info.sign_in.invite_codes,
                sign_in_providers: info
                    .sign_in
                    .providers
                    .iter()
                    .map(|p| SignInChoice { id: p.id.clone(), name: p.name.clone() })
                    .collect(),
                mode: Some(info.mode),
            },
            Err(ClientError::Tls(why)) => failed(server, ServerProblem::Tls, Some(why)),
            Err(ClientError::Unreachable(why)) => failed(server, ServerProblem::Unreachable, Some(why)),
            Err(ClientError::NotCollab) => failed(server, ServerProblem::NotCollab, None),
            Err(error) => failed(server, ServerProblem::Http, Some(error.to_string())),
        }
    }

    /// Use the server at `address` from now on. Local agents stay; agents shared on
    /// another server stop syncing until it is chosen again.
    pub async fn set_server(self: &Arc<Self>, address: &str) -> AppResult<CollabStatus> {
        let api = Api::new(address).map_err(client_error)?;
        self.db.set_setting(SETTING_SERVER, api.base())?;
        *self.cache.lock().await = Cache::default();
        self.stop_all();
        self.start_shared();
        self.status().await
    }

    /// Sign in with one of the server's identity providers in the browser
    /// (`provider` is the id of a [`SignInChoice`], `None` for the server's first).
    pub async fn sign_in(self: &Arc<Self>, provider: Option<&str>) -> AppResult<CollabStatus> {
        let api = self.api()?;
        let login = LoopbackLogin::start().await.map_err(client_error)?;
        let url = login.url(&api, &device_name(), provider).map_err(client_error)?;
        self.open_browser(url)?;
        let tokens = login.finish(&api, SIGN_IN_TIMEOUT).await.map_err(client_error)?;
        self.keep(&tokens).await?;
        self.start_shared();
        self.status().await
    }

    fn open_browser(&self, url: String) -> AppResult<()> {
        crate::crash_reports::sharing::open_in_browser(&url)
    }

    /// Forget the sign in on the current server (and end it there).
    pub async fn sign_out(&self) -> AppResult<CollabStatus> {
        let server = self.server();
        let key = server_key(&server);
        if let Some(refresh) = self.credentials.read_collab_secret(&key)? {
            if let Ok(api) = self.api() {
                let _ended = api.logout(&refresh).await;
            }
        }
        self.credentials.delete_collab_secret(&key)?;
        *self.cache.lock().await = Cache::default();
        self.stop_all();
        self.status().await
    }

    async fn keep(&self, tokens: &Tokens) -> AppResult<()> {
        let server = self.server();
        self.credentials.set_collab_secret(&server_key(&server), &tokens.refresh_token)?;
        let mut cache = self.cache.lock().await;
        cache.access = Some(Access {
            token: tokens.access_token.clone(),
            until: Instant::now() + Duration::from_secs(tokens.expires_in).saturating_sub(RENEW_MARGIN),
        });
        cache.account = Some(tokens.account.clone());
        cache.scoped.clear();
        Ok(())
    }

    /// An account access token, refreshing the sign in when needed.
    pub(crate) async fn access(&self) -> AppResult<String> {
        // One refresh at a time: a refresh token works once.
        let mut cache = self.cache.lock().await;
        if let Some(access) = cache.access.as_ref().filter(|a| a.until > Instant::now()) {
            return Ok(access.token.clone());
        }
        let server = self.server();
        let key = server_key(&server);
        let refresh = self
            .credentials
            .read_collab_secret(&key)?
            .ok_or_else(|| AppError::Credentials("sign in to the team server first".into()))?;
        let api = self.api()?;
        let tokens = match api.refresh(&refresh).await {
            Ok(tokens) => tokens,
            Err(error) if error.needs_sign_in() => {
                self.credentials.delete_collab_secret(&key)?;
                *cache = Cache::default();
                return Err(AppError::Credentials("the sign in on the team server ended: sign in again".into()));
            }
            Err(error) => return Err(client_error(error)),
        };
        self.credentials.set_collab_secret(&key, &tokens.refresh_token)?;
        cache.access = Some(Access {
            token: tokens.access_token.clone(),
            until: Instant::now() + Duration::from_secs(tokens.expires_in).saturating_sub(RENEW_MARGIN),
        });
        cache.account = Some(tokens.account.clone());
        Ok(tokens.access_token)
    }

    /// A token for the sync sessions of `workspace`.
    pub(crate) async fn scoped(&self, workspace: &str) -> AppResult<String> {
        if let Some(access) = self.cache.lock().await.scoped.get(workspace).filter(|a| a.until > Instant::now()) {
            return Ok(access.token.clone());
        }
        let account = self.access().await?;
        let (token, expires_in) = self.api()?.scoped_token(&account, workspace).await.map_err(client_error)?;
        let until = Instant::now() + Duration::from_secs(expires_in).saturating_sub(RENEW_MARGIN);
        self.cache.lock().await.scoped.insert(workspace.to_owned(), Access { token: token.clone(), until });
        Ok(token)
    }

    async fn account(&self) -> AppResult<Value> {
        let access = self.access().await?;
        let me = self.api()?.get(&access, "/v1/me").await.map_err(client_error)?;
        let account = me.get("account").cloned().unwrap_or(Value::Null);
        self.cache.lock().await.account = Some(account.clone());
        Ok(account)
    }

    async fn get(&self, path: &str) -> AppResult<Value> {
        let access = self.access().await?;
        self.api()?.get(&access, path).await.map_err(client_error)
    }

    async fn post(&self, path: &str, body: &Value) -> AppResult<Value> {
        let access = self.access().await?;
        self.api()?.post(&access, path, body).await.map_err(client_error)
    }

    /// What an invite link is for.
    pub async fn preview_invite(&self, link: &str) -> AppResult<Value> {
        let api = Api::new(&server_of_link(link).unwrap_or_else(|| self.server())).map_err(client_error)?;
        let mut preview = api.preview_invite(link).await.map_err(client_error)?;
        if let Some(object) = preview.as_object_mut() {
            object.insert("server".into(), json!(api.base()));
        }
        Ok(preview)
    }

    /// Join a team with an invite link. A link of another server switches to it
    /// (local agents stay). Signed out, `name` is the new account's name.
    pub async fn join(self: &Arc<Self>, link: &str, name: Option<&str>) -> AppResult<Value> {
        if let Some(server) = server_of_link(link).filter(|server| *server != self.server()) {
            self.set_server(&server).await?;
        }
        let api = self.api()?;
        let signed_in = self.credentials.read_collab_secret(&server_key(&self.server()))?.is_some();
        let access = if signed_in { Some(self.access().await?) } else { None };
        let redeemed = api.redeem_invite(link, access.as_deref(), name, &device_name()).await.map_err(client_error)?;
        if let (Some(refresh), Some(access)) = (&redeemed.refresh_token, &redeemed.access_token) {
            let tokens = Tokens {
                access_token: access.clone(),
                expires_in: 600,
                refresh_token: refresh.clone(),
                account: redeemed.account.clone(),
            };
            self.keep(&tokens).await?;
        }
        self.cache.lock().await.scoped.clear();
        self.start_shared();
        Ok(json!({ "workspace": redeemed.workspace, "role": redeemed.role }))
    }

    /// The teams of the signed in account.
    pub async fn workspaces(&self) -> AppResult<Value> {
        let me = self.get("/v1/me").await?;
        Ok(json!({
            "workspaces": me.get("workspaces").cloned().unwrap_or(json!([])),
            "mayCreate": me.get("may_create_workspaces").cloned().unwrap_or(Value::Bool(false)),
        }))
    }

    /// Create a team.
    pub async fn create_workspace(&self, name: &str) -> AppResult<Value> {
        self.post("/v1/workspaces", &json!({ "name": name })).await
    }

    /// A team: members, shared projects (with who is online), and this account's role.
    pub async fn workspace(&self, workspace: &str) -> AppResult<Value> {
        check_id(workspace, "ws_")?;
        self.get(&format!("/v1/workspaces/{workspace}")).await
    }

    /// An invite link to a team with `role` (`viewer` or `operator`).
    pub async fn invite(&self, workspace: &str, role: &str) -> AppResult<Value> {
        check_id(workspace, "ws_")?;
        if !matches!(role, "viewer" | "operator") {
            return Err(AppError::InvalidInput("invite people to view or to edit".into()));
        }
        self.post(&format!("/v1/workspaces/{workspace}/invites"), &json!({ "role": role, "max_uses": 20 })).await
    }

    /// Change a member's role, or (`None`) remove them.
    pub async fn set_member(&self, workspace: &str, account: &str, role: Option<&str>) -> AppResult<Value> {
        check_id(workspace, "ws_")?;
        check_id(account, "acct_")?;
        let access = self.access().await?;
        let api = self.api()?;
        let path = format!("/v1/workspaces/{workspace}/members/{account}");
        match role {
            Some(role) => api.put(&access, &path, &json!({ "role": role })).await,
            None => api.delete(&access, &path).await,
        }
        .map_err(client_error)
    }

    /// Share a local agent with a team: it becomes a project there, kept in sync.
    pub async fn share(self: &Arc<Self>, agent_id: &str, workspace: &str) -> AppResult<AgentCollab> {
        check_id(workspace, "ws_")?;
        if self.link(agent_id)?.is_some() {
            return Err(AppError::Conflict("this agent is shared already".into()));
        }
        let agent = self.db.get_agent(agent_id)?;
        let content = session::local_project(&self.db, agent_id)?;
        let created = self
            .post(&format!("/v1/workspaces/{workspace}/projects"), &json!({ "name": agent.name, "content": content }))
            .await?;
        let project =
            created.get("id").and_then(Value::as_str).ok_or_else(|| AppError::Internal("no project id".into()))?;
        let team = self.workspace(workspace).await?;
        let link = Link {
            server: self.server(),
            workspace_id: workspace.to_owned(),
            workspace_name: team.get("name").and_then(Value::as_str).unwrap_or("").to_owned(),
            project_id: project.to_owned(),
        };
        self.db.set_agent_setting(agent_id, AGENT_LINK, &serde_json::to_value(&link)?)?;
        self.db.set_agent_setting(agent_id, AGENT_SYNCED, &content)?;
        self.start(agent_id, link);
        self.agent_state(agent_id)
    }

    /// Open a project of a team on this computer: a local agent, kept in sync.
    /// When one is there already, that one.
    pub async fn open_project(self: &Arc<Self>, workspace: &str, project: &str) -> AppResult<String> {
        check_id(workspace, "ws_")?;
        check_id(project, "pr_")?;
        let server = self.server();
        for agent_id in self.db.agents_with_setting(AGENT_LINK)? {
            if self.link(&agent_id)?.is_some_and(|link| link.server == server && link.project_id == project) {
                return Ok(agent_id);
            }
        }
        let shared = self.get(&format!("/v1/workspaces/{workspace}/projects/{project}")).await?;
        let content = shared.get("content").cloned().unwrap_or(json!({}));
        let agent_id = session::create_local(&self.db, &content, shared.get("name").and_then(Value::as_str))?;
        let team = self.workspace(workspace).await?;
        let link = Link {
            server,
            workspace_id: workspace.to_owned(),
            workspace_name: team.get("name").and_then(Value::as_str).unwrap_or("").to_owned(),
            project_id: project.to_owned(),
        };
        self.db.set_agent_setting(&agent_id, AGENT_LINK, &serde_json::to_value(&link)?)?;
        self.db.set_agent_setting(&agent_id, AGENT_SYNCED, &session::local_project(&self.db, &agent_id)?)?;
        self.start(&agent_id, link);
        Ok(agent_id)
    }

    /// Stop sharing an agent on this computer: it stays as a local agent (the team keeps its copy).
    pub fn stop_sharing(&self, agent_id: &str) -> AppResult<AgentCollab> {
        self.stop(agent_id);
        for key in [AGENT_LINK, AGENT_STATE, AGENT_SYNCED] {
            self.db.delete_agent_setting(agent_id, key)?;
        }
        self.agent_state(agent_id)
    }

    pub(crate) fn link(&self, agent_id: &str) -> AppResult<Option<Link>> {
        match self.db.get_agent_setting(agent_id, AGENT_LINK)? {
            Some(value) => Ok(serde_json::from_value(value).ok()),
            None => Ok(None),
        }
    }

    /// The sharing state of an agent.
    pub fn agent_state(&self, agent_id: &str) -> AppResult<AgentCollab> {
        let Some(link) = self.link(agent_id)? else {
            return Ok(AgentCollab {
                shared: false,
                link: None,
                connection: "local".into(),
                role: None,
                read_only: false,
                people: Vec::new(),
                message: None,
            });
        };
        if link.server != self.server() {
            return Ok(AgentCollab {
                shared: true,
                link: Some(link),
                connection: "other_server".into(),
                role: None,
                read_only: false,
                people: Vec::new(),
                message: None,
            });
        }
        let sessions = self.sessions.lock().map_err(|_| AppError::Internal("collab lock".into()))?;
        let live = sessions.get(agent_id).map(session::SessionHandle::snapshot);
        Ok(match live {
            Some(live) => AgentCollab {
                shared: true,
                link: Some(link),
                connection: live.connection,
                role: live.role,
                read_only: live.read_only,
                people: live.people,
                message: live.message,
            },
            None => AgentCollab {
                shared: true,
                link: Some(link),
                connection: "signed_out".into(),
                role: None,
                read_only: false,
                people: Vec::new(),
                message: None,
            },
        })
    }

    /// Start syncing every shared agent of the current server (at startup, after a sign in).
    pub fn start_shared(self: &Arc<Self>) {
        let server = self.server();
        let Ok(signed_in) = self.credentials.read_collab_secret(&server_key(&server)) else { return };
        if signed_in.is_none() {
            return;
        }
        let Ok(agents) = self.db.agents_with_setting(AGENT_LINK) else { return };
        for agent_id in agents {
            if let Ok(Some(link)) = self.link(&agent_id) {
                if link.server == server {
                    self.start(&agent_id, link);
                }
            }
        }
    }

    fn start(self: &Arc<Self>, agent_id: &str, link: Link) {
        let Ok(mut sessions) = self.sessions.lock() else { return };
        if sessions.contains_key(agent_id) {
            return;
        }
        let handle = session::spawn(Arc::downgrade(self), agent_id.to_owned(), link);
        sessions.insert(agent_id.to_owned(), handle);
    }

    pub(crate) fn stop(&self, agent_id: &str) {
        if let Some(handle) = self.sessions.lock().ok().and_then(|mut sessions| sessions.remove(agent_id)) {
            handle.stop();
        }
    }

    fn stop_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, handle) in sessions.drain() {
                handle.stop();
            }
        }
    }

    /// Tell the others what this person looks at (a node id), in a shared agent.
    pub fn set_focus(&self, agent_id: &str, node: Option<&str>) {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(handle) = sessions.get(agent_id) {
                handle.focus(node);
            }
        }
    }
}

/// The server address of an invite link (`https://x/join#code`), `None` for a bare code.
pub fn server_of_link(link: &str) -> Option<String> {
    let (before, _) = link.trim().split_once('#')?;
    let server = before.strip_suffix("/join")?;
    graphrt_collab::client::normalize_url(server).ok()
}

fn check_id(id: &str, prefix: &str) -> AppResult<()> {
    let ok =
        id.strip_prefix(prefix).is_some_and(|rest| rest.len() == 24 && rest.bytes().all(|b| b.is_ascii_hexdigit()));
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("`{id}` is not a team server id")))
    }
}
