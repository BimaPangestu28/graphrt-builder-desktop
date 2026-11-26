//! Requests to the MCP server (the unauthenticated probe) and to its
//! authorization server (registration, tokens, revocation).

use std::time::Duration;

use serde::Deserialize;
use url::Url;

use super::metadata::{challenge_parameter, resource_metadata_parameter, Discovery, Probe};
use super::pkce::Verifier;
use super::{OAuthError, CLIENT_NAME};

/// Timeout of each request to a sign-in server.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// Largest response body read from a sign-in server.
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// The HTTP client of the sign-in requests. It never follows redirects (a
/// token or code is never replayed to another address).
#[derive(Clone)]
pub struct OAuthHttp {
    client: reqwest::Client,
}

impl OAuthHttp {
    /// # Errors
    /// `Network` when the HTTP client cannot be built.
    pub fn new() -> Result<Self, OAuthError> {
        let _already_installed = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| OAuthError::Network(error.to_string()))?;
        Ok(Self { client })
    }

    /// Sends an MCP `initialize` request without a token and reads the answer.
    pub(super) async fn probe_challenge(&self, server_url: &str) -> Result<Probe, OAuthError> {
        let initialize = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION")}
            }
        });
        let response = self
            .client
            .post(server_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json, text/event-stream")
            .body(initialize.to_string())
            .send()
            .await
            .map_err(network_error)?;
        if response.status().is_redirection() {
            return Ok(Probe::Redirect { status: response.status().as_u16() });
        }
        if response.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(Probe::NoSignInNeeded);
        }
        let challenges: Vec<&str> = response
            .headers()
            .get_all(reqwest::header::WWW_AUTHENTICATE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect();
        let resource_metadata = challenges.iter().copied().find_map(resource_metadata_parameter);
        let scope = challenges.iter().find_map(|header| challenge_parameter(header, "scope"));
        Ok(Probe::Challenge { resource_metadata, scope })
    }

    /// `Ok(None)` for a non-200 answer.
    pub(super) async fn get_json<T: for<'de> Deserialize<'de>>(&self, url: &str) -> Result<Option<T>, OAuthError> {
        let response = self
            .client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(network_error)?;
        if response.status() != reqwest::StatusCode::OK {
            return Ok(None);
        }
        let body = read_limited(response).await?;
        serde_json::from_slice(&body).map(Some).map_err(|error| OAuthError::Discovery(error.to_string()))
    }

    async fn post_form(
        &self,
        url: &str,
        fields: &[(&str, &str)],
    ) -> Result<(reqwest::StatusCode, Vec<u8>), OAuthError> {
        let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(fields).finish();
        let response = self
            .client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(reqwest::header::ACCEPT, "application/json")
            .body(body)
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        Ok((status, read_limited(response).await?))
    }
}

/// Never includes the URL's query (where a code could be).
fn network_error(error: reqwest::Error) -> OAuthError {
    OAuthError::Network(error.without_url().to_string())
}

async fn read_limited(mut response: reqwest::Response) -> Result<Vec<u8>, OAuthError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(OAuthError::Network("the sign-in server sent a response that is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// A client registered with Dynamic Client Registration.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ClientRegistration {
    pub client_id: String,
}

/// Registers the app as a public native client with `redirect_uri` (RFC 7591).
///
/// # Errors
/// `Registration` when the server refuses or answers without a `client_id`.
pub async fn register_client(
    http: &OAuthHttp,
    endpoint: &str,
    redirect_uri: &str,
) -> Result<ClientRegistration, OAuthError> {
    let request = serde_json::json!({
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native"
    });
    let response = http
        .client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .body(request.to_string())
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    let body = read_limited(response).await?;
    if !status.is_success() {
        return Err(OAuthError::Registration(format!("HTTP {}: {}", status.as_u16(), error_summary(&body))));
    }
    let registration: ClientRegistration =
        serde_json::from_slice(&body).map_err(|_| OAuthError::Registration("the answer has no client_id".into()))?;
    if registration.client_id.trim().is_empty() {
        return Err(OAuthError::Registration("the answer has an empty client_id".into()));
    }
    Ok(registration)
}

/// The URL that starts the sign-in in the browser (authorization code + PKCE S256).
///
/// # Errors
/// `Discovery` when the authorization endpoint is not a valid URL.
pub fn authorization_url(
    discovery: &Discovery,
    client_id: &str,
    redirect_uri: &str,
    verifier: &Verifier,
    state: &str,
) -> Result<String, OAuthError> {
    let mut url = Url::parse(&discovery.authorization_endpoint)
        .map_err(|_| OAuthError::Discovery("the authorization endpoint is not a valid address".into()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("code_challenge", &verifier.challenge())
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state)
            .append_pair("resource", &discovery.resource);
        if let Some(scope) = &discovery.scope {
            query.append_pair("scope", scope);
        }
    }
    Ok(url.into())
}

/// The grant of a token request.
pub enum TokenGrant<'a> {
    AuthorizationCode { code: &'a str, redirect_uri: &'a str, verifier: &'a Verifier },
    RefreshToken { refresh_token: &'a str },
}

/// A token endpoint answer.
#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

impl std::fmt::Debug for TokenResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TokenResponse")
            .field("expires_in", &self.expires_in)
            .field("has_refresh_token", &self.refresh_token.is_some())
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct TokenErrorResponse {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

/// Exchanges a code or a refresh token for tokens.
///
/// # Errors
/// `SignInRequired` when a refresh token is rejected (`invalid_grant`),
/// `Token` for other refusals, `Network` when the server cannot be reached.
pub async fn request_tokens(
    http: &OAuthHttp,
    token_endpoint: &str,
    client_id: &str,
    resource: &str,
    grant: TokenGrant<'_>,
) -> Result<TokenResponse, OAuthError> {
    let is_refresh = matches!(grant, TokenGrant::RefreshToken { .. });
    let verifier_text;
    let fields: Vec<(&str, &str)> = match &grant {
        TokenGrant::AuthorizationCode { code, redirect_uri, verifier } => {
            verifier_text = verifier.secret().to_owned();
            vec![
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("code_verifier", verifier_text.as_str()),
                ("client_id", client_id),
                ("resource", resource),
            ]
        }
        TokenGrant::RefreshToken { refresh_token } => vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
            ("resource", resource),
        ],
    };
    let (status, body) = http.post_form(token_endpoint, &fields).await?;
    if status.is_success() {
        let tokens: TokenResponse =
            serde_json::from_slice(&body).map_err(|_| OAuthError::Token("the answer has no access_token".into()))?;
        if tokens.access_token.trim().is_empty() {
            return Err(OAuthError::Token("the answer has an empty access_token".into()));
        }
        if let Some(kind) = &tokens.token_type {
            if !kind.eq_ignore_ascii_case("bearer") {
                return Err(OAuthError::Token(format!("unsupported token type `{kind}`")));
            }
        }
        return Ok(tokens);
    }
    let summary = error_summary(&body);
    let rejected_grant = serde_json::from_slice::<TokenErrorResponse>(&body)
        .is_ok_and(|error| error.error == "invalid_grant" || error.error == "invalid_client");
    if is_refresh && (rejected_grant || status == reqwest::StatusCode::UNAUTHORIZED) {
        return Err(OAuthError::SignInRequired(format!("the sign-in expired or was revoked ({summary})")));
    }
    if status.is_server_error() {
        return Err(OAuthError::Network(format!("HTTP {}: {summary}", status.as_u16())));
    }
    Err(OAuthError::Token(format!("HTTP {}: {summary}", status.as_u16())))
}

/// Revokes `token` (RFC 7009).
///
/// # Errors
/// `Token` or `Network` when the server does not confirm the revocation.
pub async fn revoke(
    http: &OAuthHttp,
    endpoint: &str,
    client_id: &str,
    token: &str,
    token_type_hint: &str,
) -> Result<(), OAuthError> {
    let fields = [("token", token), ("token_type_hint", token_type_hint), ("client_id", client_id)];
    let (status, body) = http.post_form(endpoint, &fields).await?;
    if status.is_success() {
        Ok(())
    } else {
        Err(OAuthError::Token(format!("HTTP {}: {}", status.as_u16(), error_summary(&body))))
    }
}

/// `error: description` of an OAuth error body, or a short excerpt (never a token:
/// error bodies do not carry one).
fn error_summary(body: &[u8]) -> String {
    if let Ok(error) = serde_json::from_slice::<TokenErrorResponse>(body) {
        return match error.error_description {
            Some(description) => format!("{}: {}", error.error, description),
            None => error.error,
        };
    }
    let text = String::from_utf8_lossy(body);
    let excerpt: String = text.chars().take(200).collect();
    if excerpt.trim().is_empty() {
        "no details".to_owned()
    } else {
        excerpt.trim().to_owned()
    }
}
