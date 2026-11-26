//! OAuth sign-in for remote (Streamable HTTP) MCP servers, following the MCP
//! authorization spec: any server that answers with a 401 can be signed in to.
//!
//! - [`metadata`]: discovery. The server's 401 names its protected resource
//!   metadata (RFC 9728), which names the authorization server, whose metadata
//!   (RFC 8414) gives the endpoints.
//! - [`client`]: the requests to the authorization server: Dynamic Client
//!   Registration (RFC 7591, falling back to a Client ID Metadata Document when
//!   the server has no registration endpoint), the code and refresh token
//!   grants and revocation (RFC 7009). The app is a public client (no secret).
//! - [`pkce`]: PKCE S256 verifier, challenge and the `state` value.
//! - [`loopback`]: the one-shot `http://127.0.0.1:<port>/callback` listener that
//!   receives the authorization code (RFC 8252).
//! - [`store`]: what is kept in the OS credential store per server: the
//!   session (endpoints, client id, status), the access and refresh tokens.
//! - [`provider`]: the [`graphrt_mcp::TokenProvider`] a run uses: it refreshes
//!   an expiring token, and after a 401 refreshes once; a rejected refresh
//!   marks the server "sign in again".
//!
//! Tokens never reach the frontend, logs or error messages.

pub mod client;
pub mod loopback;
pub mod metadata;
pub mod pkce;
pub mod provider;
pub mod store;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use self::client::{ClientRegistration, OAuthHttp, TokenGrant};
use self::metadata::Discovery;
use self::store::{ClientKind, OAuthSession};
use crate::credentials::{CredentialStore, McpOAuthPart};
use crate::storage::now_rfc3339;

/// How long the app waits for the user to finish signing in in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Name the app registers under (shown on the consent screen).
pub const CLIENT_NAME: &str = "graphrt";

/// The Client ID Metadata Document used when a server supports it and has no
/// registration endpoint (or registration fails). Its `redirect_uris` list
/// `http://127.0.0.1/callback`; the port varies per sign-in, as RFC 8252 allows
/// for loopback addresses. The document to host there is `client-metadata.json`
/// next to this file (checked by a test).
pub const CLIENT_METADATA_URL: &str = "https://graphrt.com/oauth/client-metadata.json";

/// Why signing in, refreshing or signing out failed. Never contains a token.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OAuthError {
    #[error("{0}")]
    Discovery(String),
    #[error("could not register graphrt with the sign-in server: {0}")]
    Registration(String),
    #[error("sign-in was not completed: {0}")]
    Authorization(String),
    #[error("the sign-in server refused the request: {0}")]
    Token(String),
    /// The refresh token was rejected or there is none: the user has to sign in again.
    #[error("sign in again: {0}")]
    SignInRequired(String),
    #[error("could not reach the sign-in server: {0}")]
    Network(String),
    #[error("sign-in timed out; try again")]
    TimedOut,
    #[error("sign-in was cancelled")]
    Cancelled,
    #[error("{0}")]
    Storage(String),
}

impl From<crate::error::AppError> for OAuthError {
    fn from(error: crate::error::AppError) -> Self {
        OAuthError::Storage(error.to_string())
    }
}

/// The sign-in state of a server that uses OAuth, as the Connections page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum McpSignInStatus {
    SignedOut,
    #[serde(rename_all = "camelCase")]
    SignedIn {
        /// RFC 3339 time of the sign-in.
        signed_in_at: Option<String>,
    },
    /// The server or the sign-in server rejected the stored tokens.
    Expired {
        reason: String,
    },
}

/// The sign-in state of `server` (read from the credential store, no network).
pub fn sign_in_status(credentials: &CredentialStore, server: &str) -> McpSignInStatus {
    let session = match store::load_session(credentials, server) {
        Ok(Some(session)) => session,
        Ok(None) => return McpSignInStatus::SignedOut,
        Err(error) => {
            log::warn!("could not read the sign-in of MCP server `{server}`: {error}");
            return McpSignInStatus::SignedOut;
        }
    };
    if let Some(reason) = session.needs_sign_in {
        return McpSignInStatus::Expired { reason };
    }
    let has_token = |part| credentials.read_mcp_oauth(server, part).ok().flatten().is_some();
    if has_token(McpOAuthPart::AccessToken) || has_token(McpOAuthPart::RefreshToken) {
        McpSignInStatus::SignedIn { signed_in_at: session.signed_in_at }
    } else {
        McpSignInStatus::SignedOut
    }
}

/// Sign-ins waiting for the browser, by server name, so "Cancel" can stop one.
static PENDING_SIGN_INS: Mutex<Option<HashMap<String, Arc<Notify>>>> = Mutex::new(None);

fn with_pending<Output>(change: impl FnOnce(&mut HashMap<String, Arc<Notify>>) -> Output) -> Output {
    let mut slot = match PENDING_SIGN_INS.lock() {
        Ok(slot) => slot,
        Err(poisoned) => poisoned.into_inner(),
    };
    change(slot.get_or_insert_with(HashMap::new))
}

/// Stops the sign-in of `server` that is waiting for the browser (no-op when none is).
pub fn cancel_sign_in(server: &str) {
    if let Some(waiting) = with_pending(|pending| pending.remove(server)) {
        waiting.notify_one();
    }
}

/// What a sign-in needs besides the server.
pub struct SignInOptions<'a> {
    pub http: &'a OAuthHttp,
    /// Opens the authorization URL in the user's browser.
    pub open_browser: &'a (dyn Fn(&str) -> Result<(), String> + Send + Sync),
    pub timeout: Duration,
}

/// Signs in to the MCP server `server` at `server_url`: discovers its
/// authorization server, registers the app when needed, opens the browser and
/// waits for the callback, then stores the tokens. A sign-in already waiting
/// for the same server is cancelled first.
///
/// # Errors
/// An [`OAuthError`] naming the step that failed.
pub async fn sign_in(
    credentials: &CredentialStore,
    server: &str,
    server_url: &str,
    options: SignInOptions<'_>,
) -> Result<McpSignInStatus, OAuthError> {
    cancel_sign_in(server);
    let cancelled = Arc::new(Notify::new());
    with_pending(|pending| pending.insert(server.to_owned(), cancelled.clone()));
    let outcome = run_sign_in(credentials, server, server_url, &options, &cancelled).await;
    with_pending(|pending| {
        if pending.get(server).is_some_and(|waiting| Arc::ptr_eq(waiting, &cancelled)) {
            pending.remove(server);
        }
    });
    outcome?;
    Ok(sign_in_status(credentials, server))
}

async fn run_sign_in(
    credentials: &CredentialStore,
    server: &str,
    server_url: &str,
    options: &SignInOptions<'_>,
    cancelled: &Notify,
) -> Result<(), OAuthError> {
    let discovery = metadata::discover(options.http, server_url).await?;
    let previous = store::load_session(credentials, server)?;
    let reusable = previous.filter(|session| session.issuer == discovery.issuer && session.server_url == server_url);
    let preferred_port = reusable.as_ref().and_then(|session| loopback::port_of(&session.redirect_uri));
    let listener = loopback::CallbackListener::bind(preferred_port).await?;
    let redirect_uri = listener.redirect_uri();
    let (client_id, client_kind) = match reusable.filter(|session| session.redirect_uri == redirect_uri) {
        Some(session) => (session.client_id, session.client_kind),
        None => register(options.http, &discovery, &redirect_uri).await?,
    };

    let verifier = pkce::Verifier::generate()?;
    let state = pkce::random_state()?;
    let authorize_url = client::authorization_url(&discovery, &client_id, &redirect_uri, &verifier, &state)?;
    (options.open_browser)(&authorize_url)
        .map_err(|error| OAuthError::Authorization(format!("could not open the browser: {error}")))?;
    let code = tokio::select! {
        callback = listener.wait_for_code(&state, &discovery.issuer) => callback?,
        () = cancelled.notified() => return Err(OAuthError::Cancelled),
        () = tokio::time::sleep(options.timeout) => return Err(OAuthError::TimedOut),
    };

    let grant = TokenGrant::AuthorizationCode { code: &code, redirect_uri: &redirect_uri, verifier: &verifier };
    let tokens =
        client::request_tokens(options.http, &discovery.token_endpoint, &client_id, &discovery.resource, grant).await?;
    let session = OAuthSession {
        server_url: server_url.to_owned(),
        resource: discovery.resource.clone(),
        issuer: discovery.issuer.clone(),
        authorization_endpoint: discovery.authorization_endpoint.clone(),
        token_endpoint: discovery.token_endpoint.clone(),
        revocation_endpoint: discovery.revocation_endpoint.clone(),
        client_id,
        client_kind,
        redirect_uri,
        scope: tokens.scope.clone().or_else(|| discovery.scope.clone()),
        signed_in_at: Some(now_rfc3339()),
        needs_sign_in: None,
    };
    store::save_tokens(credentials, server, &tokens)?;
    store::save_session(credentials, server, &session)?;
    Ok(())
}

/// Registers with Dynamic Client Registration, or uses the Client ID Metadata
/// Document when the server has no registration endpoint (or registration
/// failed) and supports metadata documents.
async fn register(
    http: &OAuthHttp,
    discovery: &Discovery,
    redirect_uri: &str,
) -> Result<(String, ClientKind), OAuthError> {
    let registration_error = match &discovery.registration_endpoint {
        Some(endpoint) => match client::register_client(http, endpoint, redirect_uri).await {
            Ok(ClientRegistration { client_id }) => return Ok((client_id, ClientKind::Dynamic)),
            Err(error) => Some(error),
        },
        None => None,
    };
    if discovery.client_id_metadata_document_supported {
        if let Some(error) = &registration_error {
            log::warn!("dynamic client registration failed, using the client metadata document: {error}");
        }
        return Ok((CLIENT_METADATA_URL.to_owned(), ClientKind::MetadataDocument));
    }
    Err(registration_error.unwrap_or_else(|| {
        OAuthError::Registration(
            "the server supports neither dynamic client registration nor client metadata documents".into(),
        )
    }))
}

/// Signs out of `server`: revokes the tokens at the sign-in server when it
/// offers revocation (a failure is logged, the local sign-in is removed anyway)
/// and deletes everything stored for it.
///
/// # Errors
/// `Storage` when the credential store cannot delete an entry.
pub async fn sign_out(http: &OAuthHttp, credentials: &CredentialStore, server: &str) -> Result<(), OAuthError> {
    // A refresh in flight finishes first, so the tokens it stores are the ones revoked
    // (and never written back after the sign-in is gone).
    let server_lock = provider::refresh_lock(server);
    let _no_refresh_meanwhile = server_lock.lock().await;
    let session = store::load_session(credentials, server).unwrap_or_else(|error| {
        log::warn!("could not read the sign-in of MCP server `{server}`: {error}");
        None
    });
    if let Some(session) = session.as_ref() {
        if let Some(endpoint) = &session.revocation_endpoint {
            let tokens = [(McpOAuthPart::RefreshToken, "refresh_token"), (McpOAuthPart::AccessToken, "access_token")];
            for (part, hint) in tokens {
                // An unreadable entry is not revoked, but the sign-in is still removed below.
                let token = match part {
                    McpOAuthPart::AccessToken => {
                        store::load_access_token(credentials, server).map(|t| t.map(|t| t.token))
                    }
                    _ => credentials.read_mcp_oauth(server, part).map_err(OAuthError::from),
                };
                let token = match token {
                    Ok(Some(token)) => token,
                    Ok(None) => continue,
                    Err(error) => {
                        log::warn!("could not read the {hint} of MCP server `{server}` to revoke it: {error}");
                        continue;
                    }
                };
                if let Err(error) = client::revoke(http, endpoint, &session.client_id, &token, hint).await {
                    log::warn!("could not revoke the {hint} of MCP server `{server}`: {error}");
                }
            }
        }
    }
    store::delete_all(credentials, server)?;
    Ok(())
}

/// The token source a run uses for `server` (signed in with OAuth).
pub fn token_source(credentials: Arc<CredentialStore>, server: &str) -> Result<graphrt_mcp::TokenSource, OAuthError> {
    let http = OAuthHttp::new()?;
    let provider = provider::OAuthTokenProvider::new(credentials, server.to_owned(), http);
    Ok(graphrt_mcp::TokenSource::new(Arc::new(provider)))
}
