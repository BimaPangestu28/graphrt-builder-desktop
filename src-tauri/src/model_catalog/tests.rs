use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;

use super::*;

const SECRET_KEY: &str = "sk-very-secret-key";

/// A request the fake saw: URL and headers.
type SeenRequest = (String, Vec<(&'static str, String)>);

/// Answers by URL prefix; counts calls; can fail one provider.
#[derive(Debug, Default)]
struct ScriptedFetcher {
    calls: AtomicUsize,
    seen_headers: Mutex<Vec<SeenRequest>>,
    reject_deepseek: bool,
}

impl ModelListFetcher for ScriptedFetcher {
    fn get_json<'a>(&'a self, url: &'a str, headers: Vec<(&'static str, String)>) -> BoxFuture<'a, AppResult<Json>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen_headers.lock().unwrap().push((url.to_owned(), headers));
        let reply = if url.starts_with(OPENAI_MODELS_URL) {
            Ok(
                json!({"data": [{"id": "gpt-4o-mini"}, {"id": "text-embedding-3-small"}, {"id": "gpt-4o"}, {"id": "whisper-1"}]}),
            )
        } else if url.starts_with(DEEPSEEK_MODELS_URL) {
            if self.reject_deepseek {
                Err(AppError::Model("the key was rejected by the provider".into()))
            } else {
                Ok(json!({"data": [{"id": "deepseek-reasoner"}, {"id": "deepseek-chat"}]}))
            }
        } else if url.ends_with("/api/tags") {
            Err(AppError::Model("could not reach the provider".into()))
        } else {
            Err(AppError::Model("unexpected url".into()))
        };
        Box::pin(futures::future::ready(reply))
    }
}

fn setup(reject_deepseek: bool) -> (Arc<ScriptedFetcher>, ModelCatalog, CredentialStore, Database) {
    let fetcher = Arc::new(ScriptedFetcher { reject_deepseek, ..ScriptedFetcher::default() });
    let catalog = ModelCatalog::new(fetcher.clone());
    let credentials = CredentialStore::in_memory();
    credentials.set_api_key(ModelProvider::Openai, SECRET_KEY).unwrap();
    credentials.set_api_key(ModelProvider::Deepseek, SECRET_KEY).unwrap();
    (fetcher, catalog, credentials, Database::open_in_memory().unwrap())
}

fn ids(list: &ProviderModels) -> Vec<&str> {
    list.models.iter().map(|model| model.id.as_str()).collect()
}

#[test]
fn openai_list_keeps_only_chat_models() {
    let body = json!({"data": [
        {"id": "gpt-4o"}, {"id": "gpt-4o-mini"}, {"id": "o3-mini"}, {"id": "chatgpt-4o-latest"},
        {"id": "text-embedding-3-large"}, {"id": "tts-1"}, {"id": "whisper-1"}, {"id": "dall-e-3"},
        {"id": "gpt-4o-realtime-preview"}, {"id": "gpt-4o-mini-transcribe"}, {"id": "omni-moderation-latest"}
    ]});
    let models = parse_models(ModelProvider::Openai, &body);
    let names: Vec<&str> = models.iter().map(|model| model.id.as_str()).collect();
    assert_eq!(names, ["chatgpt-4o-latest", "gpt-4o", "gpt-4o-mini", "o3-mini"]);
}

#[test]
fn anthropic_list_keeps_display_names() {
    let body = json!({"data": [
        {"id": "claude-haiku-5-5", "display_name": "Claude Haiku 5.5"},
        {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5"}
    ]});
    let models = parse_models(ModelProvider::Anthropic, &body);
    assert_eq!(
        models[0],
        AvailableModel { id: "claude-haiku-5-5".into(), display_name: Some("Claude Haiku 5.5".into()), parameter_millions: None }
    );
    assert_eq!(models.len(), 2);
}

#[test]
fn gemini_list_keeps_generate_content_models_without_prefix() {
    let body = json!({"models": [
        {"name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "supportedGenerationMethods": ["generateContent", "countTokens"]},
        {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/aqa", "supportedGenerationMethods": ["generateAnswer", "generateContent"]}
    ]});
    let models = parse_models(ModelProvider::Gemini, &body);
    assert_eq!(
        models,
        vec![AvailableModel { id: "gemini-2.5-flash".into(), display_name: Some("Gemini 2.5 Flash".into()), parameter_millions: None }]
    );
}

#[test]
fn deepseek_and_ollama_lists() {
    let deepseek =
        parse_models(ModelProvider::Deepseek, &json!({"data": [{"id": "deepseek-reasoner"}, {"id": "deepseek-chat"}]}));
    assert_eq!(
        deepseek.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(),
        ["deepseek-chat", "deepseek-reasoner"]
    );
    let ollama = parse_models(
        ModelProvider::Ollama,
        &json!({"models": [{"name": "llama3.2:latest"}, {"name": "nomic-embed-text:latest"}, {"name": "qwen2.5:14b"}]}),
    );
    assert_eq!(ollama.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(), ["llama3.2:latest", "qwen2.5:14b"]);
}

#[test]
fn ollama_models_carry_their_size_when_reported() {
    let ollama = parse_models(
        ModelProvider::Ollama,
        &json!({"models": [
            {"name": "llama3.2:latest", "details": {"parameter_size": "3.2B"}},
            {"name": "qwen2.5:14b", "details": {"parameter_size": "14.8B"}},
            {"name": "smollm:360m", "details": {"parameter_size": "361.82M"}},
            {"name": "custom:latest", "details": {"parameter_size": "big"}},
            {"name": "bare:latest"}
        ]}),
    );
    let sizes: Vec<(&str, Option<u32>)> =
        ollama.iter().map(|model| (model.id.as_str(), model.parameter_millions)).collect();
    assert_eq!(
        sizes,
        [
            ("bare:latest", None),
            ("custom:latest", None),
            ("llama3.2:latest", Some(3200)),
            ("qwen2.5:14b", Some(14800)),
            ("smollm:360m", Some(362))
        ]
    );
}

#[test]
fn malformed_bodies_give_empty_lists() {
    for provider in LISTED_PROVIDERS {
        assert!(parse_models(provider, &json!({"unexpected": true})).is_empty());
        assert!(parse_models(provider, &json!(null)).is_empty());
    }
}

#[tokio::test]
async fn lists_configured_providers_only_and_hides_an_unreachable_ollama() {
    let (fetcher, catalog, credentials, db) = setup(false);
    let lists = catalog.list(&credentials, &db, false).await.unwrap();

    let providers: Vec<ModelProvider> = lists.iter().map(|list| list.provider).collect();
    assert_eq!(providers, [ModelProvider::Openai, ModelProvider::Deepseek]);
    assert_eq!(ids(&lists[0]), ["gpt-4o", "gpt-4o-mini"]);
    assert_eq!(ids(&lists[1]), ["deepseek-chat", "deepseek-reasoner"]);
    // OpenAI, DeepSeek and the (failing) local Ollama were asked.
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), 3);
    let headers = fetcher.seen_headers.lock().unwrap();
    let openai_headers = &headers.iter().find(|(url, _)| url.starts_with(OPENAI_MODELS_URL)).unwrap().1;
    assert_eq!(openai_headers, &vec![("authorization", format!("Bearer {SECRET_KEY}"))]);
}

#[tokio::test]
async fn cached_lists_are_reused_until_refresh() {
    let (fetcher, catalog, credentials, db) = setup(false);
    catalog.list(&credentials, &db, false).await.unwrap();
    let calls_after_first = fetcher.calls.load(Ordering::SeqCst);

    catalog.list(&credentials, &db, false).await.unwrap();
    // Only the uncached (failing) Ollama is asked again.
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), calls_after_first + 1);

    catalog.list(&credentials, &db, true).await.unwrap();
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), calls_after_first + 1 + 3);
}

#[tokio::test]
async fn a_rejected_key_is_reported_per_provider_without_the_key() {
    let (_fetcher, catalog, credentials, db) = setup(true);
    let lists = catalog.list(&credentials, &db, false).await.unwrap();

    let deepseek = lists.iter().find(|list| list.provider == ModelProvider::Deepseek).unwrap();
    assert!(deepseek.models.is_empty());
    assert_eq!(deepseek.error.as_deref(), Some("model error: the key was rejected by the provider"));
    assert!(!format!("{lists:?}").contains(SECRET_KEY));
    // OpenAI still listed.
    assert!(!lists.iter().find(|list| list.provider == ModelProvider::Openai).unwrap().models.is_empty());
}

#[tokio::test]
async fn nothing_is_fetched_without_keys() {
    let fetcher = Arc::new(ScriptedFetcher::default());
    let catalog = ModelCatalog::new(fetcher.clone());
    let lists = catalog.list(&CredentialStore::in_memory(), &Database::open_in_memory().unwrap(), false).await.unwrap();
    assert!(lists.is_empty());
    // Only Ollama (always "configured") is tried.
    assert_eq!(fetcher.calls.load(Ordering::SeqCst), 1);
}

/// An Ollama server: answers with `reply`, or never answers when there is none.
#[derive(Debug)]
struct OllamaServer {
    reply: Option<Json>,
}

impl ModelListFetcher for OllamaServer {
    fn get_json<'a>(&'a self, url: &'a str, _headers: Vec<(&'static str, String)>) -> BoxFuture<'a, AppResult<Json>> {
        assert_eq!(url, "http://localhost:11434/api/tags");
        match self.reply.clone() {
            Some(reply) => Box::pin(futures::future::ready(Ok(reply))),
            None => Box::pin(futures::future::pending()),
        }
    }
}

#[tokio::test]
async fn ask_ollama_lists_the_models_of_a_running_server() {
    let reply = json!({"models": [{"name": "qwen2.5:14b"}, {"name": "llama3.2:latest"}]});
    let catalog = ModelCatalog::new(Arc::new(OllamaServer { reply: Some(reply) }));
    let models = catalog.ask_ollama("http://localhost:11434/").await.unwrap();
    assert_eq!(models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(), ["llama3.2:latest", "qwen2.5:14b"]);
}

#[tokio::test]
async fn ask_ollama_is_none_when_the_server_cannot_be_reached() {
    // The scripted fetcher fails every `/api/tags` request, like a closed port.
    let (_fetcher, catalog, _credentials, _db) = setup(false);
    assert_eq!(catalog.ask_ollama("http://localhost:11434").await, None);
}

#[tokio::test]
async fn ask_ollama_gives_up_on_a_server_that_never_answers() {
    let catalog = ModelCatalog::new(Arc::new(OllamaServer { reply: None }));
    assert_eq!(catalog.ask_ollama_within("http://localhost:11434", Duration::from_millis(20)).await, None);
}

#[test]
fn the_ollama_check_waits_two_seconds_at_most() {
    assert!(OLLAMA_CHECK_TIMEOUT <= Duration::from_secs(2));
}
