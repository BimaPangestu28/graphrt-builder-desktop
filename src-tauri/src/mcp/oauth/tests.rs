//! OAuth sign-in against a mock MCP server + authorization server on 127.0.0.1
//! (plain HTTP/1.1, one request per connection). No real account is involved.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use graphrt_core::tool::ToolRuntime;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use super::client::OAuthHttp;
use super::metadata::{discover, resource_metadata_parameter, well_known_urls};
use super::pkce::Verifier;
use super::store::{self, ClientKind};
use super::*;
use crate::credentials::{CredentialStore, McpOAuthPart};

/// A server name unique to the running test (sign-ins waiting for the same name cancel each other).
fn server() -> String {
    let test_name = std::thread::current().name().unwrap_or("test").to_owned();
    let digest = Sha256::digest(test_name.as_bytes());
    format!("t{}", digest.iter().take(6).map(|byte| format!("{byte:02x}")).collect::<String>())
}

/// What the mock does and what it saw.
#[derive(Default)]
struct MockState {
    base: String,
    // configuration
    with_registration: bool,
    with_cimd: bool,
    send_resource_metadata_header: bool,
    wrong_issuer: bool,
    wrong_resource: bool,
    /// The resource metadata names the origin (`https://host`) instead of `/mcp`.
    parent_resource: bool,
    /// The 401 challenge carries `scope="…"`.
    challenge_scope: Option<String>,
    /// The MCP endpoint answers with a redirect.
    redirect: bool,
    /// The token endpoint answers this much later (a refresh in flight).
    token_delay_ms: u64,
    open_server: bool,
    expires_in: u64,
    // state
    valid_access: Vec<String>,
    valid_refresh: Vec<String>,
    codes: HashMap<String, (String, String)>, // code -> (challenge, client_id)
    issued: usize,
    // observations
    registrations: Vec<serde_json::Value>,
    authorize_params: Vec<HashMap<String, String>>,
    token_requests: Vec<HashMap<String, String>>,
    revoked: Vec<HashMap<String, String>>,
    mcp_auth_headers: Vec<String>,
}

type Shared = Arc<Mutex<MockState>>;

fn lock(state: &Shared) -> std::sync::MutexGuard<'_, MockState> {
    state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn mock(configure: impl FnOnce(&mut MockState)) -> (String, Shared) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let state: Shared = Arc::new(Mutex::new(MockState {
        base: base.clone(),
        with_registration: true,
        send_resource_metadata_header: true,
        expires_in: 3600,
        ..MockState::default()
    }));
    configure(&mut lock(&state));
    let served = state.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let state = served.clone();
            tokio::spawn(async move { serve(stream, state).await });
        }
    });
    (format!("{base}/mcp"), state)
}

async fn serve(stream: tokio::net::TcpStream, state: Shared) {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.is_err() {
        return;
    }
    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let length = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0usize);
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body).await;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let target = parts.next().unwrap_or_default().to_owned();
    let delay = if target.starts_with("/token") { lock(&state).token_delay_ms } else { 0 };
    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
    let response = route(&state, &method, &target, &headers, &body);
    let _ = reader.get_mut().write_all(response.as_bytes()).await;
    let _ = reader.get_mut().shutdown().await;
}

fn http(status: &str, extra: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
}

fn json(status: &str, value: &serde_json::Value) -> String {
    http(status, "content-type: application/json\r\n", &value.to_string())
}

fn form(body: &[u8]) -> HashMap<String, String> {
    url::form_urlencoded::parse(body).into_owned().collect()
}

fn route(state: &Shared, method: &str, target: &str, headers: &HashMap<String, String>, body: &[u8]) -> String {
    let mut s = lock(state);
    let base = s.base.clone();
    let path = target.split('?').next().unwrap_or_default();
    match (method, path) {
        ("POST", "/mcp") => {
            let auth = headers.get("authorization").cloned().unwrap_or_default();
            s.mcp_auth_headers.push(auth.clone());
            let token = auth.strip_prefix("Bearer ").unwrap_or_default().to_owned();
            if s.redirect {
                return http("307 Temporary Redirect", &format!("location: {base}/mcp/\r\n"), "");
            }
            if !s.open_server && !s.valid_access.contains(&token) {
                let scope = s.challenge_scope.as_ref().map(|scope| format!(", scope=\"{scope}\"")).unwrap_or_default();
                let header = if s.send_resource_metadata_header {
                    format!(
                        "www-authenticate: Bearer error=\"invalid_token\", resource_metadata=\"{base}/.well-known/oauth-protected-resource/mcp\"{scope}\r\n"
                    )
                } else {
                    "www-authenticate: Bearer\r\n".to_owned()
                };
                return http("401 Unauthorized", &header, "");
            }
            mcp_reply(body)
        }
        ("GET", "/.well-known/oauth-protected-resource/mcp") => {
            let resource = if s.wrong_resource {
                "https://other.example/mcp".to_owned()
            } else if s.parent_resource {
                base.clone()
            } else {
                format!("{base}/mcp/")
            };
            json(
                "200 OK",
                &serde_json::json!({"resource": resource, "authorization_servers": [base], "scopes_supported": []}),
            )
        }

        ("GET", "/.well-known/oauth-authorization-server") => {
            let issuer = if s.wrong_issuer { "https://evil.example".to_owned() } else { base.clone() };
            let mut metadata = serde_json::json!({
                "issuer": issuer,
                "authorization_endpoint": format!("{base}/authorize"),
                "token_endpoint": format!("{base}/token"),
                "revocation_endpoint": format!("{base}/revoke"),
                "code_challenge_methods_supported": ["S256"],
                "client_id_metadata_document_supported": s.with_cimd,
            });
            if s.with_registration {
                metadata["registration_endpoint"] = serde_json::json!(format!("{base}/register"));
            }
            json("200 OK", &metadata)
        }
        ("POST", "/register") => {
            let request: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
            s.registrations.push(request);
            let client_id = format!("client-{}", s.registrations.len());
            json("201 Created", &serde_json::json!({"client_id": client_id}))
        }
        ("POST", "/token") => {
            let fields = form(body);
            s.token_requests.push(fields.clone());
            match fields.get("grant_type").map(String::as_str) {
                Some("authorization_code") => {
                    let code = fields.get("code").cloned().unwrap_or_default();
                    let Some((challenge, client_id)) = s.codes.remove(&code) else {
                        return json("400 Bad Request", &serde_json::json!({"error": "invalid_grant"}));
                    };
                    let verifier = fields.get("code_verifier").cloned().unwrap_or_default();
                    let computed = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
                    if computed != challenge || fields.get("client_id") != Some(&client_id) {
                        return json(
                            "400 Bad Request",
                            &serde_json::json!({"error": "invalid_grant", "error_description": "PKCE"}),
                        );
                    }
                    issue(&mut s)
                }
                Some("refresh_token") => {
                    let refresh = fields.get("refresh_token").cloned().unwrap_or_default();
                    if !s.valid_refresh.contains(&refresh) {
                        return json(
                            "400 Bad Request",
                            &serde_json::json!({"error": "invalid_grant", "error_description": "revoked"}),
                        );
                    }
                    s.valid_refresh.retain(|r| r != &refresh);
                    issue(&mut s)
                }
                _ => json("400 Bad Request", &serde_json::json!({"error": "unsupported_grant_type"})),
            }
        }
        ("POST", "/revoke") => {
            let fields = form(body);
            if let Some(token) = fields.get("token") {
                let token = token.clone();
                s.valid_access.retain(|t| t != &token);
                s.valid_refresh.retain(|t| t != &token);
            }
            s.revoked.push(fields);
            http("200 OK", "", "")
        }
        _ => http("404 Not Found", "", ""),
    }
}

fn issue(s: &mut MockState) -> String {
    s.issued += 1;
    let access = format!("access-{}", s.issued);
    let refresh = format!("refresh-{}", s.issued);
    s.valid_access.push(access.clone());
    s.valid_refresh.push(refresh.clone());
    json(
        "200 OK",
        &serde_json::json!({"access_token": access, "token_type": "Bearer", "expires_in": s.expires_in, "refresh_token": refresh}),
    )
}

fn mcp_reply(body: &[u8]) -> String {
    let message: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let Some(id) = message.get("id").cloned() else { return http("202 Accepted", "", "") };
    let result = match message.get("method").and_then(serde_json::Value::as_str) {
        Some("initialize") => serde_json::json!({
            "protocolVersion": message.pointer("/params/protocolVersion").cloned().unwrap_or_default(),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mock", "version": "1"}
        }),
        Some("tools/list") => serde_json::json!({
            "tools": [{"name": "find_jobs", "description": "Find jobs", "inputSchema": {"type": "object"}}]
        }),
        _ => serde_json::json!({}),
    };
    json("200 OK", &serde_json::json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

/// A "browser": reads the authorization request, lets the mock issue a code,
/// and calls the redirect URI the way the authorization server's redirect would.
fn browser(state: Shared, approve: bool) -> impl Fn(&str) -> Result<(), String> + Send + Sync {
    move |authorize_url: &str| {
        let url = url::Url::parse(authorize_url).map_err(|e| e.to_string())?;
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let redirect = params.get("redirect_uri").cloned().unwrap_or_default();
        let state_value = params.get("state").cloned().unwrap_or_default();
        let target = if approve {
            let code = format!("code-{}", lock(&state).authorize_params.len() + 1);
            let challenge = params.get("code_challenge").cloned().unwrap_or_default();
            let client_id = params.get("client_id").cloned().unwrap_or_default();
            lock(&state).codes.insert(code.clone(), (challenge, client_id));
            format!("{redirect}?code={code}&state={state_value}")
        } else {
            format!("{redirect}?error=access_denied&state={state_value}")
        };
        lock(&state).authorize_params.push(params);
        tokio::spawn(async move {
            // A stray request first: it must be ignored.
            let _ = reqwest::get(format!("{redirect}?code=forged&state=wrong")).await;
            let _ = reqwest::get(target).await;
        });
        Ok(())
    }
}

fn http_client() -> OAuthHttp {
    OAuthHttp::new().expect("http client")
}

async fn signed_in(configure: impl FnOnce(&mut MockState)) -> (String, Shared, Arc<CredentialStore>) {
    let (url, state) = mock(configure).await;
    let credentials = Arc::new(CredentialStore::in_memory());
    let open = browser(state.clone(), true);
    let options = SignInOptions { http: &http_client(), open_browser: &open, timeout: Duration::from_secs(10) };
    let status = sign_in(&credentials, &server(), &url, options).await.expect("signed in");
    assert!(matches!(status, McpSignInStatus::SignedIn { .. }), "{status:?}");
    (url, state, credentials)
}

#[test]
fn pkce_challenge_is_base64url_of_sha256() {
    // Expected value computed independently (Python hashlib + base64.urlsafe_b64encode, no padding).
    let verifier = Verifier::from_text("dBjftJeZ4CVP-mB92K9uhvsTf6AnK1y5n6g2HWDc7uk");
    assert_eq!(verifier.challenge(), "CevYuUkJTQjGLcwETTWr6eSKhXtkbzx9abuu0xCTBcs");
    let generated = Verifier::generate().expect("random");
    assert_eq!(generated.secret().len(), 43, "32 random bytes, base64url");
    assert_ne!(generated.secret(), Verifier::generate().expect("random").secret());
    assert_ne!(pkce::random_state().expect("random"), pkce::random_state().expect("random"));
}

#[test]
fn reads_resource_metadata_from_the_challenge() {
    let header = r#"Bearer error="invalid_token", resource_metadata="https://mcp.upwork.com/.well-known/oauth-protected-resource/mcp""#;
    assert_eq!(
        resource_metadata_parameter(header).as_deref(),
        Some("https://mcp.upwork.com/.well-known/oauth-protected-resource/mcp")
    );
    assert_eq!(
        resource_metadata_parameter("Bearer resource_metadata=https://a/b, x=1").as_deref(),
        Some("https://a/b")
    );
    assert_eq!(resource_metadata_parameter("Bearer realm=\"x\""), None);
    let base = url::Url::parse("https://mcp.example.com/mcp").expect("url");
    assert_eq!(
        well_known_urls(&base, "oauth-protected-resource"),
        [
            "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
            "https://mcp.example.com/.well-known/oauth-protected-resource"
        ]
    );
}

#[tokio::test]
async fn discovery_follows_the_401_to_both_metadata_documents() {
    let (url, state) = mock(|_| {}).await;
    let base = lock(&state).base.clone();
    let discovery = discover(&http_client(), &url).await.expect("discovered");
    assert_eq!(discovery.resource, format!("{url}/"), "the resource as its metadata states it (trailing / tolerated)");
    assert_eq!(discovery.issuer, base);
    assert_eq!(discovery.token_endpoint, format!("{base}/token"));
    assert_eq!(discovery.registration_endpoint, Some(format!("{base}/register")));
    assert_eq!(discovery.revocation_endpoint, Some(format!("{base}/revoke")));
    assert_eq!(discovery.scope, None, "no scopes_supported, no scope");
}

#[tokio::test]
async fn discovery_falls_back_to_well_known_urls_without_a_metadata_link() {
    let (url, _state) = mock(|s| s.send_resource_metadata_header = false).await;
    let discovery = discover(&http_client(), &url).await.expect("discovered from /.well-known");
    assert!(discovery.authorization_endpoint.ends_with("/authorize"));
}

#[tokio::test]
async fn discovery_refuses_a_mismatched_issuer_and_open_servers() {
    let (url, _state) = mock(|s| s.wrong_issuer = true).await;
    let error = discover(&http_client(), &url).await.expect_err("issuer mismatch");
    assert!(error.to_string().contains("not signing in"), "{error}");

    let (url, _state) = mock(|s| s.wrong_resource = true).await;
    let error = discover(&http_client(), &url).await.expect_err("metadata of another resource");
    assert!(error.to_string().contains("https://other.example/mcp"), "{error}");

    let (url, _state) = mock(|s| s.open_server = true).await;
    let error = discover(&http_client(), &url).await.expect_err("no sign-in needed");
    assert!(error.to_string().contains("does not ask for a sign-in"), "{error}");
}

#[tokio::test]
async fn sign_in_registers_a_public_client_and_exchanges_the_code_with_pkce() {
    let (url, state, credentials) = signed_in(|_| {}).await;
    let s = lock(&state);
    assert_eq!(s.registrations.len(), 1);
    let registration = &s.registrations[0];
    assert_eq!(registration["token_endpoint_auth_method"], "none");
    assert_eq!(registration["client_name"], CLIENT_NAME);
    let redirect = registration["redirect_uris"][0].as_str().unwrap_or_default();
    assert!(redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/callback"), "{redirect}");

    let authorize = &s.authorize_params[0];
    assert_eq!(authorize.get("code_challenge_method").map(String::as_str), Some("S256"));
    assert_eq!(authorize.get("resource"), Some(&format!("{url}/")));
    assert_eq!(authorize.get("client_id").map(String::as_str), Some("client-1"));
    let exchange = &s.token_requests[0];
    assert_eq!(exchange.get("grant_type").map(String::as_str), Some("authorization_code"));
    assert!(exchange.get("code_verifier").is_some_and(|v| v.len() == 43));
    drop(s);

    let session = store::load_session(&credentials, &server()).expect("read").expect("stored");
    assert_eq!(session.client_kind, ClientKind::Dynamic);
    assert_eq!(
        credentials.read_mcp_oauth(&server(), McpOAuthPart::RefreshToken).expect("read").as_deref(),
        Some("refresh-1")
    );
    let access = store::load_access_token(&credentials, &server()).expect("read").expect("stored");
    assert_eq!(access.token, "access-1");
    assert!(access.expires_at.is_some());
}

#[tokio::test]
async fn signing_in_again_reuses_the_registered_client() {
    let (url, state, credentials) = signed_in(|_| {}).await;
    let open = browser(state.clone(), true);
    let options = SignInOptions { http: &http_client(), open_browser: &open, timeout: Duration::from_secs(10) };
    sign_in(&credentials, &server(), &url, options).await.expect("second sign-in");
    assert_eq!(lock(&state).registrations.len(), 1, "no second registration");
    assert_eq!(lock(&state).authorize_params.len(), 2);
}

#[tokio::test]
async fn without_a_registration_endpoint_the_client_metadata_document_is_used() {
    let (_url, state, credentials) = signed_in(|s| {
        s.with_registration = false;
        s.with_cimd = true;
    })
    .await;
    assert!(lock(&state).registrations.is_empty());
    assert_eq!(lock(&state).authorize_params[0].get("client_id").map(String::as_str), Some(CLIENT_METADATA_URL));
    let session = store::load_session(&credentials, &server()).expect("read").expect("stored");
    assert_eq!(session.client_kind, ClientKind::MetadataDocument);
}

#[tokio::test]
async fn a_server_without_registration_or_metadata_documents_cannot_be_signed_in_to() {
    let (url, state) = mock(|s| s.with_registration = false).await;
    let credentials = CredentialStore::in_memory();
    let open = browser(state, true);
    let options = SignInOptions { http: &http_client(), open_browser: &open, timeout: Duration::from_secs(5) };
    let error = sign_in(&credentials, &server(), &url, options).await.expect_err("no client");
    assert!(matches!(error, OAuthError::Registration(_)), "{error}");
}

#[tokio::test]
async fn a_denied_sign_in_reports_it_and_stores_nothing() {
    let (url, state) = mock(|_| {}).await;
    let credentials = CredentialStore::in_memory();
    let open = browser(state, false);
    let options = SignInOptions { http: &http_client(), open_browser: &open, timeout: Duration::from_secs(5) };
    let error = sign_in(&credentials, &server(), &url, options).await.expect_err("denied");
    assert!(error.to_string().contains("access was denied"), "{error}");
    assert_eq!(sign_in_status(&credentials, &server()), McpSignInStatus::SignedOut);
}

#[tokio::test]
async fn a_waiting_sign_in_can_be_cancelled_or_times_out() {
    let (url, _state) = mock(|_| {}).await;
    let credentials = Arc::new(CredentialStore::in_memory());
    let ignore = |_: &str| -> Result<(), String> { Ok(()) };
    let waiting = {
        let credentials = credentials.clone();
        let url = url.clone();
        tokio::spawn(async move {
            let open = |_: &str| -> Result<(), String> { Ok(()) };
            let options = SignInOptions { http: &http_client(), open_browser: &open, timeout: Duration::from_secs(30) };
            sign_in(&credentials, "waiting", &url, options).await
        })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    cancel_sign_in("waiting");
    let outcome = tokio::time::timeout(Duration::from_secs(5), waiting).await.expect("stopped").expect("joined");
    assert_eq!(outcome, Err(OAuthError::Cancelled));

    let options = SignInOptions { http: &http_client(), open_browser: &ignore, timeout: Duration::from_millis(200) };
    assert_eq!(sign_in(&credentials, &server(), &url, options).await, Err(OAuthError::TimedOut));
}

#[tokio::test]
async fn an_expiring_token_is_refreshed_before_use() {
    let (_url, state, credentials) = signed_in(|s| s.expires_in = 30).await;
    let provider = provider::OAuthTokenProvider::new(credentials.clone(), server(), http_client());
    let token = graphrt_mcp::TokenProvider::access_token(&provider).await.expect("token");
    assert_eq!(token, "access-2", "expires within the margin, so refreshed");
    let refresh = &lock(&state).token_requests[1];
    assert_eq!(refresh.get("grant_type").map(String::as_str), Some("refresh_token"));
    assert_eq!(refresh.get("refresh_token").map(String::as_str), Some("refresh-1"));
    assert_eq!(
        credentials.read_mcp_oauth(&server(), McpOAuthPart::RefreshToken).expect("read").as_deref(),
        Some("refresh-2"),
        "the rotated refresh token is stored"
    );
}

#[tokio::test]
async fn a_rejected_access_token_is_refreshed_once_and_the_call_retried() {
    let (url, state, credentials) = signed_in(|_| {}).await;
    // The server revokes the token before it expires.
    lock(&state).valid_access.clear();
    lock(&state).mcp_auth_headers.clear();
    let config = graphrt_mcp::McpServerConfig {
        name: server(),
        transport: graphrt_mcp::McpTransport::Http(graphrt_mcp::HttpConfig {
            url: url.clone(),
            headers: Default::default(),
            bearer_token: None,
            token_source: Some(token_source(credentials.clone(), &server()).expect("source")),
        }),
        timeout_ms: 10_000,
        allowed_tools: None,
    };
    let runtime = graphrt_mcp::McpToolRuntime::connect(&config).await.expect("connects after one refresh");
    let tools = runtime.list().await.expect("tools");
    assert_eq!(tools[0].name, "find_jobs");
    runtime.close().await;
    let s = lock(&state);
    assert_eq!(s.mcp_auth_headers[0], "Bearer access-1");
    assert!(s.mcp_auth_headers[1..].iter().all(|h| h == "Bearer access-2"), "{:?}", s.mcp_auth_headers);
    let refreshes =
        s.token_requests.iter().filter(|r| r.get("grant_type").map(String::as_str) == Some("refresh_token"));
    assert_eq!(refreshes.count(), 1);
}

#[tokio::test]
async fn a_rejected_refresh_token_asks_the_user_to_sign_in_again() {
    let (_url, state, credentials) = signed_in(|s| s.expires_in = 0).await;
    lock(&state).valid_refresh.clear();
    let provider = provider::OAuthTokenProvider::new(credentials.clone(), server(), http_client());
    let error = graphrt_mcp::TokenProvider::access_token(&provider).await.expect_err("refresh rejected");
    assert!(
        matches!(&error, graphrt_mcp::TokenError::SignInRequired(m) if m.contains(&format!("Sign in to MCP server `{}` again", server()))),
        "{error}"
    );
    assert!(matches!(sign_in_status(&credentials, &server()), McpSignInStatus::Expired { .. }));
    assert_eq!(credentials.read_mcp_oauth(&server(), McpOAuthPart::RefreshToken).expect("read"), None);
    // No second request to the token endpoint once the sign-in is marked expired.
    let requests_before = lock(&state).token_requests.len();
    assert!(graphrt_mcp::TokenProvider::refresh(&provider, "access-1".into()).await.is_err());
    assert_eq!(lock(&state).token_requests.len(), requests_before);
}

#[tokio::test]
async fn sign_out_revokes_both_tokens_and_forgets_the_sign_in() {
    let (_url, state, credentials) = signed_in(|_| {}).await;
    sign_out(&http_client(), &credentials, &server()).await.expect("signed out");
    let s = lock(&state);
    let revoked: Vec<(&str, &str)> = s
        .revoked
        .iter()
        .map(|r| {
            (
                r.get("token").map(String::as_str).unwrap_or_default(),
                r.get("token_type_hint").map(String::as_str).unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(revoked, [("refresh-1", "refresh_token"), ("access-1", "access_token")]);
    assert!(s.revoked.iter().all(|r| r.get("client_id").map(String::as_str) == Some("client-1")));
    drop(s);
    assert_eq!(sign_in_status(&credentials, &server()), McpSignInStatus::SignedOut);
    for part in McpOAuthPart::ALL {
        assert_eq!(credentials.read_mcp_oauth(&server(), part).expect("read"), None);
    }
}

#[test]
fn debug_output_never_shows_tokens() {
    let access = store::StoredAccessToken { token: "secret-access".into(), expires_at: Some(1) };
    let response = client::TokenResponse {
        access_token: "secret-access".into(),
        token_type: None,
        expires_in: None,
        refresh_token: Some("secret-refresh".into()),
        scope: None,
    };
    let shown = format!("{access:?} {response:?} {:?}", Verifier::from_text("secret-verifier"));
    assert!(!shown.contains("secret-"), "{shown}");
}

/// The document hosted at `CLIENT_METADATA_URL` (graphrt.com).
fn expected_client_metadata() -> serde_json::Value {
    serde_json::json!({
        "client_id": "https://graphrt.com/oauth/client-metadata.json",
        "client_name": "Graphrt",
        "client_uri": "https://graphrt.com",
        "redirect_uris": ["http://127.0.0.1/callback"],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native"
    })
}

#[test]
fn the_client_metadata_document_names_its_own_url() {
    let document: serde_json::Value = serde_json::from_str(include_str!("client-metadata.json")).expect("valid JSON");
    assert_eq!(document, expected_client_metadata());
    assert_eq!(document["client_id"], CLIENT_METADATA_URL);
}

/// The hosted document is exactly the bundled one, served without a redirect.
/// Run by hand: `cargo test live_client_metadata_document -- --ignored`.
#[tokio::test]
#[ignore = "reaches graphrt.com"]
async fn live_client_metadata_document() {
    let hosted: Option<serde_json::Value> = http_client().get_json(CLIENT_METADATA_URL).await.expect("reachable");
    assert_eq!(hosted, Some(expected_client_metadata()), "200 with the same JSON (no redirect is followed)");
}

#[tokio::test]
async fn the_scope_of_the_challenge_is_requested() {
    let (url, _state) = mock(|s| s.challenge_scope = Some("jobs:read proposals:write".into())).await;
    let discovery = discover(&http_client(), &url).await.expect("discovered");
    assert_eq!(discovery.scope.as_deref(), Some("jobs:read proposals:write"));
}

#[tokio::test]
async fn resource_metadata_for_a_parent_path_is_accepted() {
    let (url, state) = mock(|s| s.parent_resource = true).await;
    let discovery = discover(&http_client(), &url).await.expect("the origin covers /mcp");
    assert_eq!(discovery.resource, lock(&state).base, "the resource as the metadata states it");
    assert!(metadata::covers_resource("https://host", "https://host/mcp"));
    assert!(metadata::covers_resource("https://host/mcp/", "https://host/mcp"));
    assert!(!metadata::covers_resource("https://host/mc", "https://host/mcp"), "a path segment, not a prefix");
    assert!(!metadata::covers_resource("https://host/a", "https://host/mcp"));
    assert!(!metadata::covers_resource("https://other", "https://host/mcp"));
}

#[tokio::test]
async fn a_redirecting_server_gets_a_clear_message() {
    let (url, _state) = mock(|s| s.redirect = true).await;
    let error = discover(&http_client(), &url).await.expect_err("redirect");
    assert!(error.to_string().contains("redirect (HTTP 307)"), "{error}");
}

#[tokio::test]
async fn sign_out_waits_for_a_refresh_in_flight_and_revokes_its_tokens() {
    let (_url, state, credentials) = signed_in(|s| s.expires_in = 30).await;
    lock(&state).token_delay_ms = 300;
    let refreshing = {
        let credentials = credentials.clone();
        tokio::spawn(async move {
            let provider = provider::OAuthTokenProvider::new(credentials, server(), http_client());
            graphrt_mcp::TokenProvider::access_token(&provider).await
        })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    sign_out(&http_client(), &credentials, &server()).await.expect("signed out");
    assert_eq!(refreshing.await.expect("joined").expect("refreshed"), "access-2");
    let revoked: Vec<String> = lock(&state).revoked.iter().filter_map(|r| r.get("token").cloned()).collect();
    assert_eq!(revoked, ["refresh-2", "access-2"], "the tokens of the refresh are the ones revoked");
    for part in McpOAuthPart::ALL {
        assert_eq!(credentials.read_mcp_oauth(&server(), part).expect("read"), None, "nothing comes back");
    }
}

#[tokio::test]
async fn sign_out_removes_the_sign_in_even_when_a_token_is_unreadable() {
    let (_url, _state, credentials) = signed_in(|_| {}).await;
    credentials.set_mcp_oauth(&server(), McpOAuthPart::AccessToken, "{not json").expect("stored");
    sign_out(&http_client(), &credentials, &server()).await.expect("signed out anyway");
    assert_eq!(sign_in_status(&credentials, &server()), McpSignInStatus::SignedOut);
    assert_eq!(credentials.read_mcp_oauth(&server(), McpOAuthPart::Session).expect("read"), None);
}

#[tokio::test]
async fn two_runs_share_one_refresh_of_a_rotating_refresh_token() {
    let (_url, state, credentials) = signed_in(|s| s.expires_in = 30).await;
    lock(&state).expires_in = 3600; // the refreshed token lasts
    let first = provider::OAuthTokenProvider::new(credentials.clone(), server(), http_client());
    let second = provider::OAuthTokenProvider::new(credentials.clone(), server(), http_client());
    let (a, b) = tokio::join!(
        graphrt_mcp::TokenProvider::access_token(&first),
        graphrt_mcp::TokenProvider::access_token(&second)
    );
    // Both get a token; the second run reuses the token the first refresh stored
    // instead of spending the already rotated refresh token.
    assert!(a.is_ok() && b.is_ok(), "{a:?} {b:?}");
    let refreshes = lock(&state)
        .token_requests
        .iter()
        .filter(|r| r.get("grant_type").map(String::as_str) == Some("refresh_token"))
        .count();
    assert_eq!(refreshes, 1, "one refresh for both runs");
    assert!(matches!(sign_in_status(&credentials, &server()), McpSignInStatus::SignedIn { .. }));
}

/// Discovery only (an unauthenticated `initialize` and two metadata GETs): no
/// registration, no sign-in. Run by hand: `cargo test live_upwork_discovery -- --ignored`.
#[tokio::test]
#[ignore = "reaches mcp.upwork.com"]
async fn live_upwork_discovery() {
    let discovery = discover(&http_client(), "https://mcp.upwork.com/mcp").await.expect("discovered");
    assert_eq!(discovery.resource, "https://mcp.upwork.com/mcp");
    assert_eq!(discovery.issuer, "https://mcp.upwork.com");
    assert!(discovery.authorization_endpoint.starts_with("https://www.upwork.com/"));
    assert!(discovery.registration_endpoint.is_some() && discovery.client_id_metadata_document_supported);
    assert!(discovery.revocation_endpoint.is_some());
}
