//! What is kept per signed-in server in the OS credential store
//! ([`McpOAuthPart`]): the session (no secret), the access token with its
//! expiry, and the refresh token.

use serde::{Deserialize, Serialize};

use super::client::TokenResponse;
use super::OAuthError;
use crate::credentials::{CredentialStore, McpOAuthPart};

/// How the app's client id was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientKind {
    /// Dynamic Client Registration (RFC 7591).
    Dynamic,
    /// The client id is the URL of graphrt's Client ID Metadata Document.
    MetadataDocument,
}

/// A server's sign-in: where to refresh and revoke, and its state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSession {
    pub server_url: String,
    pub resource: String,
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
    pub client_id: String,
    pub client_kind: ClientKind,
    pub redirect_uri: String,
    pub scope: Option<String>,
    pub signed_in_at: Option<String>,
    /// Why the user has to sign in again (tokens were rejected); `None` while signed in.
    pub needs_sign_in: Option<String>,
}

/// The access token and when it expires (Unix seconds; `None` when the server did not say).
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccessToken {
    pub token: String,
    pub expires_at: Option<i64>,
}

impl std::fmt::Debug for StoredAccessToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("StoredAccessToken").field("expires_at", &self.expires_at).finish_non_exhaustive()
    }
}

/// Seconds before expiry at which a token is refreshed instead of used.
pub const EXPIRY_MARGIN_SECONDS: i64 = 60;

impl StoredAccessToken {
    /// Whether the token expires within [`EXPIRY_MARGIN_SECONDS`] of `now`.
    pub fn is_expiring(&self, now: i64) -> bool {
        self.expires_at.is_some_and(|expires_at| expires_at - EXPIRY_MARGIN_SECONDS <= now)
    }
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn load_session(credentials: &CredentialStore, server: &str) -> Result<Option<OAuthSession>, OAuthError> {
    let Some(text) = credentials.read_mcp_oauth(server, McpOAuthPart::Session)? else { return Ok(None) };
    serde_json::from_str(&text).map(Some).map_err(|error| OAuthError::Storage(format!("unreadable sign-in: {error}")))
}

pub fn save_session(credentials: &CredentialStore, server: &str, session: &OAuthSession) -> Result<(), OAuthError> {
    let text = serde_json::to_string(session).map_err(|error| OAuthError::Storage(error.to_string()))?;
    Ok(credentials.set_mcp_oauth(server, McpOAuthPart::Session, &text)?)
}

pub fn load_access_token(credentials: &CredentialStore, server: &str) -> Result<Option<StoredAccessToken>, OAuthError> {
    let Some(text) = credentials.read_mcp_oauth(server, McpOAuthPart::AccessToken)? else { return Ok(None) };
    serde_json::from_str(&text).map(Some).map_err(|_| OAuthError::Storage("unreadable access token".into()))
}

/// Stores a token answer. A refresh answer without a new refresh token keeps the old one.
pub fn save_tokens(
    credentials: &CredentialStore,
    server: &str,
    tokens: &TokenResponse,
) -> Result<StoredAccessToken, OAuthError> {
    let expires_in = tokens.expires_in.and_then(|seconds| i64::try_from(seconds).ok());
    let access = StoredAccessToken {
        token: tokens.access_token.clone(),
        expires_at: expires_in.map(|seconds| now_unix().saturating_add(seconds)),
    };
    let text = serde_json::to_string(&access).map_err(|error| OAuthError::Storage(error.to_string()))?;
    // The rotated refresh token first: losing it would force a new sign-in, losing
    // the access token only costs one more refresh.
    if let Some(refresh_token) = &tokens.refresh_token {
        credentials.set_mcp_oauth(server, McpOAuthPart::RefreshToken, refresh_token)?;
    }
    credentials.set_mcp_oauth(server, McpOAuthPart::AccessToken, &text)?;
    Ok(access)
}

/// Removes the tokens and records why the user has to sign in again. The
/// session stays, so the client registration is reused.
pub fn mark_needs_sign_in(credentials: &CredentialStore, server: &str, reason: &str) -> Result<(), OAuthError> {
    credentials.delete_mcp_oauth(server, McpOAuthPart::AccessToken)?;
    credentials.delete_mcp_oauth(server, McpOAuthPart::RefreshToken)?;
    if let Some(mut session) = load_session(credentials, server)? {
        session.needs_sign_in = Some(reason.to_owned());
        save_session(credentials, server, &session)?;
    }
    Ok(())
}

pub fn delete_all(credentials: &CredentialStore, server: &str) -> Result<(), OAuthError> {
    for part in McpOAuthPart::ALL {
        credentials.delete_mcp_oauth(server, part)?;
    }
    Ok(())
}
