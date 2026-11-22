//! The chat models each connected provider offers, asked from the provider itself
//! with the key stored in the keychain (the key never leaves the backend).
//!
//! | Provider  | Endpoint                                   |
//! |-----------|--------------------------------------------|
//! | OpenAI    | `GET https://api.openai.com/v1/models`     |
//! | Anthropic | `GET https://api.anthropic.com/v1/models`  |
//! | Gemini    | `GET …/v1beta/models` (generateContent)    |
//! | DeepSeek  | `GET https://api.deepseek.com/v1/models`   |
//! | Ollama    | `GET <base_url>/api/tags` (pulled models)  |
//! | Local CLIs (Claude Code, Codex, Gemini CLI, …) | the CLI itself, no usage spent (`local_cli::list_models`) |
//!
//! Lists are filtered to models that can chat (OpenAI also lists embeddings,
//! speech and image models) and cached for [`CACHE_TTL`]. A provider that cannot
//! be reached reports an error instead of failing the whole list, so the UI can
//! fall back to the recommended model.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::credentials::{CredentialStore, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// How long a fetched list is reused before asking the provider again.
pub const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Model lists are small; anything larger is not a model list.
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=1000";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
const DEEPSEEK_MODELS_URL: &str = "https://api.deepseek.com/v1/models";

/// Providers in the order the picker lists them.
const LISTED_PROVIDERS: [ModelProvider; 12] = [
    ModelProvider::Openai,
    ModelProvider::Anthropic,
    ModelProvider::Gemini,
    ModelProvider::Deepseek,
    ModelProvider::Ollama,
    ModelProvider::ClaudeCodeCli,
    ModelProvider::CodexCli,
    ModelProvider::GeminiCli,
    ModelProvider::CursorCli,
    ModelProvider::CopilotCli,
    ModelProvider::OpencodeCli,
    ModelProvider::QwenCodeCli,
];

/// One model a provider offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    /// The id used in workflow documents, e.g. `gpt-4o-mini`.
    pub id: String,
    /// The provider's display name, when it has one (Anthropic, Gemini).
    pub display_name: Option<String>,
}

/// The models of one provider, or why they could not be listed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModels {
    pub provider: ModelProvider,
    pub models: Vec<AvailableModel>,
    /// Plain-language reason the list is empty (rejected key, offline...). Never contains the key.
    pub error: Option<String>,
}

/// One HTTP GET returning JSON. The app uses reqwest; tests script the replies.
pub trait ModelListFetcher: Send + Sync + std::fmt::Debug {
    fn get_json<'a>(&'a self, url: &'a str, headers: Vec<(&'static str, String)>) -> BoxFuture<'a, AppResult<Json>>;
}

/// Lists and caches the models of every provider that is set up.
#[derive(Debug)]
pub struct ModelCatalog {
    fetcher: Arc<dyn ModelListFetcher>,
    cache: Mutex<HashMap<ModelProvider, (Instant, ProviderModels)>>,
}

impl ModelCatalog {
    pub fn new(fetcher: Arc<dyn ModelListFetcher>) -> Self {
        Self { fetcher, cache: Mutex::new(HashMap::new()) }
    }

    /// The catalog the app uses, fetching over HTTPS (plain HTTP only for a local Ollama).
    ///
    /// # Errors
    /// `Internal` when the HTTP client cannot be built.
    pub fn with_http() -> AppResult<Self> {
        Ok(Self::new(Arc::new(HttpModelListFetcher::new()?)))
    }

    /// Models of every provider with a key, plus Ollama when it answers. With
    /// `refresh`, cached lists are fetched again.
    ///
    /// # Errors
    /// Only keychain or settings failures; provider failures are reported per provider.
    pub async fn list(
        &self,
        credentials: &CredentialStore,
        db: &Database,
        refresh: bool,
    ) -> AppResult<Vec<ProviderModels>> {
        let statuses = credentials.provider_statuses(db)?;
        let mut requests = Vec::new();
        for provider in LISTED_PROVIDERS {
            let Some(status) = statuses.iter().find(|status| status.provider == provider) else {
                continue;
            };
            if !status.configured {
                continue;
            }
            if let Some(cli) = provider.local_cli() {
                requests.push(Box::pin(local_cli_models(provider, cli)) as BoxFuture<'_, ProviderModels>);
                continue;
            }
            if !refresh {
                if let Some(cached) = self.cached(provider) {
                    requests.push(Box::pin(futures::future::ready(cached)) as BoxFuture<'_, ProviderModels>);
                    continue;
                }
            }
            let request = match provider_request(provider, credentials, status.base_url.as_deref())? {
                Some(request) => request,
                None => continue,
            };
            requests.push(Box::pin(self.fetch_provider(provider, request)));
        }
        let lists = futures::future::join_all(requests).await;
        // A local Ollama that is not running is not worth an error row.
        Ok(lists.into_iter().filter(|list| !(list.provider == ModelProvider::Ollama && list.error.is_some())).collect())
    }

    /// Drops a provider's cached list, e.g. after its key was replaced or removed.
    pub fn forget(&self, provider: ModelProvider) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(&provider);
        }
    }

    fn cached(&self, provider: ModelProvider) -> Option<ProviderModels> {
        let cache = self.cache.lock().ok()?;
        let (fetched_at, models) = cache.get(&provider)?;
        (fetched_at.elapsed() < CACHE_TTL).then(|| models.clone())
    }

    async fn fetch_provider(&self, provider: ModelProvider, request: ProviderRequest) -> ProviderModels {
        let outcome = tokio::time::timeout(REQUEST_TIMEOUT, self.fetcher.get_json(&request.url, request.headers)).await;
        let result = match outcome {
            Ok(Ok(body)) => Ok(parse_models(provider, &body)),
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => Err("the provider did not answer in time".to_owned()),
        };
        let list = match result {
            Ok(models) => ProviderModels { provider, models, error: None },
            Err(message) => ProviderModels { provider, models: Vec::new(), error: Some(message) },
        };
        // Only successful lists are cached, so a fixed key or connection shows up on the next look.
        if list.error.is_none() {
            if let Ok(mut cache) = self.cache.lock() {
                cache.insert(provider, (Instant::now(), list.clone()));
            }
        }
        list
    }
}

/// The models a local CLI offers (read from the CLI itself, off the async runtime).
async fn local_cli_models(provider: ModelProvider, cli: crate::local_cli::LocalCli) -> ProviderModels {
    let listing = tokio::task::spawn_blocking(move || {
        let detection = crate::local_cli::detect::cached(cli, false);
        crate::local_cli::list_models(cli, &detection)
    })
    .await;
    match listing {
        Ok(models) => ProviderModels { provider, models, error: None },
        Err(error) => {
            ProviderModels { provider, models: Vec::new(), error: Some(format!("could not list models: {error}")) }
        }
    }
}

struct ProviderRequest {
    url: String,
    headers: Vec<(&'static str, String)>,
}

/// URL and auth headers for one provider, or `None` when it has no key after all.
fn provider_request(
    provider: ModelProvider,
    credentials: &CredentialStore,
    ollama_base_url: Option<&str>,
) -> AppResult<Option<ProviderRequest>> {
    if provider == ModelProvider::Ollama {
        let base_url = ollama_base_url.unwrap_or("http://localhost:11434").trim_end_matches('/');
        return Ok(Some(ProviderRequest { url: format!("{base_url}/api/tags"), headers: Vec::new() }));
    }
    let Some(api_key) = credentials.read_api_key(provider)? else {
        return Ok(None);
    };
    let request = match provider {
        ModelProvider::Openai => ProviderRequest {
            url: OPENAI_MODELS_URL.to_owned(),
            headers: vec![("authorization", format!("Bearer {api_key}"))],
        },
        ModelProvider::Deepseek => ProviderRequest {
            url: DEEPSEEK_MODELS_URL.to_owned(),
            headers: vec![("authorization", format!("Bearer {api_key}"))],
        },
        ModelProvider::Anthropic => ProviderRequest {
            url: ANTHROPIC_MODELS_URL.to_owned(),
            headers: vec![("x-api-key", api_key), ("anthropic-version", ANTHROPIC_API_VERSION.to_owned())],
        },
        ModelProvider::Gemini => {
            ProviderRequest { url: GEMINI_MODELS_URL.to_owned(), headers: vec![("x-goog-api-key", api_key)] }
        }
        // Ollama is handled above; the local CLIs list their models themselves.
        _ => return Ok(None),
    };
    Ok(Some(request))
}

/// The chat models in one provider's list response, sorted by id.
pub fn parse_models(provider: ModelProvider, body: &Json) -> Vec<AvailableModel> {
    let mut models: Vec<AvailableModel> = match provider {
        ModelProvider::Openai => {
            openai_style_ids(body).filter(|id| is_openai_chat_model(id)).map(plain_model).collect()
        }
        ModelProvider::Deepseek => openai_style_ids(body).map(plain_model).collect(),
        ModelProvider::Anthropic => array_field(body, "data")
            .filter_map(|model| {
                let id = model.get("id")?.as_str()?;
                Some(AvailableModel { id: id.to_owned(), display_name: string_field(model, "display_name") })
            })
            .collect(),
        ModelProvider::Gemini => array_field(body, "models").filter_map(parse_gemini_model).collect(),
        ModelProvider::Ollama => array_field(body, "models")
            .filter_map(|model| model.get("name")?.as_str().map(plain_model))
            .filter(|model| !model.id.contains("embed"))
            .collect(),
        _ => Vec::new(),
    };
    models.sort_by(|first, second| first.id.cmp(&second.id));
    models.dedup_by(|first, second| first.id == second.id);
    models
}

fn array_field<'a>(body: &'a Json, field: &str) -> impl Iterator<Item = &'a Json> {
    body.get(field).and_then(Json::as_array).into_iter().flatten()
}

fn string_field(value: &Json, field: &str) -> Option<String> {
    value.get(field).and_then(Json::as_str).map(str::trim).filter(|text| !text.is_empty()).map(str::to_owned)
}

fn openai_style_ids(body: &Json) -> impl Iterator<Item = &str> {
    array_field(body, "data").filter_map(|model| model.get("id")?.as_str())
}

fn plain_model(id: &str) -> AvailableModel {
    AvailableModel { id: id.to_owned(), display_name: None }
}

/// OpenAI lists every model the key can use; keep the ones that answer chat requests.
fn is_openai_chat_model(id: &str) -> bool {
    const CHAT_PREFIXES: &[&str] = &["gpt-", "chatgpt-", "o1", "o3", "o4"];
    const NOT_CHAT: &[&str] =
        &["embedding", "tts", "whisper", "dall-e", "audio", "realtime", "transcribe", "image", "moderation", "search"];
    CHAT_PREFIXES.iter().any(|prefix| id.starts_with(prefix)) && !NOT_CHAT.iter().any(|part| id.contains(part))
}

/// Gemini models that support `generateContent`, without the `models/` prefix.
fn parse_gemini_model(model: &Json) -> Option<AvailableModel> {
    let can_chat =
        array_field(model, "supportedGenerationMethods").any(|method| method.as_str() == Some("generateContent"));
    if !can_chat {
        return None;
    }
    let name = model.get("name")?.as_str()?;
    let id = name.strip_prefix("models/").unwrap_or(name);
    if id.contains("embedding") || id.starts_with("aqa") || id.starts_with("imagen") {
        return None;
    }
    Some(AvailableModel { id: id.to_owned(), display_name: string_field(model, "displayName") })
}

/// reqwest-backed fetcher: HTTPS for cloud providers, plain HTTP allowed for a local Ollama.
#[derive(Debug)]
struct HttpModelListFetcher {
    client: reqwest::Client,
}

impl HttpModelListFetcher {
    fn new() -> AppResult<Self> {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _already_installed = rustls::crypto::ring::default_provider().install_default();
        });
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(3))
            .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| AppError::Internal(format!("could not set up the model list client: {error}")))?;
        Ok(Self { client })
    }

    async fn fetch(&self, url: &str, headers: Vec<(&'static str, String)>) -> AppResult<Json> {
        let is_local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
        if !url.starts_with("https://") && !is_local {
            return Err(AppError::InvalidInput("model lists are only fetched over HTTPS".into()));
        }
        let mut request = self.client.get(url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let response = request.send().await.map_err(|error| AppError::Model(connection_message(&error)))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Model("the key was rejected by the provider".into()));
        }
        if !status.is_success() {
            return Err(AppError::Model(format!("the provider answered {status}")));
        }
        let bytes = response.bytes().await.map_err(|error| AppError::Model(connection_message(&error)))?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::Model("the model list was unexpectedly large".into()));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}

impl ModelListFetcher for HttpModelListFetcher {
    fn get_json<'a>(&'a self, url: &'a str, headers: Vec<(&'static str, String)>) -> BoxFuture<'a, AppResult<Json>> {
        Box::pin(self.fetch(url, headers))
    }
}

/// reqwest errors can echo the URL; none of our URLs carry the key (it goes in a header).
fn connection_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "the provider did not answer in time".to_owned()
    } else if error.is_connect() {
        "could not reach the provider".to_owned()
    } else {
        format!("could not list models: {error}")
    }
}

#[cfg(test)]
mod tests;
