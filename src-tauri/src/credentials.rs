//! Model provider API keys in the OS keychain (macOS Keychain, Windows Credential
//! Manager, Secret Service on Linux), and the graphrt `ModelRegistry` built from them.
//!
//! Keys never leave the backend: the frontend can set or delete a key and ask
//! whether one is configured, but it can never read a key back.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Keychain service name under which every key is stored.
pub const KEYCHAIN_SERVICE: &str = "dev.graphrt.desktop";

/// Setting keys in `storage::settings`.
pub const SETTING_DEFAULT_PROVIDER: &str = "default_model_provider";
pub const SETTING_DEFAULT_MODEL: &str = "default_model_name";
pub const SETTING_OLLAMA_BASE_URL: &str = "ollama_base_url";

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

/// Where keys are kept. `Keychain` in the app, `InMemory` in tests.
#[derive(Debug)]
pub struct CredentialStore {
    // CONTRACT: implementation detail of the credentials owner.
    _private: (),
}

fn not_implemented<T>() -> AppResult<T> {
    Err(AppError::Internal("not implemented".into()))
}

impl CredentialStore {
    /// Store backed by the OS keychain under [`KEYCHAIN_SERVICE`].
    pub fn keychain() -> Self {
        Self { _private: () }
    }

    /// Store that keeps keys in memory only (tests).
    pub fn in_memory() -> Self {
        Self { _private: () }
    }

    /// Saves or replaces a provider key. Rejects empty keys and `Ollama`.
    pub fn set_api_key(&self, _provider: ModelProvider, _api_key: &str) -> AppResult<()> {
        not_implemented()
    }

    /// Removes a key; succeeds if none was stored.
    pub fn delete_api_key(&self, _provider: ModelProvider) -> AppResult<()> {
        not_implemented()
    }

    /// Backend-only access to a key. Never expose through a command.
    pub(crate) fn read_api_key(&self, _provider: ModelProvider) -> AppResult<Option<String>> {
        not_implemented()
    }

    pub fn provider_statuses(&self, _db: &Database) -> AppResult<Vec<ProviderStatus>> {
        not_implemented()
    }
}

/// Builds the graphrt model registry from stored keys: every provider with a key,
/// plus Ollama (base URL from settings, default `http://localhost:11434`).
pub fn build_model_registry(_store: &CredentialStore, _db: &Database) -> AppResult<graphrt_llm::ModelRegistry> {
    not_implemented()
}

/// The default model from settings, falling back to the first configured provider's
/// recommended small model (openai → gpt-4o-mini, anthropic → claude-haiku-5-5,
/// gemini → gemini-2.5-flash, ollama → llama3.2). `MissingCredentials` if none is usable.
pub fn default_model(_store: &CredentialStore, _db: &Database) -> AppResult<ModelChoice> {
    not_implemented()
}
