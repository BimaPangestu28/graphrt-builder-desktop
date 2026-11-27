//! Knowledge sources that sync from somewhere else: a web site (pages, a crawl
//! or a sitemap), a REST API, Google Drive, Notion or SharePoint / OneDrive,
//! built on the graphrt runtime's `graphrt-connect` connectors.
//!
//! A connector source is a normal knowledge source (kind `url`, so the table
//! and its sync stay as they are) plus a `knowledge_connectors` row naming the
//! connector, its settings (no secret), how it signs in and its schedule.
//! Credentials (tokens, API keys, OAuth refresh tokens, client secrets) are in
//! the OS keychain under `knowledge:<source id>:<name>` and only read when the
//! connector is built for a sync.
//!
//! Indexing is the app's own (see `sync::connector_sync`): the connector lists
//! and fetches, the knowledge pipeline extracts, chunks and embeds.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use graphrt_connect::{AuthConfig, BuildContext, Connector, ConnectorRegistry, SourceConfig, SyncSchedule};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::models::{KnowledgeSource, SourceKind, SourceStatus};
use super::{records, KnowledgeService};
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::{now_rfc3339, Database};

/// Where a connector source syncs from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorKind {
    Website,
    Api,
    GoogleDrive,
    Notion,
    Sharepoint,
}

impl ConnectorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Website => "website",
            Self::Api => "api",
            Self::GoogleDrive => "google_drive",
            Self::Notion => "notion",
            Self::Sharepoint => "sharepoint",
        }
    }

    fn parse(value: &str) -> AppResult<Self> {
        match value {
            "website" => Ok(Self::Website),
            "api" => Ok(Self::Api),
            "google_drive" => Ok(Self::GoogleDrive),
            "notion" => Ok(Self::Notion),
            "sharepoint" => Ok(Self::Sharepoint),
            other => Err(AppError::Internal(format!("unknown knowledge connector `{other}`"))),
        }
    }

    /// The graphrt-connect connector type.
    fn runtime_type(self) -> &'static str {
        match self {
            Self::Website => "web",
            Self::Api => "api",
            Self::GoogleDrive => "google_drive",
            Self::Notion => "notion",
            Self::Sharepoint => "sharepoint",
        }
    }

    fn default_name(self) -> &'static str {
        match self {
            Self::Website => "Website",
            Self::Api => "API",
            Self::GoogleDrive => "Google Drive",
            Self::Notion => "Notion",
            Self::Sharepoint => "SharePoint",
        }
    }
}

/// Who a Drive or SharePoint source signs in with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OAuthProvider {
    Google,
    Microsoft,
}

/// The OAuth app the desktop app signs in with, when the build has one.
const GOOGLE_CLIENT_ID: Option<&str> = option_env!("GRAPHRT_GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("GRAPHRT_GOOGLE_CLIENT_SECRET");
const MICROSOFT_CLIENT_ID: Option<&str> = option_env!("GRAPHRT_MICROSOFT_CLIENT_ID");

impl OAuthProvider {
    pub fn authorize_url(self) -> &'static str {
        match self {
            Self::Google => "https://accounts.google.com/o/oauth2/v2/auth",
            Self::Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        }
    }

    pub fn token_url(self) -> &'static str {
        match self {
            Self::Google => "https://oauth2.googleapis.com/token",
            Self::Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        }
    }

    /// Read only scopes.
    pub fn scopes(self) -> &'static str {
        match self {
            Self::Google => graphrt_connect::connectors::google_drive::SCOPE,
            Self::Microsoft => "offline_access User.Read Files.Read.All Sites.Read.All",
        }
    }

    /// The `iss` a callback may carry (RFC 9207).
    pub fn issuer(self) -> &'static str {
        match self {
            Self::Google => "https://accounts.google.com",
            Self::Microsoft => "https://login.microsoftonline.com/common/v2.0",
        }
    }

    /// The client id and secret built into this app, if any.
    pub fn built_in_client(self) -> Option<(&'static str, Option<&'static str>)> {
        match self {
            Self::Google => GOOGLE_CLIENT_ID.filter(|id| !id.is_empty()).map(|id| (id, GOOGLE_CLIENT_SECRET)),
            Self::Microsoft => MICROSOFT_CLIENT_ID.filter(|id| !id.is_empty()).map(|id| (id, None)),
        }
    }
}

/// How a connector source signs in, as stored (never a secret).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ConnectorAuth {
    None,
    /// A bearer token (Notion integration token, an API token).
    Token,
    /// An API key sent in a header.
    ApiKey {
        header: String,
    },
    Basic {
        username: String,
    },
    /// An OAuth sign-in: the refresh token (and a client secret) are in the keychain.
    Oauth {
        provider: OAuthProvider,
        client_id: String,
        has_client_secret: bool,
    },
}

/// How a new connector source signs in, as sent by the UI (secrets included,
/// stored in the keychain and never sent back).
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ConnectorAuthInput {
    None,
    Token {
        token: String,
    },
    ApiKey {
        header: String,
        value: String,
    },
    Basic {
        username: String,
        password: String,
    },
    /// A finished sign-in (see [`KnowledgeService::connector_sign_in`]).
    Oauth {
        sign_in_id: String,
    },
}

impl std::fmt::Debug for ConnectorAuthInput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::None => "None",
            Self::Token { .. } => "Token(..)",
            Self::ApiKey { .. } => "ApiKey(..)",
            Self::Basic { .. } => "Basic(..)",
            Self::Oauth { .. } => "Oauth(..)",
        })
    }
}

/// A connector source as the UI sees it (part of [`KnowledgeSource`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorView {
    pub kind: ConnectorKind,
    /// The connector settings (`urls`, `folder_id`, `page_ids`, ...).
    pub options: serde_json::Value,
    pub auth: ConnectorAuth,
    pub schedule: SyncSchedule,
    /// Next scheduled sync (RFC 3339), `None` for manual sources.
    pub next_sync_at: Option<String>,
    /// "Signed in as ..." for OAuth sources.
    pub account_label: Option<String>,
    /// Stable kind of the last sync error (`auth`, `not_found`, `denied`, ...),
    /// translated by the UI.
    pub last_error_kind: Option<String>,
}

/// A connector source the UI is adding.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnectorSource {
    pub kind: ConnectorKind,
    #[serde(default)]
    pub name: String,
    pub options: serde_json::Value,
    pub auth: ConnectorAuthInput,
    #[serde(default)]
    pub schedule: SyncSchedule,
}

/// A stored connector row.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct StoredConnector {
    pub kind: ConnectorKind,
    pub options: serde_json::Value,
    pub auth: ConnectorAuth,
    pub schedule: SyncSchedule,
    pub account_label: Option<String>,
    pub last_error_kind: Option<String>,
}

fn json_error(error: serde_json::Error) -> AppError {
    AppError::Internal(format!("knowledge connector settings: {error}"))
}

/// `connector, options_json, auth_json, schedule_json, account_label, last_error_kind`.
type ConnectorRow = (String, String, String, String, Option<String>, Option<String>);

fn connector_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectorRow> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
}

fn decode(
    kind: &str,
    options: &str,
    auth: &str,
    schedule: &str,
    account: Option<String>,
    error: Option<String>,
) -> AppResult<StoredConnector> {
    Ok(StoredConnector {
        kind: ConnectorKind::parse(kind)?,
        options: serde_json::from_str(options).map_err(json_error)?,
        auth: serde_json::from_str(auth).map_err(json_error)?,
        schedule: serde_json::from_str(schedule).map_err(json_error)?,
        account_label: account,
        last_error_kind: error,
    })
}

/// The connector row of a source (`None` for files, folders and plain links).
pub(super) fn find_connector(db: &Database, source_id: &str) -> AppResult<Option<StoredConnector>> {
    let row = db
        .lock()?
        .query_row(
            "SELECT connector, options_json, auth_json, schedule_json, account_label, last_error_kind
             FROM knowledge_connectors WHERE source_id = ?1",
            [source_id],
            connector_from_row,
        )
        .optional()?;
    row.map(|(kind, options, auth, schedule, account, error)| decode(&kind, &options, &auth, &schedule, account, error))
        .transpose()
}

fn insert_connector(db: &Database, source_id: &str, connector: &StoredConnector) -> AppResult<()> {
    db.lock()?.execute(
        "INSERT INTO knowledge_connectors (source_id, connector, options_json, auth_json, schedule_json, account_label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            source_id,
            connector.kind.as_str(),
            connector.options.to_string(),
            serde_json::to_string(&connector.auth).map_err(json_error)?,
            serde_json::to_string(&connector.schedule).map_err(json_error)?,
            connector.account_label,
        ],
    )?;
    Ok(())
}

/// Record the error kind of the last sync (`None` after a good one).
pub(super) fn set_last_error_kind(db: &Database, source_id: &str, kind: Option<&str>) -> AppResult<()> {
    db.lock()?.execute(
        "UPDATE knowledge_connectors SET last_error_kind = ?2 WHERE source_id = ?1",
        params![source_id, kind],
    )?;
    Ok(())
}

/// RFC 3339 -> unix seconds.
fn unix_of(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp).ok().map(|time| time.timestamp())
}

fn rfc3339_of(unix: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(unix, 0).map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Next scheduled sync of a source (unix seconds), `None` for manual ones.
pub(super) fn next_due(schedule: &SyncSchedule, last_synced_at: Option<&str>, now: i64) -> Option<i64> {
    schedule.next_due(last_synced_at.and_then(unix_of), now)
}

fn view(stored: StoredConnector, last_synced_at: Option<&str>) -> ConnectorView {
    let now = chrono::Utc::now().timestamp();
    let next_sync_at = next_due(&stored.schedule, last_synced_at, now).and_then(|due| rfc3339_of(due.max(now)));
    ConnectorView {
        kind: stored.kind,
        options: stored.options,
        auth: stored.auth,
        schedule: stored.schedule,
        next_sync_at,
        account_label: stored.account_label,
        last_error_kind: stored.last_error_kind,
    }
}

/// Fills `connector` of the connector sources among `sources`.
pub(super) fn attach(db: &Database, sources: &mut [KnowledgeSource]) -> AppResult<()> {
    for source in sources.iter_mut().filter(|source| source.kind == SourceKind::Url) {
        if let Some(stored) = find_connector(db, &source.id)? {
            source.connector = Some(Box::new(view(stored, source.last_synced_at.as_deref())));
        }
    }
    Ok(())
}

/// A connector source with a schedule.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct ScheduledSource {
    pub knowledge_base_id: String,
    pub source_id: String,
    pub schedule: SyncSchedule,
    pub last_synced_at: Option<String>,
}

/// Every connector source that syncs by itself (not manual).
pub(super) fn scheduled_sources(db: &Database) -> AppResult<Vec<ScheduledSource>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare(
        "SELECT s.knowledge_base_id, s.id, c.schedule_json, s.last_synced_at
         FROM knowledge_connectors c JOIN knowledge_sources s ON s.id = c.source_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut scheduled = Vec::new();
    for row in rows {
        let (knowledge_base_id, source_id, schedule, last_synced_at) = row?;
        let schedule: SyncSchedule = serde_json::from_str(&schedule).map_err(json_error)?;
        if schedule != SyncSchedule::Manual {
            scheduled.push(ScheduledSource { knowledge_base_id, source_id, schedule, last_synced_at });
        }
    }
    Ok(scheduled)
}

/// Keychain names of a source's credentials.
pub(super) const SECRET_TOKEN: &str = "token";
pub(super) const SECRET_API_KEY: &str = "api_key";
pub(super) const SECRET_PASSWORD: &str = "password";
pub(super) const SECRET_REFRESH_TOKEN: &str = "refresh_token";
pub(super) const SECRET_CLIENT_SECRET: &str = "client_secret";
const ALL_SECRETS: [&str; 5] =
    [SECRET_TOKEN, SECRET_API_KEY, SECRET_PASSWORD, SECRET_REFRESH_TOKEN, SECRET_CLIENT_SECRET];

/// The graphrt-connect auth config of a stored sign-in (secret names, no values).
fn runtime_auth(auth: &ConnectorAuth) -> AuthConfig {
    match auth {
        ConnectorAuth::None => AuthConfig::None,
        ConnectorAuth::Token => AuthConfig::Bearer { token_env: SECRET_TOKEN.into() },
        ConnectorAuth::ApiKey { header } => {
            AuthConfig::Header { name: header.clone(), value_env: SECRET_API_KEY.into() }
        }
        ConnectorAuth::Basic { username } => {
            AuthConfig::Basic { username: username.clone(), password_env: SECRET_PASSWORD.into() }
        }
        ConnectorAuth::Oauth { provider, client_id, has_client_secret } => AuthConfig::Oauth {
            token_url: provider.token_url().into(),
            client_id: client_id.clone(),
            client_secret_env: has_client_secret.then(|| SECRET_CLIENT_SECRET.to_owned()),
            refresh_token_env: SECRET_REFRESH_TOKEN.into(),
        },
    }
}

/// The graphrt-connect source config of a connector source.
pub(super) fn runtime_source(source_id: &str, stored: &StoredConnector) -> SourceConfig {
    SourceConfig::new(source_id, stored.kind.runtime_type(), stored.options.clone())
        .schedule(stored.schedule.clone())
        .auth(runtime_auth(&stored.auth))
}

/// Tests let the service connectors (Drive, Notion, SharePoint) reach a mock server.
#[cfg(test)]
pub(super) static PRIVATE_ENDPOINTS_FOR_TESTS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn private_endpoints() -> bool {
    #[cfg(test)]
    return PRIVATE_ENDPOINTS_FOR_TESTS.load(std::sync::atomic::Ordering::Relaxed);
    #[cfg(not(test))]
    false
}

/// Build the connector of a source, reading its credentials from the keychain.
/// Refresh tokens a service rotates are saved back.
pub(super) fn build_connector(
    credentials: &Arc<CredentialStore>,
    source_id: &str,
    stored: &StoredConnector,
) -> Result<Box<dyn Connector>, graphrt_connect::ConnectError> {
    let lookup = |name: &str| credentials.read_knowledge_secret(source_id, name).ok().flatten();
    let mut ctx = BuildContext::new(&lookup);
    ctx.private_service_endpoints = private_endpoints();
    let store = Arc::clone(credentials);
    let id = source_id.to_owned();
    ctx.on_rotate = Some(Arc::new(move |rotated| {
        if let Err(error) = store.set_knowledge_secret(&id, SECRET_REFRESH_TOKEN, rotated.refresh_token.expose()) {
            log::warn!("could not save the new sign-in of knowledge source {id}: {error}");
        }
    }));
    ConnectorRegistry::with_builtins().build(&runtime_source(source_id, stored), &ctx)
}

/// A finished OAuth sign-in waiting to be attached to a new source.
#[derive(Clone)]
pub(super) struct PendingSignIn {
    pub provider: OAuthProvider,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub refresh_token: String,
    pub account_label: Option<String>,
}

/// Sign-ins finished in this session, by id (taken when the source is added).
fn pending_sign_ins() -> &'static Mutex<HashMap<String, PendingSignIn>> {
    static PENDING: std::sync::OnceLock<Mutex<HashMap<String, PendingSignIn>>> = std::sync::OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn remember_sign_in(sign_in: PendingSignIn) -> AppResult<String> {
    let id = format!("signin_{}", uuid::Uuid::new_v4().simple());
    pending_sign_ins()
        .lock()
        .map_err(|_| AppError::Internal("sign-in table lock poisoned".into()))?
        .insert(id.clone(), sign_in);
    Ok(id)
}

fn take_sign_in(id: &str) -> AppResult<PendingSignIn> {
    pending_sign_ins()
        .lock()
        .map_err(|_| AppError::Internal("sign-in table lock poisoned".into()))?
        .remove(id)
        .ok_or_else(|| AppError::InvalidInput("the sign-in expired; sign in again".into()))
}

fn required(value: &str, what: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{what} is empty")));
    }
    Ok(value.to_owned())
}

/// The display name of a new source: the given one, or from its settings.
fn display_name(new: &NewConnectorSource) -> String {
    let given = new.name.trim();
    if !given.is_empty() {
        return given.chars().take(120).collect();
    }
    let first_url = |key: &str| {
        new.options.get(key).and_then(|v| v.as_array().and_then(|a| a.first()).or(Some(v))).and_then(|v| v.as_str())
    };
    let from_url = match new.kind {
        ConnectorKind::Website => first_url("urls"),
        ConnectorKind::Api => first_url("url"),
        ConnectorKind::Sharepoint => first_url("site_url"),
        _ => None,
    };
    from_url
        .and_then(|url| url::Url::parse(url).ok())
        .map(|url| format!("{}{}", url.host_str().unwrap_or_default(), url.path().trim_end_matches('/')))
        .unwrap_or_else(|| new.kind.default_name().to_owned())
}

impl KnowledgeService {
    /// One source, with its connector settings when it has some.
    ///
    /// # Errors
    /// `NotFound` for an unknown source.
    pub fn source(&self, source_id: &str) -> AppResult<KnowledgeSource> {
        records::get_source(&self.db, source_id)
    }

    /// Adds a connector source. Its settings are checked by building the
    /// connector (no request is made); it is indexed by the next sync.
    ///
    /// # Errors
    /// `NotFound` for an unknown knowledge base, `InvalidInput` for unusable
    /// settings, a missing credential or an expired sign-in.
    pub fn add_connector_source(&self, knowledge_base_id: &str, new: NewConnectorSource) -> AppResult<KnowledgeSource> {
        records::get_knowledge_base(&self.db, knowledge_base_id)?;
        new.schedule.validate().map_err(|error| AppError::InvalidInput(error.to_string()))?;
        if !new.options.is_object() {
            return Err(AppError::InvalidInput("the source settings are missing".into()));
        }
        let source_id = format!("src_{}", uuid::Uuid::new_v4().simple());
        // Credentials first (keychain), so the connector can be built to check the settings.
        let (auth, account_label) = self.store_credentials(&source_id, new.auth.clone())?;
        let stored = StoredConnector {
            kind: new.kind,
            options: new.options.clone(),
            auth,
            schedule: new.schedule.clone(),
            account_label,
            last_error_kind: None,
        };
        if let Err(error) = build_connector(&self.credentials, &source_id, &stored) {
            self.forget_credentials(&source_id);
            return Err(AppError::InvalidInput(error.to_string()));
        }
        let source = KnowledgeSource {
            id: source_id.clone(),
            knowledge_base_id: knowledge_base_id.to_owned(),
            kind: SourceKind::Url,
            location: format!("connector:{source_id}"),
            name: display_name(&new),
            status: SourceStatus::Pending,
            status_message: None,
            document_count: 0,
            failed_count: 0,
            passage_count: 0,
            last_synced_at: None,
            created_at: now_rfc3339(),
            connector: None,
        };
        let saved =
            records::insert_source(&self.db, &source).and_then(|()| insert_connector(&self.db, &source_id, &stored));
        if let Err(error) = saved {
            self.forget_credentials(&source_id);
            let _cleanup = records::delete_source(&self.db, &source_id);
            return Err(error);
        }
        records::get_source(&self.db, &source_id)
    }

    /// Change when a connector source syncs.
    ///
    /// # Errors
    /// `NotFound` for an unknown or non connector source, `InvalidInput` for a bad schedule.
    pub fn set_connector_schedule(&self, source_id: &str, schedule: SyncSchedule) -> AppResult<KnowledgeSource> {
        schedule.validate().map_err(|error| AppError::InvalidInput(error.to_string()))?;
        let text = serde_json::to_string(&schedule).map_err(json_error)?;
        let changed = self.db.lock()?.execute(
            "UPDATE knowledge_connectors SET schedule_json = ?2 WHERE source_id = ?1",
            params![source_id, text],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("knowledge connector source {source_id}")));
        }
        records::get_source(&self.db, source_id)
    }

    /// Saves the credentials of a new source; returns how it signs in.
    fn store_credentials(
        &self,
        source_id: &str,
        input: ConnectorAuthInput,
    ) -> AppResult<(ConnectorAuth, Option<String>)> {
        let save = |name: &str, value: &str| self.credentials.set_knowledge_secret(source_id, name, value);
        Ok(match input {
            ConnectorAuthInput::None => (ConnectorAuth::None, None),
            ConnectorAuthInput::Token { token } => {
                save(SECRET_TOKEN, &required(&token, "the token")?)?;
                (ConnectorAuth::Token, None)
            }
            ConnectorAuthInput::ApiKey { header, value } => {
                let header = required(&header, "the header name")?;
                save(SECRET_API_KEY, &required(&value, "the API key")?)?;
                (ConnectorAuth::ApiKey { header }, None)
            }
            ConnectorAuthInput::Basic { username, password } => {
                save(SECRET_PASSWORD, &required(&password, "the password")?)?;
                (ConnectorAuth::Basic { username: required(&username, "the user name")? }, None)
            }
            ConnectorAuthInput::Oauth { sign_in_id } => {
                let sign_in = take_sign_in(&sign_in_id)?;
                save(SECRET_REFRESH_TOKEN, &sign_in.refresh_token)?;
                if let Some(secret) = &sign_in.client_secret {
                    save(SECRET_CLIENT_SECRET, secret)?;
                }
                let auth = ConnectorAuth::Oauth {
                    provider: sign_in.provider,
                    client_id: sign_in.client_id,
                    has_client_secret: sign_in.client_secret.is_some(),
                };
                (auth, sign_in.account_label)
            }
        })
    }

    /// Removes every credential of a source (after it is deleted, or a failed add).
    pub(super) fn forget_credentials(&self, source_id: &str) {
        for name in ALL_SECRETS {
            if let Err(error) = self.credentials.delete_knowledge_secret(source_id, name) {
                log::warn!("could not remove a credential of knowledge source {source_id}: {error}");
            }
        }
    }
}
