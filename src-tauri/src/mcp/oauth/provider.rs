//! [`OAuthTokenProvider`]: the access token of a signed-in server for a run.

use std::collections::HashMap;
use std::sync::Arc;

use futures::future::BoxFuture;
use graphrt_mcp::{TokenError, TokenProvider};
use tokio::sync::Mutex;

use super::client::{self, OAuthHttp, TokenGrant};
use super::store::{self, now_unix, StoredAccessToken};
use super::OAuthError;
use crate::credentials::{CredentialStore, McpOAuthPart};

/// One refresh per server at a time across the whole app: two runs of the same
/// server must not both spend a rotating refresh token (the second would be
/// refused and wrongly ask the user to sign in again).
static REFRESH_LOCKS: std::sync::Mutex<Option<HashMap<String, Arc<Mutex<()>>>>> = std::sync::Mutex::new(None);

pub(super) fn refresh_lock(server: &str) -> Arc<Mutex<()>> {
    let mut slot = match REFRESH_LOCKS.lock() {
        Ok(slot) => slot,
        Err(poisoned) => poisoned.into_inner(),
    };
    slot.get_or_insert_with(HashMap::new).entry(server.to_owned()).or_default().clone()
}

/// Hands out the stored access token, refreshing it when it is about to
/// expire, and once after the server rejected it. One refresh runs at a time,
/// so concurrent calls of a run share it. A rejected refresh token marks the
/// server "sign in again" ([`store::mark_needs_sign_in`]).
pub struct OAuthTokenProvider {
    credentials: Arc<CredentialStore>,
    server: String,
    http: OAuthHttp,
    /// The token last handed out (the credential store is read on first use).
    current: Mutex<Option<StoredAccessToken>>,
}

impl OAuthTokenProvider {
    pub fn new(credentials: Arc<CredentialStore>, server: String, http: OAuthHttp) -> Self {
        Self { credentials, server, http, current: Mutex::new(None) }
    }

    async fn token(&self) -> Result<String, OAuthError> {
        let mut current = self.current.lock().await;
        if current.is_none() {
            *current = store::load_access_token(&self.credentials, &self.server)?;
        }
        match current.as_ref() {
            Some(token) if !token.is_expiring(now_unix()) => Ok(token.token.clone()),
            stale => {
                let stale = stale.map(|token| token.token.clone());
                let fresh = self.refresh_locked(stale.as_deref()).await?;
                let token = fresh.token.clone();
                *current = Some(fresh);
                Ok(token)
            }
        }
    }

    async fn refresh_after_rejection(&self, rejected: String) -> Result<String, OAuthError> {
        let mut current = self.current.lock().await;
        // Another call already replaced the rejected token.
        if let Some(token) = current.as_ref().filter(|token| token.token != rejected) {
            return Ok(token.token.clone());
        }
        let fresh = self.refresh_locked(Some(&rejected)).await?;
        let token = fresh.token.clone();
        *current = Some(fresh);
        Ok(token)
    }

    /// Uses the refresh token (the caller holds `current`), unless another run
    /// stored a usable token other than `stale` meanwhile.
    async fn refresh_locked(&self, stale: Option<&str>) -> Result<StoredAccessToken, OAuthError> {
        let server_lock = refresh_lock(&self.server);
        let _one_refresh_at_a_time = server_lock.lock().await;
        if let Some(stored) = store::load_access_token(&self.credentials, &self.server)? {
            if Some(stored.token.as_str()) != stale && !stored.is_expiring(now_unix()) {
                return Ok(stored);
            }
        }
        let session = store::load_session(&self.credentials, &self.server)?
            .ok_or_else(|| OAuthError::SignInRequired("not signed in".into()))?;
        if let Some(reason) = &session.needs_sign_in {
            return Err(OAuthError::SignInRequired(reason.clone()));
        }
        let Some(refresh_token) = self.credentials.read_mcp_oauth(&self.server, McpOAuthPart::RefreshToken)? else {
            let reason = "the access token expired and the server gave no refresh token";
            store::mark_needs_sign_in(&self.credentials, &self.server, reason)?;
            return Err(OAuthError::SignInRequired(reason.into()));
        };
        let grant = TokenGrant::RefreshToken { refresh_token: &refresh_token };
        match client::request_tokens(&self.http, &session.token_endpoint, &session.client_id, &session.resource, grant)
            .await
        {
            Ok(tokens) => store::save_tokens(&self.credentials, &self.server, &tokens),
            Err(OAuthError::SignInRequired(reason)) => {
                store::mark_needs_sign_in(&self.credentials, &self.server, &reason)?;
                Err(OAuthError::SignInRequired(reason))
            }
            Err(other) => Err(other),
        }
    }
}

fn token_error(server: &str, error: OAuthError) -> TokenError {
    match error {
        OAuthError::SignInRequired(reason) => TokenError::SignInRequired(format!(
            "{reason}. Sign in to MCP server `{server}` again in Connections > MCP servers"
        )),
        other => TokenError::Unavailable(other.to_string()),
    }
}

impl TokenProvider for OAuthTokenProvider {
    fn access_token(&self) -> BoxFuture<'_, Result<String, TokenError>> {
        Box::pin(async move { self.token().await.map_err(|error| token_error(&self.server, error)) })
    }

    fn refresh(&self, rejected: String) -> BoxFuture<'_, Result<String, TokenError>> {
        Box::pin(async move {
            self.refresh_after_rejection(rejected).await.map_err(|error| token_error(&self.server, error))
        })
    }
}
