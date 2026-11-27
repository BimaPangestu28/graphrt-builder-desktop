//! Signing in to Google Drive or SharePoint / OneDrive for a knowledge source:
//! the authorization code flow with PKCE and a loopback redirect (RFC 8252),
//! reusing the listener and PKCE helpers of the MCP sign-in. Only read only
//! scopes are asked for. The refresh token is kept in memory until the source
//! is added (then it moves to the keychain); nothing reaches the webview.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::connectors::{remember_sign_in, OAuthProvider, PendingSignIn};
use crate::error::{AppError, AppResult};
use crate::mcp::oauth::loopback::CallbackListener;
use crate::mcp::oauth::pkce::{random_state, Verifier};
use crate::mcp::oauth::OAuthError;

/// How long the app waits for the user to finish signing in in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// The client the sign-in uses: built into the app, or given by the user (an
/// app registration of their own organization).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientChoice {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
}

/// What the UI gets back: an id to attach the sign-in to a new source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResult {
    pub sign_in_id: String,
    pub account_label: Option<String>,
}

/// Whether a provider can be signed in to without the user giving a client id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetup {
    pub provider: OAuthProvider,
    pub has_built_in_client: bool,
    /// The redirect address to register for an own client.
    pub redirect_uri: &'static str,
    pub scopes: &'static str,
}

pub fn provider_setup(provider: OAuthProvider) -> ProviderSetup {
    ProviderSetup {
        provider,
        has_built_in_client: provider.built_in_client().is_some(),
        redirect_uri: "http://127.0.0.1",
        scopes: provider.scopes(),
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    let _already_installed = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Internal(format!("could not set up the sign-in: {error}")))
}

fn oauth_error(error: OAuthError) -> AppError {
    match error {
        OAuthError::TimedOut | OAuthError::Cancelled | OAuthError::Authorization(_) => {
            AppError::InvalidInput(error.to_string())
        }
        other => AppError::Internal(other.to_string()),
    }
}

/// The browser address that starts the sign-in.
///
/// # Errors
/// `Internal` when the provider's endpoint is not a valid address (it is a constant).
pub fn authorization_url(
    provider: OAuthProvider,
    client_id: &str,
    redirect_uri: &str,
    verifier: &Verifier,
    state: &str,
) -> AppResult<String> {
    let mut url = url::Url::parse(provider.authorize_url())
        .map_err(|_| AppError::Internal("the sign-in address is not valid".into()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("scope", provider.scopes())
            .append_pair("code_challenge", &verifier.challenge())
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state);
        if provider == OAuthProvider::Google {
            // A refresh token is only issued for offline access, and again only with consent.
            query.append_pair("access_type", "offline").append_pair("prompt", "consent");
        } else {
            query.append_pair("prompt", "select_account");
        }
    }
    Ok(url.into())
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Exchanges the authorization code for tokens.
async fn exchange_code(
    http: &reqwest::Client,
    token_url: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    redirect_uri: &str,
    verifier: &Verifier,
) -> AppResult<TokenAnswer> {
    let body = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("client_id", client_id)
            .append_pair("code_verifier", verifier.secret());
        if let Some(secret) = client_secret {
            form.append_pair("client_secret", secret);
        }
        form.finish()
    };
    let response = http
        .post(token_url)
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(reqwest::header::ACCEPT, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("could not reach the sign-in server: {}", error.without_url())))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Internal(format!("the sign-in answer broke off: {}", error.without_url())))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::Internal("the sign-in server answered with too much data".into()));
    }
    if !status.is_success() {
        let reason: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        let code = reason.get("error").and_then(serde_json::Value::as_str).unwrap_or("refused");
        return Err(AppError::InvalidInput(format!("the sign-in was refused ({code}); check the app registration")));
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::Internal("the sign-in server answered without tokens".into()))
}

/// The signed in account, for "Signed in as ...". Best effort.
async fn account_label(http: &reqwest::Client, provider: OAuthProvider, access_token: &str) -> Option<String> {
    let (url, pointer) = match provider {
        OAuthProvider::Google => {
            ("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", "/user/emailAddress")
        }
        OAuthProvider::Microsoft => {
            ("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName", "/userPrincipalName")
        }
    };
    let response = http.get(url).bearer_auth(access_token).send().await.ok()?;
    let json: serde_json::Value = response.json().await.ok()?;
    json.pointer(pointer).and_then(serde_json::Value::as_str).map(str::to_owned)
}

/// Runs a sign-in: opens the browser, waits for the callback (at most
/// `timeout`), exchanges the code. Returns the id the new source attaches.
///
/// # Errors
/// `InvalidInput` when no client id is available, the user cancelled or the
/// sign-in was refused; `Internal` for network trouble.
pub async fn sign_in(
    provider: OAuthProvider,
    choice: ClientChoice,
    open_browser: &(dyn Fn(&str) -> Result<(), String> + Send + Sync),
    timeout: Duration,
) -> AppResult<SignInResult> {
    let own_id = choice.client_id.map(|id| id.trim().to_owned()).filter(|id| !id.is_empty());
    let own_secret = choice.client_secret.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
    let (client_id, client_secret) =
        match (own_id, provider.built_in_client()) {
            (Some(id), _) => (id, own_secret),
            (None, Some((id, secret))) => (id.to_owned(), secret.map(str::to_owned)),
            (None, None) => return Err(AppError::InvalidInput(
                "this app has no sign-in registration for this service yet; enter the client id of your organization"
                    .into(),
            )),
        };
    let listener = CallbackListener::bind(None).await.map_err(oauth_error)?;
    let redirect_uri = listener.redirect_uri();
    let verifier = Verifier::generate().map_err(oauth_error)?;
    let state = random_state().map_err(oauth_error)?;
    let url = authorization_url(provider, &client_id, &redirect_uri, &verifier, &state)?;
    open_browser(&url).map_err(|error| AppError::Internal(format!("could not open the browser: {error}")))?;
    let code = tokio::time::timeout(timeout, listener.wait_for_code(&state, provider.issuer()))
        .await
        .map_err(|_| oauth_error(OAuthError::TimedOut))?
        .map_err(oauth_error)?;
    let http = http_client()?;
    let tokens = exchange_code(
        &http,
        provider.token_url(),
        &client_id,
        client_secret.as_deref(),
        &code,
        &redirect_uri,
        &verifier,
    )
    .await?;
    let refresh_token = tokens.refresh_token.filter(|token| !token.is_empty()).ok_or_else(|| {
        AppError::InvalidInput("the service gave no lasting sign-in (refresh token); sign in again".into())
    })?;
    let account_label = account_label(&http, provider, &tokens.access_token).await;
    let sign_in_id = remember_sign_in(PendingSignIn {
        provider,
        client_id,
        client_secret,
        refresh_token,
        account_label: account_label.clone(),
    })?;
    Ok(SignInResult { sign_in_id, account_label })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_urls_ask_for_read_only_offline_access() {
        let verifier = Verifier::from_text("verifier-text-verifier-text-verifier-text-12");
        let google =
            authorization_url(OAuthProvider::Google, "app", "http://127.0.0.1:5000/callback", &verifier, "st").unwrap();
        assert!(google.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(google.contains("drive.readonly") && google.contains("access_type=offline"));
        assert!(google.contains("code_challenge_method=S256") && google.contains("state=st"));
        let microsoft =
            authorization_url(OAuthProvider::Microsoft, "app", "http://127.0.0.1:5000/callback", &verifier, "st")
                .unwrap();
        assert!(microsoft.contains("Files.Read.All") && microsoft.contains("offline_access"));
        assert!(!microsoft.contains("ReadWrite"), "read only");
    }
}
