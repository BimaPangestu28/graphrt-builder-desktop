//! Talking to an online agent or a connected server: `GET /healthz`, `GET /v1/runs?limit=`,
//! and the read-only Fly.io call that checks an access key. Behind [`DeployHttp`] so tests
//! use a fake. Keys go in the `Authorization` header only, never in URLs or logs.

use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
/// Fly's Machines API; listing apps is read-only.
pub const FLY_TOKEN_CHECK_URL: &str = "https://api.machines.dev/v1/apps?org_slug=personal";

/// A response: status code and body text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

pub trait DeployHttp: Send + Sync + std::fmt::Debug {
    /// `GET url` with an optional bearer token.
    fn get(&self, url: String, bearer: Option<String>) -> BoxFuture<'_, AppResult<HttpReply>>;
}

/// Whether `url` may be called: https anywhere, or plain http to this computer or the local
/// network (an IT team's server in the office), never with credentials in it.
///
/// # Errors
/// `InvalidInput` with a plain sentence.
pub fn check_server_url(url: &str) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| AppError::InvalidInput("Enter the full address, like https://agents.example.com".into()))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::InvalidInput("Leave the user name and password out of the address".into()));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_local = host == "localhost"
        || host.ends_with(".local")
        || host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok_and(|address| match address {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        });
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if is_local => Ok(parsed),
        "http" => Err(AppError::InvalidInput("Use an https:// address for servers outside your network".into())),
        _ => Err(AppError::InvalidInput("Enter an http:// or https:// address".into())),
    }
}

/// `<base>/<path>` without doubled slashes.
pub fn join_url(base: &str, path_and_query: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path_and_query.trim_start_matches('/'))
}

/// The real client: rustls, no redirects (an API answers directly), short timeouts.
#[derive(Debug)]
pub struct ReqwestDeployHttp {
    client: reqwest::Client,
}

impl ReqwestDeployHttp {
    /// # Errors
    /// `Internal` when the client cannot be built.
    pub fn new() -> AppResult<Self> {
        let _already_installed = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| AppError::Internal(format!("could not set up the online client: {error}")))?;
        Ok(Self { client })
    }
}

impl DeployHttp for ReqwestDeployHttp {
    fn get(&self, url: String, bearer: Option<String>) -> BoxFuture<'_, AppResult<HttpReply>> {
        Box::pin(async move {
            let mut request = self.client.get(&url);
            if let Some(token) = bearer {
                request = request.bearer_auth(token);
            }
            let host = reqwest::Url::parse(&url).ok().and_then(|parsed| parsed.host_str().map(str::to_owned));
            let unreachable = |error: reqwest::Error| {
                let host = host.clone().unwrap_or_else(|| "the server".into());
                let reason = if error.is_timeout() { "it did not answer in time" } else { "it could not be reached" };
                AppError::Internal(format!("{host}: {reason}"))
            };
            let response = request.send().await.map_err(unreachable)?;
            let status = response.status().as_u16();
            let bytes = response.bytes().await.map_err(unreachable)?;
            let body = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BODY_BYTES)]).into_owned();
            Ok(HttpReply { status, body })
        })
    }
}

/// Health of an online agent or server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub healthy: bool,
    /// One plain sentence.
    pub message: String,
}

/// `GET <url>/healthz`: healthy on 2xx.
pub async fn check_health(http: &dyn DeployHttp, base_url: &str) -> HealthCheck {
    match http.get(join_url(base_url, "healthz"), None).await {
        Ok(reply) if (200..300).contains(&reply.status) => HealthCheck { healthy: true, message: "It answers".into() },
        Ok(reply) => HealthCheck { healthy: false, message: format!("It answered with an error ({})", reply.status) },
        Err(error) => HealthCheck { healthy: false, message: error.to_string() },
    }
}

/// One run of an online agent, as the Runs screen shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRun {
    pub id: String,
    /// The workflow name the server reports, if any.
    pub workflow: Option<String>,
    /// graphrt's run status (`running`, `succeeded`, `failed`, `paused`…).
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

fn text_field(value: &serde_json::Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| match value.get(*name)? {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

/// Reads `GET /v1/runs`: a JSON array, or an object with `runs` / `items` / `data`. Entries
/// without an id are skipped; unknown fields are ignored.
pub fn parse_cloud_runs(body: &str) -> AppResult<Vec<CloudRun>> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|_| AppError::Internal("the online agent sent runs this app can't read".into()))?;
    let entries = match &value {
        serde_json::Value::Array(entries) => entries.clone(),
        serde_json::Value::Object(_) => {
            ["runs", "items", "data"].iter().find_map(|key| value.get(*key)?.as_array().cloned()).unwrap_or_default()
        }
        _ => Vec::new(),
    };
    Ok(entries
        .iter()
        .filter_map(|entry| {
            Some(CloudRun {
                id: text_field(entry, &["id", "run_id", "runId"])?,
                workflow: text_field(entry, &["workflow", "workflow_name", "workflowName"]),
                status: text_field(entry, &["status", "state"]).unwrap_or_else(|| "unknown".into()),
                started_at: text_field(entry, &["started_at", "startedAt", "created_at", "createdAt"]),
                finished_at: text_field(entry, &["finished_at", "finishedAt", "ended_at"]),
                error: text_field(entry, &["error", "error_message", "errorMessage"]),
            })
        })
        .collect())
}

/// `GET <url>/v1/runs?limit=<limit>` with the API key.
///
/// # Errors
/// `Credentials` when the key is refused; `Internal` when unreachable or unreadable.
pub async fn fetch_cloud_runs(
    http: &dyn DeployHttp,
    base_url: &str,
    api_key: &str,
    limit: u32,
) -> AppResult<Vec<CloudRun>> {
    let reply = http.get(join_url(base_url, &format!("v1/runs?limit={limit}")), Some(api_key.to_owned())).await?;
    match reply.status {
        200..=299 => parse_cloud_runs(&reply.body),
        401 | 403 => Err(AppError::Credentials("the online agent did not accept its access key".into())),
        status => Err(AppError::Internal(format!("the online agent answered with an error ({status})"))),
    }
}

/// Checks a Fly.io access key with a read-only call. Only a 401 means the key is wrong: an
/// organization token may not see the personal organization (403), which is still a real key.
///
/// # Errors
/// `InvalidInput` when Fly.io refuses the key; `Internal` when Fly.io cannot be reached.
pub async fn check_fly_token_online(http: &dyn DeployHttp, token: &str) -> AppResult<()> {
    let reply = http.get(FLY_TOKEN_CHECK_URL.to_owned(), Some(token.to_owned())).await?;
    if reply.status == 401 {
        return Err(AppError::InvalidInput(
            "Fly.io didn't accept this access key. Create a new one on the Tokens page and paste it again".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;

    /// Answers by URL; records what was asked.
    #[derive(Debug, Default)]
    pub(crate) struct FakeHttp {
        pub replies: Mutex<HashMap<String, HttpReply>>,
        pub requests: Mutex<Vec<(String, Option<String>)>>,
    }

    impl FakeHttp {
        pub(crate) fn answer(&self, url: &str, status: u16, body: &str) {
            self.replies.lock().unwrap().insert(url.to_owned(), HttpReply { status, body: body.to_owned() });
        }
    }

    impl DeployHttp for FakeHttp {
        fn get(&self, url: String, bearer: Option<String>) -> BoxFuture<'_, AppResult<HttpReply>> {
            self.requests.lock().unwrap().push((url.clone(), bearer));
            let reply = self.replies.lock().unwrap().get(&url).cloned();
            Box::pin(
                async move { reply.ok_or_else(|| AppError::Internal("example.test: it could not be reached".into())) },
            )
        }
    }

    #[test]
    fn server_urls_need_https_outside_the_local_network() {
        assert!(check_server_url("https://agents.example.com").is_ok());
        assert!(check_server_url("http://192.168.1.20:8080").is_ok());
        assert!(check_server_url("http://localhost:8080").is_ok());
        assert!(check_server_url("http://home-nas.local").is_ok());
        assert!(check_server_url("http://agents.example.com").is_err());
        assert!(check_server_url("https://user:pw@agents.example.com").is_err());
        assert!(check_server_url("ftp://x").is_err());
        assert!(check_server_url("agents").is_err());
        assert_eq!(join_url("https://a.fly.dev/", "/healthz"), "https://a.fly.dev/healthz");
    }

    #[test]
    fn reads_runs_in_several_shapes() {
        let array = r#"[{"id":"r1","workflow":"menu","status":"succeeded","started_at":"2026-11-24T10:00:00Z"},{"status":"x"}]"#;
        let runs = parse_cloud_runs(array).unwrap();
        assert_eq!(runs.len(), 1, "entries without id are skipped");
        assert_eq!(runs[0].workflow.as_deref(), Some("menu"));
        let wrapped = r#"{"runs":[{"runId":"r2","state":"failed","error":"busy"}]}"#;
        assert_eq!(parse_cloud_runs(wrapped).unwrap()[0].error.as_deref(), Some("busy"));
        assert!(parse_cloud_runs("<html>").is_err());
    }

    #[tokio::test]
    async fn health_runs_and_fly_check_use_the_key_only_in_the_header() {
        let http = FakeHttp::default();
        http.answer("https://a.fly.dev/healthz", 200, "ok");
        http.answer("https://a.fly.dev/v1/runs?limit=20", 200, r#"[{"id":"r1","status":"running"}]"#);
        http.answer(FLY_TOKEN_CHECK_URL, 401, "");
        assert!(check_health(&http, "https://a.fly.dev").await.healthy);
        assert!(!check_health(&http, "https://down.fly.dev").await.healthy);
        assert_eq!(fetch_cloud_runs(&http, "https://a.fly.dev", "grt_key", 20).await.unwrap().len(), 1);
        assert!(check_fly_token_online(&http, "bad").await.is_err());
        http.answer(FLY_TOKEN_CHECK_URL, 403, "");
        assert!(check_fly_token_online(&http, "org-token").await.is_ok());
        let requests = http.requests.lock().unwrap();
        assert!(requests.iter().all(|(url, _)| !url.contains("grt_key")));
        assert!(requests.iter().any(|(_, bearer)| bearer.as_deref() == Some("grt_key")));
    }
}
