//! Google Cloud Run as a place to put agents online (`graphrt deploy --target cloud-run --direct`).
//!
//! - Signing in: the OAuth 2.0 flow for installed apps (authorization code with PKCE, loopback
//!   redirect on `127.0.0.1:<free port>`, `access_type=offline` + `prompt=consent`), reusing the
//!   listener and PKCE helpers of the MCP sign-in. Only the refresh token is kept, in the OS
//!   keychain (`account:google_cloud`); access tokens live in memory and are refreshed before
//!   they run out ([`TokenCache`]). Each `graphrt` call gets one in `GOOGLE_OAUTH_ACCESS_TOKEN`.
//! - Picking where: the person's active projects with whether billing is on (Cloud Resource
//!   Manager and Cloud Billing, read only), and a Cloud Run region.
//! - Errors: the CLI's error codes (`api_disabled`, `billing_disabled`, `permission_denied`,
//!   `org_policy`...) become a [`DeployProblem`] with plain words and a fix (a Google Cloud
//!   console page of that project, or signing in again).
//!
//! The OAuth client is the "Graphrt Desktop" Desktop app client of the `graphrt` project. Its
//! id is public; its secret (not a real secret for an installed app, but kept out of the source)
//! comes from `GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET` at build time. Without it, signing in to
//! Google Cloud says it is not available in this build.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::http::{DeployHttp, HttpMethod, HttpRequest};
use super::providers::DeployProvider;
use crate::error::{AppError, AppResult};
use crate::mcp::oauth::loopback::CallbackListener;
use crate::mcp::oauth::pkce::{random_state, Verifier};
use crate::mcp::oauth::OAuthError;

/// The client id of "Graphrt Desktop" (project `graphrt`), unless the build names another one.
pub const CLIENT_ID: &str = match option_env!("GRAPHRT_GOOGLE_CLOUD_CLIENT_ID") {
    Some(id) => id,
    None => "306159752845-1t6dtcnjbml6fl18r1hu618p4e421h9i.apps.googleusercontent.com",
};
/// The client secret, given to the build (CI secret `GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET`).
const CLIENT_SECRET: Option<&str> = option_env!("GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET");

pub const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const ISSUER: &str = "https://accounts.google.com";
/// Deploying needs `cloud-platform`; `openid email` say who signed in.
pub const SCOPES: &str = "https://www.googleapis.com/auth/cloud-platform openid email";
const PROJECTS_URL: &str = "https://cloudresourcemanager.googleapis.com/v1/projects";
const BILLING_URL: &str = "https://cloudbilling.googleapis.com/v1/projects";
/// The environment variable the access token goes in.
pub const ACCESS_TOKEN_ENV: &str = "GOOGLE_OAUTH_ACCESS_TOKEN";
/// How long the app waits for the person to finish signing in in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// An access token is refreshed when less than this is left: a deploy takes at most ~10 minutes.
const TOKEN_MARGIN: Duration = Duration::from_secs(15 * 60);
/// At most this many projects are listed (and asked about billing).
const MAX_PROJECTS: usize = 200;
/// The region a first deploy suggests: Jakarta.
pub const DEFAULT_REGION: &str = "asia-southeast2";

/// Why Google Cloud cannot be signed in to in this build (no client secret was given to it).
pub const SIGN_IN_NOT_AVAILABLE: &str =
    "Signing in to Google Cloud is not available in this build of the app. It comes with an app update.";

/// Whether this build can sign in to Google Cloud.
pub fn sign_in_available() -> bool {
    CLIENT_SECRET.is_some_and(|secret| !secret.trim().is_empty())
}

fn client_secret() -> AppResult<&'static str> {
    CLIENT_SECRET
        .filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| AppError::InvalidInput(SIGN_IN_NOT_AVAILABLE.into()))
}

/// What is kept in the keychain for a Google sign-in (the whole value is the secret).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSignIn {
    /// Always `google_sign_in`, so an older stored credential (a key file) is told apart.
    pub kind: String,
    pub refresh_token: String,
    pub email: Option<String>,
}

const SIGN_IN_KIND: &str = "google_sign_in";

impl GoogleSignIn {
    pub fn new(refresh_token: String, email: Option<String>) -> Self {
        Self { kind: SIGN_IN_KIND.into(), refresh_token, email }
    }

    /// The stored JSON, or `None` for anything else (e.g. a key file connected by an older app).
    pub fn from_stored(stored: &str) -> Option<Self> {
        serde_json::from_str::<Self>(stored).ok().filter(|sign_in| sign_in.kind == SIGN_IN_KIND)
    }

    /// "Signed in as ana@example.com".
    pub fn summary(&self) -> String {
        match &self.email {
            Some(email) => format!("Signed in as {email}"),
            None => "Signed in with Google".into(),
        }
    }
}

/// The browser address that starts the sign-in.
pub fn authorization_url(client_id: &str, redirect_uri: &str, verifier: &Verifier, state: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &verifier.challenge())
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        // A refresh token is only issued for offline access, and again only with consent.
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .finish();
    format!("{AUTHORIZE_URL}?{query}")
}

/// The token endpoint's answer.
#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    /// The scopes granted: Google lets people untick `cloud-platform` on its consent screen.
    #[serde(default)]
    scope: Option<String>,
}

/// The `cloud-platform` scope, which deploying needs.
const CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

/// Whether the granted scopes (space separated) let the app manage Google Cloud. An answer
/// without `scope` grants what was asked.
fn grants_cloud_platform(scope: Option<&str>) -> bool {
    scope.is_none_or(|granted| granted.split_whitespace().any(|scope| scope == CLOUD_PLATFORM_SCOPE))
}

fn form(fields: &[(&str, &str)]) -> Vec<(String, String)> {
    fields.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())).collect()
}

/// Posts a token request. A refused refresh (`invalid_grant`) means signing in again.
async fn token_request(http: &dyn DeployHttp, fields: Vec<(String, String)>) -> AppResult<TokenReply> {
    let reply = http
        .send(HttpRequest {
            method: HttpMethod::Post,
            url: TOKEN_URL.into(),
            bearer: None,
            body: None,
            form: Some(fields),
        })
        .await?;
    if !(200..300).contains(&reply.status) {
        let reason: serde_json::Value = serde_json::from_str(&reply.body).unwrap_or(serde_json::Value::Null);
        let code = reason.get("error").and_then(serde_json::Value::as_str).unwrap_or("refused");
        if code == "invalid_grant" || reply.status == 401 {
            return Err(sign_in_again_error("Google no longer accepts this sign in (it expired or was removed)"));
        }
        return Err(AppError::Internal(format!("Google refused the sign in ({code})")));
    }
    serde_json::from_str(&reply.body)
        .map_err(|_| AppError::Internal("Google answered the sign in without a token".into()))
}

/// The `email` claim of an ID token, read without checking its signature: it comes straight
/// from Google's token endpoint over TLS and is only shown, never trusted for access.
pub fn email_from_id_token(id_token: &str) -> Option<String> {
    use base64::Engine as _;
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email").and_then(serde_json::Value::as_str).map(str::to_owned)
}

fn oauth_error(error: OAuthError) -> AppError {
    match error {
        OAuthError::TimedOut | OAuthError::Cancelled | OAuthError::Authorization(_) => {
            AppError::InvalidInput(error.to_string())
        }
        other => AppError::Internal(other.to_string()),
    }
}

/// Runs the sign-in: opens the browser, waits for the loopback callback (at most `timeout`),
/// exchanges the code. Returns what goes to the keychain and a fresh access token.
///
/// # Errors
/// `InvalidInput` when this build cannot sign in, the person cancelled or Google refused;
/// `Internal` for network trouble.
pub async fn sign_in(
    http: &dyn DeployHttp,
    open_browser: &(dyn Fn(&str) -> Result<(), String> + Send + Sync),
    timeout: Duration,
) -> AppResult<(GoogleSignIn, CachedToken)> {
    let secret = client_secret()?;
    let listener = CallbackListener::bind(None).await.map_err(oauth_error)?;
    let redirect_uri = listener.redirect_uri();
    let verifier = Verifier::generate().map_err(oauth_error)?;
    let state = random_state().map_err(oauth_error)?;
    let url = authorization_url(CLIENT_ID, &redirect_uri, &verifier, &state);
    open_browser(&url).map_err(|error| AppError::Internal(format!("could not open the browser: {error}")))?;
    let code = tokio::time::timeout(timeout, listener.wait_for_code(&state, ISSUER))
        .await
        .map_err(|_| oauth_error(OAuthError::TimedOut))?
        .map_err(oauth_error)?;
    let reply = token_request(
        http,
        form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", CLIENT_ID),
            ("client_secret", secret),
            ("code_verifier", verifier.secret()),
        ]),
    )
    .await?;
    if !grants_cloud_platform(reply.scope.as_deref()) {
        // Nothing is kept: a sign in that may not manage Google Cloud cannot put agents online.
        revoke(http, reply.refresh_token.as_deref().unwrap_or(&reply.access_token)).await;
        return Err(AppError::InvalidInput(
            "Google Cloud access was not allowed. Sign in again and tick the box that lets Graphrt manage your Google Cloud resources".into(),
        ));
    }
    let refresh_token = reply.refresh_token.clone().filter(|token| !token.is_empty()).ok_or_else(|| {
        AppError::InvalidInput("Google gave no lasting sign in. Sign in again and allow every permission asked".into())
    })?;
    let email = reply.id_token.as_deref().and_then(email_from_id_token);
    Ok((GoogleSignIn::new(refresh_token, email), CachedToken::from_reply(&reply)))
}

/// Forgets the sign-in at Google too (best effort: the keychain entry goes either way).
pub async fn revoke(http: &dyn DeployHttp, refresh_token: &str) {
    let request = HttpRequest {
        method: HttpMethod::Post,
        url: REVOKE_URL.into(),
        bearer: None,
        body: None,
        form: Some(form(&[("token", refresh_token)])),
    };
    match http.send(request).await {
        Ok(reply) if (200..300).contains(&reply.status) => {}
        Ok(reply) => log::info!("Google did not revoke the sign in (HTTP {})", reply.status),
        Err(error) => log::info!("could not revoke the Google sign in: {error}"),
    }
}

/// An access token and when it runs out.
#[derive(Clone)]
pub struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

impl std::fmt::Debug for CachedToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("CachedToken").field("expires_at", &self.expires_at).finish_non_exhaustive()
    }
}

impl CachedToken {
    fn from_reply(reply: &TokenReply) -> Self {
        Self {
            access_token: reply.access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(reply.expires_in.unwrap_or(3600)),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(access_token: &str, lasts: Duration) -> Self {
        Self { access_token: access_token.into(), expires_at: Instant::now() + lasts }
    }

    fn is_fresh(&self) -> bool {
        self.expires_at.saturating_duration_since(Instant::now()) > TOKEN_MARGIN
    }
}

/// The access token of the signed-in account, refreshed when it is about to run out. One per
/// app; a sign-in or sign-out replaces or clears it.
#[derive(Debug, Default)]
pub struct TokenCache {
    token: tokio::sync::Mutex<Option<CachedToken>>,
}

impl TokenCache {
    pub async fn set(&self, token: Option<CachedToken>) {
        *self.token.lock().await = token;
    }

    /// A token with at least [`TOKEN_MARGIN`] left, refreshing with `sign_in` when needed.
    ///
    /// # Errors
    /// A [`DeployProblem`] asking to sign in again when Google refuses the refresh token.
    pub async fn access_token(&self, http: &dyn DeployHttp, sign_in: &GoogleSignIn) -> AppResult<String> {
        let mut cached = self.token.lock().await;
        if let Some(token) = cached.as_ref().filter(|token| token.is_fresh()) {
            return Ok(token.access_token.clone());
        }
        let secret = client_secret()?;
        let reply = token_request(
            http,
            form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", &sign_in.refresh_token),
                ("client_id", CLIENT_ID),
                ("client_secret", secret),
            ]),
        )
        .await;
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                *cached = None;
                return Err(error);
            }
        };
        let token = CachedToken::from_reply(&reply);
        let access_token = token.access_token.clone();
        *cached = Some(token);
        Ok(access_token)
    }
}

// ---- projects and regions ----

/// Whether billing is on for a project (`unknown` when the account may not read it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingState {
    Enabled,
    Disabled,
    Unknown,
}

/// One project of the signed-in account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleProject {
    pub id: String,
    pub name: String,
    pub billing: BillingState,
}

/// Where an agent runs on Google Cloud: a project and a Cloud Run region.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPlace {
    pub project: String,
    pub region: String,
}

impl CloudPlace {
    /// The place with both parts checked.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence.
    pub fn checked(&self) -> AppResult<Self> {
        let project = self.project.trim();
        let region = self.region.trim();
        if !is_project_id(project) {
            return Err(AppError::InvalidInput("Pick a Google Cloud project first".into()));
        }
        if !is_region(region) {
            return Err(AppError::InvalidInput(format!(
                "`{region}` is not a Google Cloud region such as {DEFAULT_REGION}"
            )));
        }
        Ok(Self { project: project.to_owned(), region: region.to_owned() })
    }
}

/// A project id: 6 to 30 lowercase letters, digits and dashes, starting with a letter. Older
/// projects may be `domain.com:name`.
pub fn is_project_id(id: &str) -> bool {
    let name = id.rsplit_once(':').map_or(id, |(domain, name)| {
        if domain.is_empty()
            || !domain.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
        {
            ""
        } else {
            name
        }
    });
    (6..=30).contains(&name.len())
        && name.starts_with(|character: char| character.is_ascii_lowercase())
        && !name.ends_with('-')
        && name.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// A region code such as `asia-southeast2` or `us-central1`.
pub fn is_region(region: &str) -> bool {
    let mut parts = region.split('-');
    let (Some(area), Some(place), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    let digits = place.trim_start_matches(|character: char| character.is_ascii_lowercase());
    !area.is_empty()
        && area.bytes().all(|byte| byte.is_ascii_lowercase())
        && digits.len() < place.len()
        && (1..=2).contains(&digits.len())
        && digits.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectsPage {
    #[serde(default)]
    projects: Vec<ProjectEntry>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEntry {
    project_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    lifecycle_state: Option<String>,
}

/// One page of the account's active projects.
fn projects_page_url(page_token: Option<&str>) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("filter", "lifecycleState:ACTIVE").append_pair("pageSize", "100");
    if let Some(token) = page_token {
        query.append_pair("pageToken", token);
    }
    format!("{PROJECTS_URL}?{}", query.finish())
}

/// The account's active projects, billing first, then by name.
///
/// # Errors
/// A [`DeployProblem`] asking to sign in again on 401; `Internal` when Google cannot be read.
pub async fn list_projects(http: &dyn DeployHttp, access_token: &str) -> AppResult<Vec<GoogleProject>> {
    let mut entries = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let reply = http.get(projects_page_url(page_token.as_deref()), Some(access_token.to_owned())).await?;
        match reply.status {
            200..=299 => {}
            401 => return Err(sign_in_again_error("Google no longer accepts this sign in")),
            status => {
                return Err(AppError::Internal(format!(
                    "Google Cloud did not list your projects (HTTP {status}): {}",
                    google_message(&reply.body)
                )))
            }
        }
        let page: ProjectsPage = serde_json::from_str(&reply.body)
            .map_err(|_| AppError::Internal("Google Cloud answered with a list this app cannot read".into()))?;
        entries.extend(page.projects.into_iter().filter(|entry| {
            entry.lifecycle_state.as_deref().is_none_or(|state| state == "ACTIVE") && is_project_id(&entry.project_id)
        }));
        page_token = page.next_page_token.filter(|token| !token.is_empty());
        if page_token.is_none() || entries.len() >= MAX_PROJECTS {
            break;
        }
    }
    entries.truncate(MAX_PROJECTS);
    let billing =
        futures::future::join_all(entries.iter().map(|entry| billing_state(http, access_token, &entry.project_id)))
            .await;
    let mut projects: Vec<GoogleProject> = entries
        .into_iter()
        .zip(billing)
        .map(|(entry, billing)| GoogleProject {
            name: entry.name.filter(|name| !name.trim().is_empty()).unwrap_or_else(|| entry.project_id.clone()),
            id: entry.project_id,
            billing,
        })
        .collect();
    projects.sort_by(|left, right| {
        (left.billing != BillingState::Enabled, left.name.to_lowercase())
            .cmp(&(right.billing != BillingState::Enabled, right.name.to_lowercase()))
    });
    Ok(projects)
}

async fn billing_state(http: &dyn DeployHttp, access_token: &str, project: &str) -> BillingState {
    let url = format!("{BILLING_URL}/{project}/billingInfo");
    match http.get(url, Some(access_token.to_owned())).await {
        Ok(reply) if (200..300).contains(&reply.status) => {
            let info: serde_json::Value = serde_json::from_str(&reply.body).unwrap_or(serde_json::Value::Null);
            if info.get("billingEnabled").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                BillingState::Enabled
            } else {
                BillingState::Disabled
            }
        }
        Ok(_) | Err(_) => BillingState::Unknown,
    }
}

/// `error.message` of a Google API error body, or a short excerpt.
fn google_message(body: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    parsed
        .pointer("/error/message")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| body.chars().take(200).collect())
}

// ---- console pages ----

/// Google Cloud console pages the screens link to for a project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsolePage {
    /// Link a billing account to the project.
    Billing,
    /// Who may do what in the project.
    Permissions,
    /// The organization policies that apply to the project.
    OrgPolicies,
    /// Create a new project.
    CreateProject,
    /// Cloud Run's prices.
    Pricing,
}

/// The console address of `page` for `project` (checked, so nothing can be slipped in).
///
/// # Errors
/// `InvalidInput` for a project that is not a project id.
pub fn console_url(page: ConsolePage, project: Option<&str>) -> AppResult<String> {
    let project = match project.map(str::trim).filter(|project| !project.is_empty()) {
        Some(project) if is_project_id(project) => Some(project),
        Some(_) => return Err(AppError::InvalidInput("this is not a Google Cloud project id".into())),
        None => None,
    };
    let with_project = |base: &str| match project {
        Some(project) => format!("{base}?project={project}"),
        None => base.to_owned(),
    };
    Ok(match page {
        ConsolePage::Billing => with_project("https://console.cloud.google.com/billing/linkedaccount"),
        ConsolePage::Permissions => with_project("https://console.cloud.google.com/iam-admin/iam"),
        ConsolePage::OrgPolicies => with_project("https://console.cloud.google.com/iam-admin/orgpolicies"),
        ConsolePage::CreateProject => "https://console.cloud.google.com/projectcreate".to_owned(),
        ConsolePage::Pricing => "https://cloud.google.com/run/pricing".to_owned(),
    })
}

/// Whether the app may open `url` as the fix of a deploy problem: Google Cloud's console only.
pub fn is_fix_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|parsed| {
        parsed.scheme() == "https"
            && matches!(
                parsed.host_str(),
                Some("console.cloud.google.com" | "cloud.google.com" | "console.aws.amazon.com" | "aws.amazon.com")
            )
            && parsed.username().is_empty()
    })
}

// ---- problems ----

/// What the person can do about a problem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeployFix {
    /// Open this page (Google Cloud console) and fix it there, then try again.
    OpenPage { url: String },
    /// Sign in to the provider again (the sign in expired or was removed).
    SignInAgain,
    /// Connect the provider's account again (its key was refused).
    ConnectAgain { provider: DeployProvider },
}

/// A refusal of the provider, explained: what went wrong in plain words, the CLI's own message
/// for Details, and a fix. Sent to the screens as `AppError::DeployFailed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployProblem {
    pub provider: DeployProvider,
    /// The CLI's error code, e.g. `billing_disabled` (the screens word known ones themselves).
    pub kind: String,
    /// Plain English.
    pub message: String,
    /// The CLI's message (Details).
    pub technical: String,
    pub project: Option<String>,
    /// The Google API that is off (`api_disabled`), e.g. `run.googleapis.com`.
    pub service: Option<String>,
    /// The role to ask for (`permission_denied`), e.g. `roles/run.admin`.
    pub role: Option<String>,
    pub fix: Option<DeployFix>,
}

/// The "sign in again" problem.
pub fn sign_in_again_error(technical: &str) -> AppError {
    AppError::DeployFailed(Box::new(DeployProblem {
        provider: DeployProvider::GoogleCloud,
        kind: "unauthorized".into(),
        message: "Your Google sign in expired or was removed. Sign in with Google again, then try again".into(),
        technical: technical.to_owned(),
        project: None,
        service: None,
        role: None,
        fix: Some(DeployFix::SignInAgain),
    }))
}

/// The first `<name>.googleapis.com` in `text`.
fn api_service(text: &str) -> Option<String> {
    text.split(|character: char| !(character.is_ascii_alphanumeric() || character == '.' || character == '-'))
        .find(|word| word.ends_with(".googleapis.com") && word.len() > ".googleapis.com".len())
        .map(str::to_owned)
}

/// The first `roles/<name>` in `text`.
fn role_name(text: &str) -> Option<String> {
    let start = text.find("roles/")?;
    let role: String = text[start..]
        .chars()
        .take_while(|character| character.is_ascii_alphanumeric() || "/._".contains(*character))
        .collect();
    (role.len() > "roles/".len()).then(|| role.trim_end_matches('.').to_owned())
}

/// The CLI's refusal (`code`, `message`) as a [`DeployProblem`] for `place`.
pub fn problem_for(code: Option<&str>, message: &str, place: Option<&CloudPlace>) -> DeployProblem {
    let project = place.map(|place| place.project.clone());
    let project_name = project.clone().unwrap_or_else(|| "your project".into());
    let page = |page: ConsolePage| console_url(page, project.as_deref()).ok().map(|url| DeployFix::OpenPage { url });
    let kind = code.unwrap_or("error").to_owned();
    let mut service = None;
    let mut role = None;
    let (plain, fix) = match kind.as_str() {
        "api_disabled" => {
            service = api_service(message);
            let named = service.clone().unwrap_or_else(|| "a Google Cloud service".into());
            let url = match &service {
                Some(name) => format!("https://console.cloud.google.com/apis/library/{name}?project={project_name}"),
                None => format!("https://console.cloud.google.com/apis/dashboard?project={project_name}"),
            };
            (
                format!("{named} is turned off in project {project_name}. Turn it on, wait a minute, then try again"),
                project.as_ref().map(|_| DeployFix::OpenPage { url }),
            )
        }
        "billing_disabled" => (
            format!("Project {project_name} has no billing account. Link one (Google asks for a card), then try again"),
            page(ConsolePage::Billing),
        ),
        "permission_denied" => {
            role = role_name(message);
            let ask = role.as_deref().map_or_else(|| "Owner".to_owned(), |role| format!("{role} (or Owner)"));
            (
                format!("Your Google account may not do this in project {project_name}. Ask the project's owner to give you the role {ask}, then try again"),
                page(ConsolePage::Permissions),
            )
        }
        "org_policy" => (
            format!("A rule of your Google Cloud organization forbids this in project {project_name}. Ask your organization's administrator to allow it, or pick a project outside the organization"),
            page(ConsolePage::OrgPolicies),
        ),
        "unauthorized" | "missing_credentials" => (
            "Your Google sign in expired or was removed. Sign in with Google again, then try again".to_owned(),
            Some(DeployFix::SignInAgain),
        ),
        "not_found" if message.to_ascii_lowercase().contains("image") => {
            return DeployProblem {
                provider: DeployProvider::GoogleCloud,
                kind: "image_not_found".into(),
                message: "The server image was not found, so the earlier version keeps answering. Leave Server image (Advanced) empty to use graphrt's own image, or name one that exists".into(),
                technical: message.to_owned(),
                project,
                service: None,
                role: None,
                fix: None,
            }
        }
        "name_taken" => (
            "Another Google Cloud account already uses this agent's name. Rename the agent, then try again".to_owned(),
            None,
        ),
        "rate_limited" => ("Google Cloud is busy for this project right now (a limit was reached). Try again later".to_owned(), None),
        "gcp_unavailable" => ("Google Cloud could not be reached. Check the internet connection and try again in a minute".to_owned(), None),
        "health_check_failed" | "start_timeout" => (
            "The new version did not start, so the earlier one keeps answering. See Details for why".to_owned(),
            None,
        ),
        _ => (message.to_owned(), None),
    };
    DeployProblem {
        provider: DeployProvider::GoogleCloud,
        kind,
        message: plain,
        technical: message.to_owned(),
        project,
        service,
        role,
        fix,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deploy::http::tests::FakeHttp;

    #[test]
    fn the_sign_in_address_asks_for_offline_cloud_access_with_pkce() {
        let verifier = Verifier::from_text("verifier-text-verifier-text-verifier-text-12");
        let url = authorization_url("app-id", "http://127.0.0.1:5000/callback", &verifier, "st");
        let parsed = url::Url::parse(&url).unwrap();
        let query: std::collections::HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        assert!(url.starts_with(AUTHORIZE_URL));
        assert_eq!(query["scope"], "https://www.googleapis.com/auth/cloud-platform openid email");
        assert_eq!(query["access_type"], "offline");
        assert_eq!(query["prompt"], "consent");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["code_challenge"], verifier.challenge());
        assert_eq!(query["redirect_uri"], "http://127.0.0.1:5000/callback");
        assert!(!url.contains("client_secret"));
    }

    #[test]
    fn a_sign_in_must_grant_google_cloud() {
        assert!(grants_cloud_platform(Some("openid https://www.googleapis.com/auth/cloud-platform email")));
        assert!(!grants_cloud_platform(Some("openid https://www.googleapis.com/auth/userinfo.email")));
        assert!(grants_cloud_platform(None));
        let image = problem_for(Some("not_found"), "Image 'x' not found. Pass --image", None);
        assert_eq!(image.kind, "image_not_found");
        assert_eq!(problem_for(Some("not_found"), "no such deployment", None).kind, "not_found");
    }

    #[test]
    fn the_email_comes_from_the_id_token() {
        use base64::Engine as _;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"email":"ana@example.com"}"#);
        assert_eq!(email_from_id_token(&format!("h.{payload}.s")), Some("ana@example.com".into()));
        assert_eq!(email_from_id_token("not-a-token"), None);
    }

    #[test]
    fn stored_sign_ins_are_told_apart_from_old_key_files() {
        let sign_in = GoogleSignIn::new("1//refresh".into(), Some("ana@example.com".into()));
        let stored = serde_json::to_string(&sign_in).unwrap();
        assert_eq!(GoogleSignIn::from_stored(&stored), Some(sign_in.clone()));
        assert_eq!(sign_in.summary(), "Signed in as ana@example.com");
        assert_eq!(GoogleSignIn::from_stored(r#"{"type":"service_account","project_id":"p"}"#), None);
    }

    #[test]
    fn project_ids_and_regions_are_checked() {
        assert!(is_project_id("graphrt"));
        assert!(is_project_id("acme-agents-123"));
        assert!(is_project_id("example.com:legacy-app"));
        assert!(!is_project_id("Acme"));
        assert!(!is_project_id("short"));
        assert!(!is_project_id("ends-with-"));
        assert!(!is_project_id("acme agents"));
        assert!(!is_project_id("--project=x"));
        assert!(is_region("asia-southeast2"));
        assert!(is_region("us-central1"));
        assert!(is_region("europe-west10"));
        assert!(!is_region("asia"));
        assert!(!is_region("sin"));
        assert!(!is_region("us-central"));
        assert!(!is_region("us-central1; rm"));
        assert!(CloudPlace { project: " graphrt ".into(), region: "asia-southeast2".into() }.checked().is_ok());
        assert!(CloudPlace { project: String::new(), region: "asia-southeast2".into() }.checked().is_err());
    }

    #[test]
    fn console_pages_name_the_project_and_only_console_urls_are_fixes() {
        assert_eq!(
            console_url(ConsolePage::Billing, Some("graphrt")).unwrap(),
            "https://console.cloud.google.com/billing/linkedaccount?project=graphrt"
        );
        assert!(console_url(ConsolePage::Billing, Some("x&y=1")).is_err());
        assert!(is_fix_url("https://console.cloud.google.com/iam-admin/iam?project=graphrt"));
        assert!(!is_fix_url("http://console.cloud.google.com/"));
        assert!(!is_fix_url("https://evil.example/console.cloud.google.com"));
        assert!(!is_fix_url("https://user@console.cloud.google.com/"));
    }

    #[test]
    fn cli_errors_become_plain_problems_with_a_fix() {
        let place = CloudPlace { project: "graphrt".into(), region: "asia-southeast2".into() };
        let api = problem_for(
            Some("api_disabled"),
            "could not create the service: run.googleapis.com is turned off in project graphrt. Turn it on with `gcloud services enable run.googleapis.com --project graphrt`",
            Some(&place),
        );
        assert_eq!(api.service.as_deref(), Some("run.googleapis.com"));
        assert_eq!(
            api.fix,
            Some(DeployFix::OpenPage {
                url: "https://console.cloud.google.com/apis/library/run.googleapis.com?project=graphrt".into()
            })
        );
        let billing = problem_for(Some("billing_disabled"), "no billing", Some(&place));
        assert!(billing.message.contains("billing account"));
        assert_eq!(
            billing.fix,
            Some(DeployFix::OpenPage {
                url: "https://console.cloud.google.com/billing/linkedaccount?project=graphrt".into()
            })
        );
        let denied = problem_for(
            Some("permission_denied"),
            "ana lacks a permission. Ask an owner of the project to give you the role Cloud Run Admin (roles/run.admin), or Owner",
            Some(&place),
        );
        assert_eq!(denied.role.as_deref(), Some("roles/run.admin"));
        assert!(denied.message.contains("roles/run.admin"));
        let policy = problem_for(Some("org_policy"), "constraints/run.managed.requireInvokerIam", Some(&place));
        assert!(matches!(policy.fix, Some(DeployFix::OpenPage { ref url }) if url.contains("orgpolicies")));
        assert_eq!(problem_for(Some("unauthorized"), "expired", Some(&place)).fix, Some(DeployFix::SignInAgain));
        let other = problem_for(Some("gcp_api"), "Google said no", None);
        assert_eq!(other.message, "Google said no");
        assert_eq!(other.fix, None);
    }

    #[tokio::test]
    async fn projects_come_with_their_billing_state() {
        let http = FakeHttp::default();
        http.answer(
            "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100",
            200,
            r#"{"projects":[{"projectId":"zeta-shop","name":"Zeta shop","lifecycleState":"ACTIVE"},{"projectId":"acme-agents","name":"Acme agents","lifecycleState":"ACTIVE"},{"projectId":"no-access-1","lifecycleState":"ACTIVE"}]}"#,
        );
        http.answer(
            "https://cloudbilling.googleapis.com/v1/projects/zeta-shop/billingInfo",
            200,
            r#"{"billingEnabled":true}"#,
        );
        http.answer(
            "https://cloudbilling.googleapis.com/v1/projects/acme-agents/billingInfo",
            200,
            r#"{"billingEnabled":false}"#,
        );
        http.answer("https://cloudbilling.googleapis.com/v1/projects/no-access-1/billingInfo", 403, "{}");
        let projects = list_projects(&http, "ya29.token").await.unwrap();
        let summary: Vec<(&str, BillingState)> =
            projects.iter().map(|project| (project.id.as_str(), project.billing)).collect();
        assert_eq!(
            summary,
            [
                ("zeta-shop", BillingState::Enabled),
                ("acme-agents", BillingState::Disabled),
                ("no-access-1", BillingState::Unknown)
            ]
        );
        assert_eq!(projects[2].name, "no-access-1");
        assert!(http.requests.lock().unwrap().iter().all(|(_, bearer)| bearer.as_deref() == Some("ya29.token")));
    }

    #[tokio::test]
    async fn an_expired_sign_in_asks_to_sign_in_again() {
        let http = FakeHttp::default();
        http.answer(
            "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100",
            401,
            "{}",
        );
        let error = list_projects(&http, "old").await.unwrap_err();
        assert!(matches!(&error, AppError::DeployFailed(problem) if problem.fix == Some(DeployFix::SignInAgain)));
    }

    #[tokio::test]
    async fn a_fresh_token_is_reused_and_a_refused_refresh_asks_to_sign_in() {
        let http = FakeHttp::default();
        let cache = TokenCache::default();
        cache.set(Some(CachedToken::for_test("fresh", Duration::from_secs(3000)))).await;
        let sign_in = GoogleSignIn::new("1//refresh".into(), None);
        assert_eq!(cache.access_token(&http, &sign_in).await.unwrap(), "fresh");
        assert!(http.requests.lock().unwrap().is_empty(), "no refresh while the token is fresh");
        if !sign_in_available() {
            // Builds without the client secret cannot refresh at all.
            cache.set(Some(CachedToken::for_test("old", Duration::from_secs(60)))).await;
            assert!(cache.access_token(&http, &sign_in).await.is_err());
            return;
        }
        cache.set(Some(CachedToken::for_test("old", Duration::from_secs(60)))).await;
        http.answer(&format!("POST {TOKEN_URL}"), 400, r#"{"error":"invalid_grant"}"#);
        let error = cache.access_token(&http, &sign_in).await.unwrap_err();
        assert!(matches!(&error, AppError::DeployFailed(problem) if problem.fix == Some(DeployFix::SignInAgain)));
        http.answer(&format!("POST {TOKEN_URL}"), 200, r#"{"access_token":"new","expires_in":3599}"#);
        assert_eq!(cache.access_token(&http, &sign_in).await.unwrap(), "new");
        let bodies = http.bodies.lock().unwrap();
        let (_, form) = bodies.last().unwrap();
        assert_eq!(form["grant_type"], "refresh_token");
        assert_eq!(form["refresh_token"], "1//refresh");
    }
}
