//! Model provider API keys in the OS keychain (macOS Keychain, Windows Credential
//! Manager, Secret Service on Linux), and the graphrt `ModelRegistry` built from them.
//!
//! Keys never leave the backend: the frontend can set or delete a key and ask
//! whether one is configured, but it can never read a key back. Keys are also
//! kept out of `Debug` output, log lines and error messages.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use graphrt_llm::anthropic::{AnthropicConfig, AnthropicModel};
use graphrt_llm::gemini::{GeminiConfig, GeminiModel};
use graphrt_llm::openai::{OpenAiConfig, OpenAiModel};
use graphrt_llm::{ChatModel, LlmError, ModelRegistry};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Keychain service name under which every key is stored.
pub const KEYCHAIN_SERVICE: &str = "dev.graphrt.desktop";

/// Setting keys in `storage::settings`.
pub const SETTING_DEFAULT_PROVIDER: &str = "default_model_provider";
pub const SETTING_DEFAULT_MODEL: &str = "default_model_name";
pub const SETTING_OLLAMA_BASE_URL: &str = "ollama_base_url";

/// Ollama's standard local address, used when no base URL is configured.
const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434";

/// Every provider, in the order the UI lists them.
const ALL_PROVIDERS: [ModelProvider; 4] =
    [ModelProvider::Openai, ModelProvider::Anthropic, ModelProvider::Gemini, ModelProvider::Ollama];

/// Key-based providers in fallback order, with the small model recommended for each.
const RECOMMENDED_MODELS: [(ModelProvider, &str); 3] = [
    (ModelProvider::Openai, "gpt-4o-mini"),
    (ModelProvider::Anthropic, "claude-haiku-5-5"),
    (ModelProvider::Gemini, "gemini-2.5-flash"),
];

/// Providers offered on the Welcome and Connections screens. The serialized
/// name is also the graphrt `model.provider` used in workflow documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProvider {
    Openai,
    Anthropic,
    Gemini,
    /// Local Ollama server; needs no key.
    Ollama,
}

impl ModelProvider {
    /// The graphrt provider name, identical to the serde name.
    fn registry_name(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
        }
    }

    /// Parses a provider name as stored in settings.
    fn from_registry_name(name: &str) -> Option<Self> {
        ALL_PROVIDERS.into_iter().find(|provider| provider.registry_name() == name)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: ModelProvider,
    /// A key is stored (always true for Ollama).
    pub configured: bool,
    /// Only for Ollama.
    pub base_url: Option<String>,
}

/// The model new agents use, e.g. `{ provider: openai, name: gpt-4o-mini }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub provider: ModelProvider,
    pub name: String,
}

/// Where keys are physically kept.
enum CredentialBackend {
    /// OS keychain; one entry per provider under `service`.
    Keychain { service: String },
    /// Process memory only (tests).
    InMemory(Mutex<HashMap<ModelProvider, String>>),
}

/// Where keys are kept. `Keychain` in the app, `InMemory` in tests.
pub struct CredentialStore {
    backend: CredentialBackend,
}

/// Shows the backend and which providers have keys, never the keys themselves.
impl fmt::Debug for CredentialStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.backend {
            CredentialBackend::Keychain { service } => formatter
                .debug_struct("CredentialStore")
                .field("backend", &"keychain")
                .field("service", service)
                .finish(),
            CredentialBackend::InMemory(keys) => {
                let mut stored_providers: Vec<ModelProvider> = match keys.lock() {
                    Ok(guard) => guard.keys().copied().collect(),
                    Err(_) => Vec::new(),
                };
                stored_providers.sort_by_key(|provider| provider.registry_name());
                formatter
                    .debug_struct("CredentialStore")
                    .field("backend", &"in_memory")
                    .field("stored_providers", &stored_providers)
                    .finish()
            }
        }
    }
}

/// Converts a keychain error into an `AppError` naming the provider and operation only.
/// `keyring::Error`'s `Display` never includes the password, so it is safe to include.
fn keychain_error(operation: &str, provider: ModelProvider, error: &keyring::Error) -> AppError {
    AppError::Credentials(format!("could not {operation} the {} key: {error}", provider.registry_name()))
}

fn model_error(provider: ModelProvider, error: &LlmError) -> AppError {
    AppError::Model(format!("could not set up the {} model client: {error}", provider.registry_name()))
}

impl CredentialStore {
    /// Store backed by the OS keychain under [`KEYCHAIN_SERVICE`].
    pub fn keychain() -> Self {
        Self::keychain_for_service(KEYCHAIN_SERVICE)
    }

    /// Store backed by the OS keychain under a custom service name.
    fn keychain_for_service(service: &str) -> Self {
        Self { backend: CredentialBackend::Keychain { service: service.to_owned() } }
    }

    /// Store that keeps keys in memory only (tests).
    pub fn in_memory() -> Self {
        Self { backend: CredentialBackend::InMemory(Mutex::new(HashMap::new())) }
    }

    /// Saves or replaces a provider key. Rejects empty keys and `Ollama`.
    pub fn set_api_key(&self, provider: ModelProvider, api_key: &str) -> AppResult<()> {
        if provider == ModelProvider::Ollama {
            return Err(AppError::InvalidInput("Ollama does not use an API key".into()));
        }
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::InvalidInput("API key is empty".into()));
        }
        match &self.backend {
            CredentialBackend::Keychain { service } => keychain_entry(service, provider)?
                .set_password(api_key)
                .map_err(|error| keychain_error("save", provider, &error)),
            CredentialBackend::InMemory(keys) => {
                lock_keys(keys)?.insert(provider, api_key.to_owned());
                Ok(())
            }
        }
    }

    /// Removes a key; succeeds if none was stored.
    pub fn delete_api_key(&self, provider: ModelProvider) -> AppResult<()> {
        match &self.backend {
            CredentialBackend::Keychain { service } => match keychain_entry(service, provider)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(keychain_error("delete", provider, &error)),
            },
            CredentialBackend::InMemory(keys) => {
                lock_keys(keys)?.remove(&provider);
                Ok(())
            }
        }
    }

    /// Backend-only access to a key. Never expose through a command.
    pub(crate) fn read_api_key(&self, provider: ModelProvider) -> AppResult<Option<String>> {
        if provider == ModelProvider::Ollama {
            return Ok(None);
        }
        match &self.backend {
            CredentialBackend::Keychain { service } => match keychain_entry(service, provider)?.get_password() {
                Ok(api_key) => Ok(Some(api_key)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(keychain_error("read", provider, &error)),
            },
            CredentialBackend::InMemory(keys) => Ok(lock_keys(keys)?.get(&provider).cloned()),
        }
    }

    /// Whether a key is stored for `provider` (always true for Ollama).
    fn is_configured(&self, provider: ModelProvider) -> AppResult<bool> {
        if provider == ModelProvider::Ollama {
            return Ok(true);
        }
        Ok(self.read_api_key(provider)?.is_some())
    }

    pub fn provider_statuses(&self, db: &Database) -> AppResult<Vec<ProviderStatus>> {
        ALL_PROVIDERS
            .into_iter()
            .map(|provider| {
                let base_url = (provider == ModelProvider::Ollama).then(|| ollama_base_url(db));
                Ok(ProviderStatus { provider, configured: self.is_configured(provider)?, base_url })
            })
            .collect()
    }
}

fn keychain_entry(service: &str, provider: ModelProvider) -> AppResult<keyring::Entry> {
    keyring::Entry::new(service, provider.registry_name()).map_err(|error| keychain_error("open", provider, &error))
}

fn lock_keys(
    keys: &Mutex<HashMap<ModelProvider, String>>,
) -> AppResult<MutexGuard<'_, HashMap<ModelProvider, String>>> {
    keys.lock().map_err(|_| AppError::Internal("credential store lock poisoned".into()))
}

/// Reads a setting, treating read failures and blank values as unset (logged as a warning).
fn read_optional_setting(db: &Database, key: &str) -> Option<String> {
    match db.get_setting(key) {
        Ok(value) => value.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty()),
        Err(error) => {
            log::warn!("could not read setting `{key}`, using the default: {error}");
            None
        }
    }
}

/// The configured Ollama base URL, or [`DEFAULT_OLLAMA_BASE_URL`].
fn ollama_base_url(db: &Database) -> String {
    read_optional_setting(db, SETTING_OLLAMA_BASE_URL).unwrap_or_else(|| DEFAULT_OLLAMA_BASE_URL.to_owned())
}

/// Builds the client for a key-based provider, mirroring `ModelRegistry::from_vars`.
fn build_keyed_model(provider: ModelProvider, api_key: String) -> AppResult<Arc<dyn ChatModel>> {
    let model: Arc<dyn ChatModel> = match provider {
        ModelProvider::Openai => {
            let mut config = OpenAiConfig::new(OpenAiConfig::default().base_url, Some(api_key));
            config.use_max_completion_tokens = config.base_url.contains("api.openai.com");
            Arc::new(OpenAiModel::new(config).map_err(|error| model_error(provider, &error))?)
        }
        ModelProvider::Anthropic => {
            Arc::new(AnthropicModel::new(AnthropicConfig::new(api_key)).map_err(|error| model_error(provider, &error))?)
        }
        ModelProvider::Gemini => {
            Arc::new(GeminiModel::new(GeminiConfig::new(api_key)).map_err(|error| model_error(provider, &error))?)
        }
        ModelProvider::Ollama => return Err(AppError::Internal("Ollama does not use an API key".into())),
    };
    Ok(model)
}

/// Ollama through its OpenAI-compatible endpoint `<base_url>/v1`, with no key.
fn build_ollama_model(base_url: &str) -> AppResult<Arc<dyn ChatModel>> {
    let config = OpenAiConfig::new(format!("{}/v1", base_url.trim_end_matches('/')), None);
    let model = OpenAiModel::new(config).map_err(|error| model_error(ModelProvider::Ollama, &error))?;
    Ok(Arc::new(model))
}

/// Builds the graphrt model registry from stored keys: every provider with a key,
/// plus Ollama (base URL from settings, default `http://localhost:11434`).
pub fn build_model_registry(store: &CredentialStore, db: &Database) -> AppResult<graphrt_llm::ModelRegistry> {
    let mut registry = ModelRegistry::new();
    for (provider, _) in RECOMMENDED_MODELS {
        if let Some(api_key) = store.read_api_key(provider)? {
            registry.add(provider.registry_name(), build_keyed_model(provider, api_key)?);
        }
    }
    registry.add(ModelProvider::Ollama.registry_name(), build_ollama_model(&ollama_base_url(db))?);
    Ok(registry)
}

/// The model chosen in settings, if both settings are set and name a known provider.
fn model_from_settings(db: &Database) -> Option<ModelChoice> {
    let provider_name = read_optional_setting(db, SETTING_DEFAULT_PROVIDER)?;
    let name = read_optional_setting(db, SETTING_DEFAULT_MODEL)?;
    let Some(provider) = ModelProvider::from_registry_name(&provider_name) else {
        log::warn!("ignoring unknown default model provider `{provider_name}` in settings");
        return None;
    };
    Some(ModelChoice { provider, name })
}

/// The default model from settings, falling back to the first configured provider's
/// recommended small model (openai → gpt-4o-mini, anthropic → claude-haiku-5-5,
/// gemini → gemini-2.5-flash). Ollama is used only when chosen explicitly in
/// settings, since it may not be running. `MissingCredentials` if none is usable.
pub fn default_model(store: &CredentialStore, db: &Database) -> AppResult<ModelChoice> {
    if let Some(choice) = model_from_settings(db) {
        if store.is_configured(choice.provider)? {
            return Ok(choice);
        }
    }
    for (provider, model_name) in RECOMMENDED_MODELS {
        if store.is_configured(provider)? {
            return Ok(ModelChoice { provider, name: model_name.to_owned() });
        }
    }
    Err(AppError::MissingCredentials("a model provider".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET_KEY: &str = "sk-test-super-secret-0123456789";

    fn test_database() -> Database {
        Database::open_in_memory().expect("in-memory database opens")
    }

    #[test]
    fn set_replace_and_delete_key() {
        let store = CredentialStore::in_memory();
        assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap(), None);

        store.set_api_key(ModelProvider::Openai, "  first-key  ").unwrap();
        assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap().as_deref(), Some("first-key"));

        store.set_api_key(ModelProvider::Openai, "second-key").unwrap();
        assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap().as_deref(), Some("second-key"));

        store.delete_api_key(ModelProvider::Openai).unwrap();
        assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap(), None);
    }

    #[test]
    fn deleting_missing_key_succeeds() {
        let store = CredentialStore::in_memory();
        assert!(store.delete_api_key(ModelProvider::Gemini).is_ok());
    }

    #[test]
    fn empty_or_whitespace_key_is_rejected() {
        let store = CredentialStore::in_memory();
        for blank_key in ["", "   ", "\n\t"] {
            let result = store.set_api_key(ModelProvider::Anthropic, blank_key);
            assert!(matches!(result, Err(AppError::InvalidInput(_))), "{blank_key:?} accepted");
        }
        assert_eq!(store.read_api_key(ModelProvider::Anthropic).unwrap(), None);
    }

    #[test]
    fn ollama_key_is_rejected() {
        let store = CredentialStore::in_memory();
        let result = store.set_api_key(ModelProvider::Ollama, "some-key");
        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert_eq!(store.read_api_key(ModelProvider::Ollama).unwrap(), None);
    }

    #[test]
    fn statuses_have_fixed_order_and_ollama_default_url() {
        let store = CredentialStore::in_memory();
        store.set_api_key(ModelProvider::Anthropic, SECRET_KEY).unwrap();
        let statuses = store.provider_statuses(&test_database()).unwrap();

        let providers: Vec<ModelProvider> = statuses.iter().map(|status| status.provider).collect();
        assert_eq!(providers, ALL_PROVIDERS.to_vec());
        let configured: Vec<bool> = statuses.iter().map(|status| status.configured).collect();
        assert_eq!(configured, vec![false, true, false, true]);
        assert_eq!(statuses[3].base_url.as_deref(), Some(DEFAULT_OLLAMA_BASE_URL));
        assert!(statuses[..3].iter().all(|status| status.base_url.is_none()));
    }

    #[test]
    fn registry_contains_configured_providers_and_ollama() {
        let store = CredentialStore::in_memory();
        let empty_registry = build_model_registry(&store, &test_database()).unwrap();
        assert_eq!(empty_registry.names().collect::<Vec<_>>(), vec!["ollama"]);

        store.set_api_key(ModelProvider::Openai, SECRET_KEY).unwrap();
        store.set_api_key(ModelProvider::Gemini, "gemini-secret").unwrap();
        let registry = build_model_registry(&store, &test_database()).unwrap();
        assert_eq!(registry.names().collect::<Vec<_>>(), vec!["openai", "gemini", "ollama"]);
        assert!(registry.get("anthropic").is_err());
        assert!(!format!("{:?}", registry.get("openai").unwrap()).contains(SECRET_KEY));
    }

    #[test]
    fn registry_with_all_keys_has_all_providers() {
        let store = CredentialStore::in_memory();
        for (provider, _) in RECOMMENDED_MODELS {
            store.set_api_key(provider, SECRET_KEY).unwrap();
        }
        let registry = build_model_registry(&store, &test_database()).unwrap();
        assert_eq!(registry.names().collect::<Vec<_>>(), vec!["openai", "anthropic", "gemini", "ollama"]);
    }

    #[test]
    fn debug_output_never_contains_key() {
        let store = CredentialStore::in_memory();
        store.set_api_key(ModelProvider::Openai, SECRET_KEY).unwrap();
        let debug_output = format!("{store:?} {store:#?}");
        assert!(!debug_output.contains(SECRET_KEY), "{debug_output}");
        assert!(debug_output.contains("Openai"), "{debug_output}");

        let keychain_debug = format!("{:?}", CredentialStore::keychain());
        assert!(keychain_debug.contains(KEYCHAIN_SERVICE), "{keychain_debug}");
    }

    #[test]
    fn default_model_without_keys_is_missing_credentials() {
        let store = CredentialStore::in_memory();
        let result = default_model(&store, &test_database());
        assert!(matches!(result, Err(AppError::MissingCredentials(_))));
    }

    #[test]
    fn default_model_falls_back_in_provider_order() {
        let store = CredentialStore::in_memory();
        let db = test_database();

        store.set_api_key(ModelProvider::Gemini, SECRET_KEY).unwrap();
        let choice = default_model(&store, &db).unwrap();
        assert_eq!(choice, ModelChoice { provider: ModelProvider::Gemini, name: "gemini-2.5-flash".into() });

        store.set_api_key(ModelProvider::Anthropic, SECRET_KEY).unwrap();
        let choice = default_model(&store, &db).unwrap();
        assert_eq!(choice, ModelChoice { provider: ModelProvider::Anthropic, name: "claude-haiku-5-5".into() });

        store.set_api_key(ModelProvider::Openai, SECRET_KEY).unwrap();
        let choice = default_model(&store, &db).unwrap();
        assert_eq!(choice, ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() });
    }

    #[test]
    fn provider_names_round_trip_and_match_serde() {
        for provider in ALL_PROVIDERS {
            assert_eq!(ModelProvider::from_registry_name(provider.registry_name()), Some(provider));
            let serde_name = serde_json::to_value(provider).unwrap();
            assert_eq!(serde_name.as_str(), Some(provider.registry_name()));
        }
        assert_eq!(ModelProvider::from_registry_name("bedrock"), None);
    }

    /// Touches the real OS keychain (may show a permission prompt); run with `--ignored`.
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let service = format!("dev.graphrt.desktop.test.{}", uuid::Uuid::new_v4());
        let store = CredentialStore::keychain_for_service(&service);
        let provider = ModelProvider::Anthropic;

        // Record every observation first and assert only after cleanup, so a failure
        // never leaves a throwaway entry behind in the keychain.
        let observations = (|| -> AppResult<Vec<Option<String>>> {
            let before = store.read_api_key(provider)?;
            store.set_api_key(provider, SECRET_KEY)?;
            let after_set = store.read_api_key(provider)?;
            store.set_api_key(provider, "replacement-key")?;
            let after_replace = store.read_api_key(provider)?;
            store.delete_api_key(provider)?;
            let after_delete = store.read_api_key(provider)?;
            store.delete_api_key(provider)?;
            Ok(vec![before, after_set, after_replace, after_delete])
        })();
        let _ = store.delete_api_key(provider);

        let expected = vec![None, Some(SECRET_KEY.to_owned()), Some("replacement-key".to_owned()), None];
        assert_eq!(observations.unwrap(), expected);
    }
}
