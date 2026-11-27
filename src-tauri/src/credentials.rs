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

use crate::error::{AppError, AppResult, CredentialStoreProblem};
use crate::local_cli::{self, LocalCli, LocalCliStatus};
use crate::storage::Database;

/// Keychain service name under which every key is stored.
pub const KEYCHAIN_SERVICE: &str = "dev.graphrt.desktop";

/// Setting keys in `storage::settings`.
pub const SETTING_DEFAULT_PROVIDER: &str = "default_model_provider";
pub const SETTING_DEFAULT_MODEL: &str = "default_model_name";
pub const SETTING_OLLAMA_BASE_URL: &str = "ollama_base_url";
/// What the user picked on the Welcome screen (`WelcomeChoice`).
pub const SETTING_WELCOME_CHOICE: &str = "welcome_choice";

/// Ollama's standard local address, used when no base URL is configured.
const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434";

/// Every provider, in the order the UI lists them.
const ALL_PROVIDERS: [ModelProvider; 12] = [
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

/// Key-based providers in fallback order, with the small model recommended for each.
pub(crate) const RECOMMENDED_MODELS: [(ModelProvider, &str); 4] = [
    (ModelProvider::Openai, "gpt-4o-mini"),
    (ModelProvider::Anthropic, "claude-haiku-5-5"),
    (ModelProvider::Gemini, "gemini-2.5-flash"),
    (ModelProvider::Deepseek, "deepseek-chat"),
];

/// DeepSeek's OpenAI-compatible endpoint (graphrt's OpenAI client also reads
/// `deepseek-reasoner`'s `reasoning_content`).
const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/v1";

/// Providers offered on the Welcome and Connections screens. The serialized
/// name is also the graphrt `model.provider` used in workflow documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProvider {
    Openai,
    Anthropic,
    Gemini,
    /// DeepSeek through its OpenAI-compatible API.
    Deepseek,
    /// Local Ollama server; needs no key.
    Ollama,
    /// The user's own Claude Code CLI and its sign-in (Experimental, opt-in).
    #[serde(rename = "claude-code-cli")]
    ClaudeCodeCli,
    /// The user's own OpenAI Codex CLI and its sign-in (Experimental, opt-in).
    #[serde(rename = "codex-cli")]
    CodexCli,
    /// The user's own Google Gemini CLI and its sign-in (Experimental, opt-in).
    #[serde(rename = "gemini-cli")]
    GeminiCli,
    /// The user's own Cursor CLI (`cursor-agent`) and its sign-in (Experimental, opt-in).
    #[serde(rename = "cursor-cli")]
    CursorCli,
    /// The user's own GitHub Copilot CLI and its sign-in (Experimental, opt-in).
    #[serde(rename = "copilot-cli")]
    CopilotCli,
    /// The user's own OpenCode and its provider sign-ins (Experimental, opt-in).
    #[serde(rename = "opencode-cli")]
    OpencodeCli,
    /// The user's own Qwen Code CLI and its sign-in (Experimental, opt-in).
    #[serde(rename = "qwen-code-cli")]
    QwenCodeCli,
}

impl ModelProvider {
    /// The graphrt provider name, identical to the serde name.
    pub fn registry_name(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::Deepseek => "deepseek",
            Self::Ollama => "ollama",
            Self::ClaudeCodeCli => "claude-code-cli",
            Self::CodexCli => "codex-cli",
            Self::GeminiCli => "gemini-cli",
            Self::CursorCli => "cursor-cli",
            Self::CopilotCli => "copilot-cli",
            Self::OpencodeCli => "opencode-cli",
            Self::QwenCodeCli => "qwen-code-cli",
        }
    }

    /// Parses a provider name as stored in settings.
    fn from_registry_name(name: &str) -> Option<Self> {
        ALL_PROVIDERS.into_iter().find(|provider| provider.registry_name() == name)
    }

    /// Every provider the app knows.
    pub(crate) fn all() -> [ModelProvider; 12] {
        ALL_PROVIDERS
    }

    /// The local CLI behind this provider, if it is one.
    pub fn local_cli(self) -> Option<LocalCli> {
        LocalCli::from_provider_name(self.registry_name())
    }

    /// The provider of a local CLI (they share the provider name).
    pub fn for_local_cli(cli: LocalCli) -> Self {
        Self::from_registry_name(cli.provider_name()).expect("every local CLI has a model provider")
    }

    /// Whether the provider takes an API key (not Ollama, not the local CLIs).
    pub fn uses_api_key(self) -> bool {
        self != Self::Ollama && self.local_cli().is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: ModelProvider,
    /// A key is stored (always true for Ollama; for a local CLI: turned on and installed).
    pub configured: bool,
    /// Only for Ollama.
    pub base_url: Option<String>,
    /// Only for the local CLIs: detection and whether the user turned it on.
    pub local_cli: Option<LocalCliStatus>,
}

/// The model new agents use, e.g. `{ provider: openai, name: gpt-4o-mini }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub provider: ModelProvider,
    pub name: String,
}

/// Opens the keychain entry of `(service, account)`.
type OpenKeychainEntry = fn(&str, &str) -> keyring::Result<keyring::Entry>;

/// The OS keychain: one entry per account under `service`.
struct Keychain {
    service: String,
    /// `keyring::Entry::new` in the app; tests swap in a keychain that fails the way a
    /// broken one does.
    open_entry: OpenKeychainEntry,
}

impl Keychain {
    /// The stored value of `account`, or `None` when there is none. A keychain that
    /// cannot hold anything yet (see [`CredentialStoreProblem::holds_no_secrets`]) has
    /// none either, so what needs no key keeps working there.
    fn read(&self, account: &str) -> keyring::Result<Option<String>> {
        match (self.open_entry)(&self.service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(error) if is_absent(&error) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Saves or replaces the value of `account`.
    fn save(&self, account: &str, value: &str) -> keyring::Result<()> {
        (self.open_entry)(&self.service, account)?.set_password(value)
    }

    /// Removes the value of `account`; succeeds if none was stored.
    fn delete(&self, account: &str) -> keyring::Result<()> {
        match (self.open_entry)(&self.service, account)?.delete_credential() {
            Err(error) if is_absent(&error) => Ok(()),
            result => result,
        }
    }
}

/// Whether a read or delete failed only because nothing is stored: no such entry, or a
/// keychain that holds no secrets at all (logged once, since every read hits it).
fn is_absent(error: &keyring::Error) -> bool {
    if matches!(error, keyring::Error::NoEntry) {
        return true;
    }
    match credential_store_problem(error) {
        Some(problem) if problem.holds_no_secrets() => {
            static LOGGED: std::sync::Once = std::sync::Once::new();
            LOGGED.call_once(|| log::warn!("treating every key as not set: {} ({error})", problem.message()));
            true
        }
        _ => false,
    }
}

/// Why the Secret Service (Linux) cannot be used, if `error` is one of the known cases.
///
/// `keyring` reports them as generic storage failures wrapping the D-Bus client's error:
/// - no default collection: looking up an entry that does not exist falls back to the
///   default collection, and saving creates the item there (`NoResult`);
/// - no secret service, or no session bus to reach one (`ServiceUnknown` and the like);
/// - a locked collection, or an unlock prompt the user dismissed.
#[cfg(target_os = "linux")]
fn credential_store_problem(error: &keyring::Error) -> Option<CredentialStoreProblem> {
    use dbus_secret_service::Error as SecretServiceError;

    /// D-Bus errors that mean nothing answers on the secret service name, or there is no bus.
    const NOT_RUNNING_DBUS_ERRORS: [&str; 5] = [
        "org.freedesktop.DBus.Error.ServiceUnknown",
        "org.freedesktop.DBus.Error.NameHasNoOwner",
        "org.freedesktop.DBus.Error.FileNotFound",
        "org.freedesktop.DBus.Error.NoServer",
        "org.freedesktop.DBus.Error.NotSupported",
    ];

    let (keyring::Error::NoStorageAccess(source) | keyring::Error::PlatformFailure(source)) = error else {
        return None;
    };
    match source.downcast_ref::<SecretServiceError>()? {
        SecretServiceError::NoResult => Some(CredentialStoreProblem::NoDefaultKeyring),
        SecretServiceError::Locked | SecretServiceError::Prompt => Some(CredentialStoreProblem::Locked),
        SecretServiceError::Unavailable => Some(CredentialStoreProblem::NotRunning),
        SecretServiceError::Dbus(dbus_error) => {
            let name = dbus_error.name()?;
            let not_running =
                NOT_RUNNING_DBUS_ERRORS.contains(&name) || name.starts_with("org.freedesktop.DBus.Error.Spawn.");
            not_running.then_some(CredentialStoreProblem::NotRunning)
        }
        _ => None,
    }
}

/// macOS Keychain and Windows Credential Manager are always there; their failures stay
/// plain credential store errors.
#[cfg(not(target_os = "linux"))]
fn credential_store_problem(_error: &keyring::Error) -> Option<CredentialStoreProblem> {
    None
}

/// Where keys are physically kept.
enum CredentialBackend {
    /// OS keychain; one entry per provider under `service`.
    Keychain(Keychain),
    /// Process memory only (tests).
    InMemory(Mutex<HashMap<ModelProvider, String>>),
}

/// Where keys are kept. `Keychain` in the app, `InMemory` in tests.
pub struct CredentialStore {
    backend: CredentialBackend,
    /// Workflow secrets for the in-memory backend (unused with the keychain).
    in_memory_workflow_secrets: Mutex<HashMap<String, String>>,
}

/// Shows the backend and which providers have keys, never the keys themselves.
impl fmt::Debug for CredentialStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.backend {
            CredentialBackend::Keychain(keychain) => formatter
                .debug_struct("CredentialStore")
                .field("backend", &"keychain")
                .field("service", &keychain.service)
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

/// Converts a keychain error into an `AppError` naming the provider and operation only
/// (or the keyring problem to fix, when it is a known one).
/// `keyring::Error`'s `Display` never includes the password, so it is safe to include.
fn keychain_error(operation: &str, provider: ModelProvider, error: &keyring::Error) -> AppError {
    if let Some(problem) = credential_store_problem(error) {
        return AppError::CredentialStoreUnavailable(problem);
    }
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
        Self::keychain_with_entries(service, keyring::Entry::new)
    }

    /// Store backed by a keychain whose entries `open_entry` opens.
    fn keychain_with_entries(service: &str, open_entry: OpenKeychainEntry) -> Self {
        Self {
            backend: CredentialBackend::Keychain(Keychain { service: service.to_owned(), open_entry }),
            in_memory_workflow_secrets: Mutex::new(HashMap::new()),
        }
    }

    /// Store that keeps keys in memory only (tests).
    pub fn in_memory() -> Self {
        Self {
            backend: CredentialBackend::InMemory(Mutex::new(HashMap::new())),
            in_memory_workflow_secrets: Mutex::new(HashMap::new()),
        }
    }

    /// Saves or replaces a provider key. Rejects empty keys and `Ollama`.
    pub fn set_api_key(&self, provider: ModelProvider, api_key: &str) -> AppResult<()> {
        if provider == ModelProvider::Ollama {
            return Err(AppError::InvalidInput("Ollama does not use an API key".into()));
        }
        if let Some(cli) = provider.local_cli() {
            return Err(AppError::InvalidInput(format!(
                "{} uses its own sign-in on this computer, not an API key",
                cli.display_name()
            )));
        }
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::InvalidInput("API key is empty".into()));
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => keychain
                .save(provider.registry_name(), api_key)
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
            CredentialBackend::Keychain(keychain) => {
                keychain.delete(provider.registry_name()).map_err(|error| keychain_error("delete", provider, &error))
            }
            CredentialBackend::InMemory(keys) => {
                lock_keys(keys)?.remove(&provider);
                Ok(())
            }
        }
    }

    /// Backend-only access to a key. Never expose through a command.
    pub(crate) fn read_api_key(&self, provider: ModelProvider) -> AppResult<Option<String>> {
        if !provider.uses_api_key() {
            return Ok(None);
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.read(provider.registry_name()).map_err(|error| keychain_error("read", provider, &error))
            }
            CredentialBackend::InMemory(keys) => Ok(lock_keys(keys)?.get(&provider).cloned()),
        }
    }

    /// Whether a key is stored for `provider` (always true for Ollama; a local CLI
    /// counts when the user turned it on and it is installed).
    fn is_configured(&self, provider: ModelProvider, db: &Database) -> AppResult<bool> {
        if provider == ModelProvider::Ollama {
            return Ok(true);
        }
        if let Some(cli) = provider.local_cli() {
            return Ok(local_cli::is_enabled(cli, db) && local_cli::detect::cached(cli, false).binary.is_some());
        }
        Ok(self.read_api_key(provider)?.is_some())
    }

    /// Saves or replaces a workflow secret (`env.<NAME>` in workflow documents),
    /// shared by every agent that declares the same name.
    pub fn set_workflow_secret(&self, name: &str, value: &str) -> AppResult<()> {
        validate_workflow_secret_name(name)?;
        let value = value.trim();
        if value.is_empty() {
            return Err(AppError::InvalidInput(format!("the value for {name} is empty")));
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => keychain
                .save(&workflow_secret_account(name), value)
                .map_err(|error| secret_keychain_error("save", name, &error)),
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.insert(name.to_owned(), value.to_owned());
                Ok(())
            }
        }
    }

    /// Removes a workflow secret; succeeds if none was stored.
    pub fn delete_workflow_secret(&self, name: &str) -> AppResult<()> {
        validate_workflow_secret_name(name)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => keychain
                .delete(&workflow_secret_account(name))
                .map_err(|error| secret_keychain_error("delete", name, &error)),
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.remove(name);
                Ok(())
            }
        }
    }

    /// Backend-only access to a workflow secret. Never expose through a command.
    pub(crate) fn read_workflow_secret(&self, name: &str) -> AppResult<Option<String>> {
        validate_workflow_secret_name(name)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => keychain
                .read(&workflow_secret_account(name))
                .map_err(|error| secret_keychain_error("read", name, &error)),
            CredentialBackend::InMemory(_) => Ok(lock_secrets(&self.in_memory_workflow_secrets)?.get(name).cloned()),
        }
    }

    /// Whether a workflow secret is stored, without reading it out.
    pub fn has_workflow_secret(&self, name: &str) -> AppResult<bool> {
        Ok(self.read_workflow_secret(name)?.is_some())
    }

    pub fn provider_statuses(&self, db: &Database) -> AppResult<Vec<ProviderStatus>> {
        ALL_PROVIDERS
            .into_iter()
            .map(|provider| {
                let base_url = (provider == ModelProvider::Ollama).then(|| ollama_base_url(db));
                let Some(cli) = provider.local_cli() else {
                    return Ok(ProviderStatus {
                        provider,
                        configured: self.is_configured(provider, db)?,
                        base_url,
                        local_cli: None,
                    });
                };
                let status = local_cli::status(cli, db);
                Ok(ProviderStatus {
                    provider,
                    configured: status.enabled && status.installed,
                    base_url,
                    local_cli: Some(status),
                })
            })
            .collect()
    }
}

/// Plugin settings: the environment variables a plugin's manifest requests
/// (`permissions.env`, e.g. `WHATSAPP_ACCESS_TOKEN`), one keychain entry per
/// plugin and variable under the account `plugin:<plugin>:<VARIABLE>`.
///
/// They use their own account prefix rather than workflow secrets, so a
/// workflow declaring `env.<NAME>` can never read a plugin's token, and two
/// plugins requesting the same variable name keep separate values.
impl CredentialStore {
    /// Saves or replaces a plugin setting. Rejects empty values.
    pub fn set_plugin_config(&self, plugin: &str, variable: &str, value: &str) -> AppResult<()> {
        let account = plugin_config_account(plugin, variable)?;
        let value = value.trim();
        if value.is_empty() {
            return Err(AppError::InvalidInput(format!("the value for {variable} is empty")));
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.save(&account, value).map_err(|error| secret_keychain_error("save", variable, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.insert(account, value.to_owned());
                Ok(())
            }
        }
    }

    /// Removes a plugin setting; succeeds if none was stored.
    pub fn delete_plugin_config(&self, plugin: &str, variable: &str) -> AppResult<()> {
        let account = plugin_config_account(plugin, variable)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.delete(&account).map_err(|error| secret_keychain_error("delete", variable, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.remove(&account);
                Ok(())
            }
        }
    }

    /// Backend-only access to a plugin setting (passed to the plugin process).
    /// Never expose through a command.
    pub(crate) fn read_plugin_config(&self, plugin: &str, variable: &str) -> AppResult<Option<String>> {
        let account = plugin_config_account(plugin, variable)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.read(&account).map_err(|error| secret_keychain_error("read", variable, &error))
            }
            CredentialBackend::InMemory(_) => {
                Ok(lock_secrets(&self.in_memory_workflow_secrets)?.get(&account).cloned())
            }
        }
    }

    /// Whether a plugin setting is stored, without handing it out.
    pub fn has_plugin_config(&self, plugin: &str, variable: &str) -> AppResult<bool> {
        Ok(self.read_plugin_config(plugin, variable)?.is_some())
    }
}

/// "Put it online" credentials: online provider accounts (`deploy:account:<provider>`), the API
/// key of each deployment (`deploy:key:<agent id>`) and of each connected server
/// (`deploy:server:<id>`). Their own prefix keeps them apart from provider keys, workflow
/// secrets and plugin settings, so no workflow can read them.
impl CredentialStore {
    /// Saves or replaces a deploy credential under `deploy:<name>`. Rejects empty values.
    pub fn set_deploy_secret(&self, name: &str, value: &str) -> AppResult<()> {
        let account = deploy_secret_account(name)?;
        if value.trim().is_empty() {
            return Err(AppError::InvalidInput("the value is empty".into()));
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.save(&account, value).map_err(|error| secret_keychain_error("save", name, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.insert(account, value.to_owned());
                Ok(())
            }
        }
    }

    /// Removes a deploy credential; succeeds if none was stored.
    pub fn delete_deploy_secret(&self, name: &str) -> AppResult<()> {
        let account = deploy_secret_account(name)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.delete(&account).map_err(|error| secret_keychain_error("delete", name, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.remove(&account);
                Ok(())
            }
        }
    }

    /// Backend-only access to a deploy credential (handed to the graphrt process as an
    /// environment variable, or used for a request). Never expose through a command.
    pub(crate) fn read_deploy_secret(&self, name: &str) -> AppResult<Option<String>> {
        let account = deploy_secret_account(name)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.read(&account).map_err(|error| secret_keychain_error("read", name, &error))
            }
            CredentialBackend::InMemory(_) => {
                Ok(lock_secrets(&self.in_memory_workflow_secrets)?.get(&account).cloned())
            }
        }
    }

    /// Backend-only: a model provider's API key, for copying it to an online deployment.
    pub(crate) fn read_provider_key_for_deploy(&self, provider: ModelProvider) -> AppResult<Option<String>> {
        self.read_api_key(provider)
    }
}

/// MCP OAuth sign-ins (`mcp-oauth:<server>:<part>`): the sign-in session (endpoints and
/// client id, no secret), the access token and the refresh token of each MCP server the user
/// signed in to. Their own prefix keeps them apart from workflow secrets, so no workflow can
/// read them; they are split in parts to stay under Windows' credential size limit.
impl CredentialStore {
    /// Saves or replaces one part of a server's sign-in. Rejects empty values.
    pub fn set_mcp_oauth(&self, server: &str, part: McpOAuthPart, value: &str) -> AppResult<()> {
        let account = mcp_oauth_account(server, part)?;
        if value.trim().is_empty() {
            return Err(AppError::InvalidInput("the value is empty".into()));
        }
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.save(&account, value).map_err(|error| secret_keychain_error("save", &account, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.insert(account, value.to_owned());
                Ok(())
            }
        }
    }

    /// Removes one part of a server's sign-in; succeeds if none was stored.
    pub fn delete_mcp_oauth(&self, server: &str, part: McpOAuthPart) -> AppResult<()> {
        let account = mcp_oauth_account(server, part)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.delete(&account).map_err(|error| secret_keychain_error("delete", &account, &error))
            }
            CredentialBackend::InMemory(_) => {
                lock_secrets(&self.in_memory_workflow_secrets)?.remove(&account);
                Ok(())
            }
        }
    }

    /// Backend-only access to one part of a server's sign-in. Never expose through a command.
    pub(crate) fn read_mcp_oauth(&self, server: &str, part: McpOAuthPart) -> AppResult<Option<String>> {
        let account = mcp_oauth_account(server, part)?;
        match &self.backend {
            CredentialBackend::Keychain(keychain) => {
                keychain.read(&account).map_err(|error| secret_keychain_error("read", &account, &error))
            }
            CredentialBackend::InMemory(_) => {
                Ok(lock_secrets(&self.in_memory_workflow_secrets)?.get(&account).cloned())
            }
        }
    }
}

/// One stored part of an MCP server's OAuth sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpOAuthPart {
    /// Endpoints, client id and status (JSON, no secret).
    Session,
    /// Access token and its expiry (JSON).
    AccessToken,
    /// Refresh token.
    RefreshToken,
}

impl McpOAuthPart {
    pub const ALL: [McpOAuthPart; 3] = [McpOAuthPart::Session, McpOAuthPart::AccessToken, McpOAuthPart::RefreshToken];

    fn suffix(self) -> &'static str {
        match self {
            McpOAuthPart::Session => "session",
            McpOAuthPart::AccessToken => "access",
            McpOAuthPart::RefreshToken => "refresh",
        }
    }
}

/// Keychain account prefix of MCP OAuth sign-ins.
const MCP_OAUTH_ACCOUNT_PREFIX: &str = "mcp-oauth:";

/// `mcp-oauth:<server>:<part>`; `server` is an MCP server name (lowercase letters, digits, `-`, `_`).
fn mcp_oauth_account(server: &str, part: McpOAuthPart) -> AppResult<String> {
    let valid = !server.is_empty()
        && server.len() <= 40
        && server.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte));
    if !valid {
        return Err(AppError::InvalidInput(format!("`{server}` is not a valid MCP server name")));
    }
    Ok(format!("{MCP_OAUTH_ACCOUNT_PREFIX}{server}:{}", part.suffix()))
}

/// Keychain account prefix of "Put it online" credentials.
const DEPLOY_SECRET_ACCOUNT_PREFIX: &str = "deploy:";

/// `deploy:<name>`; `name` is lowercase letters, digits and `:_-` (an id or provider key).
fn deploy_secret_account(name: &str) -> AppResult<String> {
    let valid = !name.is_empty()
        && name.len() <= 128
        && name.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b":_-".contains(&byte));
    if !valid {
        return Err(AppError::InvalidInput(format!("`{name}` is not a valid credential name")));
    }
    Ok(format!("{DEPLOY_SECRET_ACCOUNT_PREFIX}{name}"))
}

/// Keychain account prefix of plugin settings (`plugin:<plugin>:<VARIABLE>`).
const PLUGIN_CONFIG_ACCOUNT_PREFIX: &str = "plugin:";

/// The keychain account of one plugin setting; validates both names.
fn plugin_config_account(plugin: &str, variable: &str) -> AppResult<String> {
    if !graphrt_plugin::is_valid_name(plugin) {
        return Err(AppError::InvalidInput(format!("`{plugin}` is not a valid plugin name")));
    }
    validate_workflow_secret_name(variable)?;
    Ok(format!("{PLUGIN_CONFIG_ACCOUNT_PREFIX}{plugin}:{variable}"))
}

/// Keychain account prefix that keeps workflow secrets apart from provider keys.
const WORKFLOW_SECRET_ACCOUNT_PREFIX: &str = "env:";
const WORKFLOW_SECRET_NAME_MAX_LENGTH: usize = 64;

/// Workflow secret names follow environment-variable style: `GOOGLE_PLACES_KEY`.
fn validate_workflow_secret_name(name: &str) -> AppResult<()> {
    let is_valid = !name.is_empty()
        && name.len() <= WORKFLOW_SECRET_NAME_MAX_LENGTH
        && name.chars().all(|character| character.is_ascii_alphanumeric() || character == '_')
        && !name.starts_with(|character: char| character.is_ascii_digit());
    if is_valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "secret names use letters, digits and underscores, start with a letter and are at most \
             {WORKFLOW_SECRET_NAME_MAX_LENGTH} characters"
        )))
    }
}

/// `env:<NAME>`, the keychain account of a workflow secret.
fn workflow_secret_account(name: &str) -> String {
    format!("{WORKFLOW_SECRET_ACCOUNT_PREFIX}{name}")
}

/// Names the secret and operation only (or the keyring problem to fix, when it is a known
/// one); `keyring::Error` never includes the value.
fn secret_keychain_error(operation: &str, name: &str, error: &keyring::Error) -> AppError {
    if let Some(problem) = credential_store_problem(error) {
        return AppError::CredentialStoreUnavailable(problem);
    }
    AppError::Credentials(format!("could not {operation} the secret {name}: {error}"))
}

fn lock_secrets(secrets: &Mutex<HashMap<String, String>>) -> AppResult<MutexGuard<'_, HashMap<String, String>>> {
    secrets.lock().map_err(|_| AppError::Internal("secret store lock poisoned".into()))
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
pub(crate) fn ollama_base_url(db: &Database) -> String {
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
        ModelProvider::Deepseek => {
            // Default config sends `max_tokens`, which DeepSeek expects.
            let config = OpenAiConfig::new(DEEPSEEK_BASE_URL, Some(api_key));
            Arc::new(OpenAiModel::new(config).map_err(|error| model_error(provider, &error))?)
        }
        ModelProvider::Ollama
        | ModelProvider::ClaudeCodeCli
        | ModelProvider::CodexCli
        | ModelProvider::GeminiCli
        | ModelProvider::CursorCli
        | ModelProvider::CopilotCli
        | ModelProvider::OpencodeCli
        | ModelProvider::QwenCodeCli => {
            return Err(AppError::Internal(format!("{} does not use an API key", provider.registry_name())))
        }
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
    add_local_cli_models(&mut registry, db, |cli| local_cli::detect::cached(cli, false));
    Ok(registry)
}

/// Adds every local CLI the user turned on and that is installed. `detect` gives the
/// detection of one CLI (cached in the app, scripted in tests).
pub(crate) fn add_local_cli_models(
    registry: &mut ModelRegistry,
    db: &Database,
    detect: impl Fn(LocalCli) -> Arc<local_cli::detect::Detection>,
) {
    for cli in LocalCli::ALL.into_iter().filter(|cli| local_cli::is_enabled(*cli, db)) {
        let detection = detect(cli);
        if detection.binary.is_some() {
            registry.add(cli.provider_name(), Arc::new(local_cli::LocalCliModel::new(cli, detection)));
        }
    }
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
        if store.is_configured(choice.provider, db)? {
            return Ok(choice);
        }
    }
    for (provider, model_name) in RECOMMENDED_MODELS {
        if store.is_configured(provider, db)? {
            return Ok(ModelChoice { provider, name: model_name.to_owned() });
        }
    }
    // A local CLI the user turned on, with its own default model, before giving up.
    for cli in LocalCli::ALL {
        let provider = ModelProvider::for_local_cli(cli);
        if store.is_configured(provider, db)? {
            return Ok(ModelChoice { provider, name: local_cli::CLI_DEFAULT_MODEL.to_owned() });
        }
    }
    Err(AppError::MissingCredentials(NO_MODEL_CONNECTED.into()))
}

/// What `MissingCredentials` names when no model can be used at all.
pub const NO_MODEL_CONNECTED: &str =
    "an AI model (connect Claude Code, Codex, another AI tool on this computer, Ollama or an API key in Connections > AI models)";

/// Whether `provider` can be used right now (key stored, Ollama, or a CLI turned on and installed).
pub fn is_provider_ready(store: &CredentialStore, db: &Database, provider: ModelProvider) -> AppResult<bool> {
    store.is_configured(provider, db)
}

/// Turns a local CLI on or off. Turning on needs it installed; turning off the
/// default model's provider clears that default, so the next usable model takes over.
///
/// # Errors
/// `InvalidInput` for a provider that is not a local CLI, or turning on one that is
/// not installed; settings failures.
pub fn set_local_cli_enabled(
    store: &CredentialStore,
    db: &Database,
    provider: ModelProvider,
    enabled: bool,
) -> AppResult<ProviderStatus> {
    let cli = provider
        .local_cli()
        .ok_or_else(|| AppError::InvalidInput(format!("{} is not a local CLI", provider.registry_name())))?;
    if enabled && local_cli::detect::cached(cli, true).binary.is_none() {
        return Err(AppError::InvalidInput(format!(
            "{} is not installed on this computer: install it from {} first",
            cli.display_name(),
            cli.install_url()
        )));
    }
    db.set_setting(cli.enabled_setting_key(), if enabled { "true" } else { "false" })?;
    let is_default = model_from_settings(db).is_some_and(|choice| choice.provider == provider);
    if !enabled && is_default {
        db.set_setting(SETTING_DEFAULT_PROVIDER, "")?;
        db.set_setting(SETTING_DEFAULT_MODEL, "")?;
    }
    store
        .provider_statuses(db)?
        .into_iter()
        .find(|status| status.provider == provider)
        .ok_or_else(|| AppError::Internal("provider status missing".into()))
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
        assert_eq!(configured, vec![false, true, false, false, true, false, false, false, false, false, false, false]);
        assert!(statuses[5..].iter().all(|status| status.local_cli.is_some()), "every local CLI reports its detection");
        assert_eq!(statuses[4].base_url.as_deref(), Some(DEFAULT_OLLAMA_BASE_URL));
        assert!(statuses[..4].iter().all(|status| status.base_url.is_none()));
        assert!(statuses[..5].iter().all(|status| status.local_cli.is_none()));
        let claude_code = statuses[5].local_cli.as_ref().expect("local CLI providers report their detection");
        assert!(!claude_code.enabled);
        assert_eq!(claude_code.install_url, "https://docs.claude.com/en/docs/claude-code/setup");
    }

    #[test]
    fn local_cli_providers_take_no_key_and_need_an_install_to_turn_on() {
        let store = CredentialStore::in_memory();
        let db = test_database();
        let result = store.set_api_key(ModelProvider::ClaudeCodeCli, SECRET_KEY);
        assert!(
            matches!(result, Err(AppError::InvalidInput(ref message)) if message.contains("own sign-in")),
            "{result:?}"
        );
        assert_eq!(store.read_api_key(ModelProvider::CodexCli).unwrap(), None);
        // Tests never find real CLIs, so turning one on is refused with the install link.
        let result = set_local_cli_enabled(&store, &db, ModelProvider::CodexCli, true);
        assert!(
            matches!(result, Err(AppError::InvalidInput(ref message)) if message.contains("developers.openai.com")),
            "{result:?}"
        );
        assert!(set_local_cli_enabled(&store, &db, ModelProvider::Openai, true).is_err());
    }

    #[test]
    fn turning_off_the_default_cli_clears_the_default() {
        let store = CredentialStore::in_memory();
        let db = test_database();
        store.set_api_key(ModelProvider::Gemini, SECRET_KEY).unwrap();
        db.set_setting(SETTING_DEFAULT_PROVIDER, "claude-code-cli").unwrap();
        db.set_setting(SETTING_DEFAULT_MODEL, "default").unwrap();
        let status = set_local_cli_enabled(&store, &db, ModelProvider::ClaudeCodeCli, false).unwrap();
        assert!(!status.configured);
        assert_eq!(model_from_settings(&db), None);
        assert_eq!(default_model(&store, &db).unwrap().provider, ModelProvider::Gemini);
        assert_eq!(serde_json::to_value(ModelProvider::ClaudeCodeCli).unwrap(), "claude-code-cli");
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
        assert_eq!(registry.names().collect::<Vec<_>>(), vec!["openai", "anthropic", "gemini", "deepseek", "ollama"]);
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

        store.set_api_key(ModelProvider::Deepseek, SECRET_KEY).unwrap();
        let choice = default_model(&store, &db).unwrap();
        assert_eq!(choice, ModelChoice { provider: ModelProvider::Deepseek, name: "deepseek-chat".into() });

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

    #[test]
    fn workflow_secret_round_trip_and_replace() {
        let store = CredentialStore::in_memory();
        assert!(!store.has_workflow_secret("MAPS_API_KEY").unwrap());
        store.set_workflow_secret("MAPS_API_KEY", "  first  ").unwrap();
        assert_eq!(store.read_workflow_secret("MAPS_API_KEY").unwrap().as_deref(), Some("first"));
        store.set_workflow_secret("MAPS_API_KEY", "second").unwrap();
        assert_eq!(store.read_workflow_secret("MAPS_API_KEY").unwrap().as_deref(), Some("second"));
        store.delete_workflow_secret("MAPS_API_KEY").unwrap();
        assert!(!store.has_workflow_secret("MAPS_API_KEY").unwrap());
        store.delete_workflow_secret("MAPS_API_KEY").unwrap();
    }

    #[test]
    fn workflow_secrets_are_separate_from_provider_keys() {
        let store = CredentialStore::in_memory();
        store.set_api_key(ModelProvider::Openai, "sk-model").unwrap();
        assert!(!store.has_workflow_secret("openai").unwrap());
        store.set_workflow_secret("OPENAI", "sk-other").unwrap();
        assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap().as_deref(), Some("sk-model"));
    }

    #[test]
    fn invalid_workflow_secret_names_and_empty_values_are_rejected() {
        let store = CredentialStore::in_memory();
        for name in ["", "1KEY", "MY-KEY", "KEY NAME", "env:KEY", &"K".repeat(65)] {
            assert!(matches!(store.set_workflow_secret(name, "value"), Err(AppError::InvalidInput(_))), "{name}");
        }
        assert!(matches!(store.set_workflow_secret("MAPS_API_KEY", "   "), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn debug_output_never_contains_workflow_secret() {
        let store = CredentialStore::in_memory();
        store.set_workflow_secret("WHATSAPP_TOKEN", "super-secret-token").unwrap();
        assert!(!format!("{store:?}").contains("super-secret-token"));
    }

    /// The Secret Service states that broke a fresh Linux install: each fake keychain
    /// fails every call with the exact error `keyring` returns in that state.
    #[cfg(target_os = "linux")]
    mod unusable_keyring {
        use dbus_secret_service::Error as SecretServiceError;

        use super::*;

        /// A keychain entry whose every call fails with `error()`.
        struct FailingCredential {
            error: fn() -> keyring::Error,
        }

        impl keyring::credential::CredentialApi for FailingCredential {
            fn set_secret(&self, _secret: &[u8]) -> keyring::Result<()> {
                Err((self.error)())
            }

            fn get_secret(&self) -> keyring::Result<Vec<u8>> {
                Err((self.error)())
            }

            fn delete_credential(&self) -> keyring::Result<()> {
                Err((self.error)())
            }

            fn as_any(&self) -> &dyn std::any::Any {
                self
            }
        }

        /// Opens entries that fail with `error()`.
        fn failing_entry(error: fn() -> keyring::Error) -> keyring::Result<keyring::Entry> {
            Ok(keyring::Entry::new_with_credential(Box::new(FailingCredential { error })))
        }

        fn store_failing_with(open_entry: OpenKeychainEntry) -> CredentialStore {
            CredentialStore::keychain_with_entries("dev.graphrt.desktop.test", open_entry)
        }

        const NO_DEFAULT_COLLECTION: OpenKeychainEntry = |_, _| failing_entry(no_default_collection);
        const NO_SECRET_SERVICE: OpenKeychainEntry = |_, _| failing_entry(no_secret_service);
        const LOCKED_COLLECTION: OpenKeychainEntry = |_, _| failing_entry(locked_collection);
        const UNKNOWN_FAILURE: OpenKeychainEntry = |_, _| failing_entry(unknown_failure);

        /// GNOME Keyring on a fresh install: the service answers, but the `default`
        /// alias points to no collection.
        fn no_default_collection() -> keyring::Error {
            keyring::Error::NoStorageAccess(Box::new(SecretServiceError::NoResult))
        }

        /// No keyring installed: nothing owns `org.freedesktop.secrets` on the session bus.
        fn no_secret_service() -> keyring::Error {
            let dbus_error = dbus::Error::new_custom(
                "org.freedesktop.DBus.Error.ServiceUnknown",
                "The name org.freedesktop.secrets was not provided by any .service files",
            );
            keyring::Error::PlatformFailure(Box::new(SecretServiceError::Dbus(dbus_error)))
        }

        /// The keyring is locked and the user dismissed the unlock prompt.
        fn locked_collection() -> keyring::Error {
            keyring::Error::NoStorageAccess(Box::new(SecretServiceError::Prompt))
        }

        /// A failure the app has no advice for.
        fn unknown_failure() -> keyring::Error {
            keyring::Error::PlatformFailure(Box::new(SecretServiceError::Parse))
        }

        #[test]
        fn keys_read_as_not_set_when_the_keyring_holds_nothing() {
            for (keychain, state) in
                [(NO_DEFAULT_COLLECTION, "no default collection"), (NO_SECRET_SERVICE, "no secret service")]
            {
                let store = store_failing_with(keychain);
                assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap(), None, "{state}");
                assert_eq!(store.read_workflow_secret("MAPS_KEY").unwrap(), None, "{state}");
                assert!(!store.has_plugin_config("whatsapp", "WHATSAPP_ACCESS_TOKEN").unwrap(), "{state}");
                assert_eq!(store.read_deploy_secret("key:agent-1").unwrap(), None, "{state}");
                assert_eq!(store.read_mcp_oauth("notion", McpOAuthPart::AccessToken).unwrap(), None, "{state}");
                store.delete_api_key(ModelProvider::Openai).expect("deleting a key that cannot exist succeeds");
                store.delete_workflow_secret("MAPS_KEY").expect("deleting a secret that cannot exist succeeds");
            }
        }

        /// The bug: a flow that only uses local Ollama failed with "credential store
        /// error: could not read the openai key" because building the registry reads
        /// every provider key.
        #[test]
        fn ollama_stays_usable_without_a_default_keyring() {
            let store = store_failing_with(NO_DEFAULT_COLLECTION);
            let db = test_database();

            let registry = build_model_registry(&store, &db).expect("the registry builds without any key");
            assert_eq!(registry.names().collect::<Vec<_>>(), ["ollama"]);

            let statuses = store.provider_statuses(&db).unwrap();
            let configured: Vec<ModelProvider> =
                statuses.iter().filter(|status| status.configured).map(|status| status.provider).collect();
            assert_eq!(configured, vec![ModelProvider::Ollama]);

            db.set_setting(SETTING_DEFAULT_PROVIDER, "ollama").unwrap();
            db.set_setting(SETTING_DEFAULT_MODEL, "llama3.2").unwrap();
            assert_eq!(default_model(&store, &db).unwrap().provider, ModelProvider::Ollama);
        }

        #[test]
        fn saving_explains_how_to_fix_the_keyring() {
            for (keychain, problem) in [
                (NO_DEFAULT_COLLECTION, CredentialStoreProblem::NoDefaultKeyring),
                (NO_SECRET_SERVICE, CredentialStoreProblem::NotRunning),
                (LOCKED_COLLECTION, CredentialStoreProblem::Locked),
            ] {
                let store = store_failing_with(keychain);
                let saves = [
                    store.set_api_key(ModelProvider::Openai, SECRET_KEY),
                    store.set_workflow_secret("MAPS_KEY", SECRET_KEY),
                    store.set_plugin_config("whatsapp", "WHATSAPP_ACCESS_TOKEN", SECRET_KEY),
                    store.set_deploy_secret("key:agent-1", SECRET_KEY),
                    store.set_mcp_oauth("notion", McpOAuthPart::AccessToken, SECRET_KEY),
                ];
                for save in saves {
                    let save_error = save.expect_err("nothing can be saved");
                    assert!(
                        matches!(save_error, AppError::CredentialStoreUnavailable(found) if found == problem),
                        "{problem:?}: {save_error:?}"
                    );
                    assert_eq!(save_error.to_string(), problem.message());
                    assert!(!save_error.to_string().contains(SECRET_KEY));
                }
            }
        }

        /// A locked keyring may hold keys, so reading one is an error, never "not set".
        #[test]
        fn a_locked_keyring_is_not_read_as_empty() {
            let store = store_failing_with(LOCKED_COLLECTION);
            let read_error = store.read_api_key(ModelProvider::Openai).expect_err("a locked keyring cannot be read");
            assert!(matches!(read_error, AppError::CredentialStoreUnavailable(CredentialStoreProblem::Locked)));
            assert!(build_model_registry(&store, &test_database()).is_err());
        }

        #[test]
        fn other_keyring_failures_stay_credential_errors() {
            let store = store_failing_with(UNKNOWN_FAILURE);
            let read_error = store.read_api_key(ModelProvider::Openai).expect_err("the failure is reported");
            assert!(matches!(read_error, AppError::Credentials(_)), "{read_error:?}");
            let save_error = store.set_api_key(ModelProvider::Openai, SECRET_KEY).expect_err("the failure is reported");
            assert!(matches!(save_error, AppError::Credentials(_)), "{save_error:?}");
        }

        /// Talks to the real Secret Service of a session that has no default keyring. Run in
        /// a throwaway session, with XDG_DATA_HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR
        /// pointing to empty directories:
        /// `dbus-run-session -- cargo test real_secret_service_without_default_keyring -- --ignored`
        #[test]
        #[ignore]
        fn real_secret_service_without_default_keyring() {
            let service = format!("dev.graphrt.desktop.test.{}", uuid::Uuid::new_v4());
            let store = CredentialStore::keychain_for_service(&service);

            assert_eq!(store.read_api_key(ModelProvider::Openai).unwrap(), None);
            store.delete_api_key(ModelProvider::Openai).unwrap();
            assert!(build_model_registry(&store, &test_database()).unwrap().names().any(|name| name == "ollama"));
            let save_error = store.set_api_key(ModelProvider::Openai, SECRET_KEY).expect_err("there is no keyring");
            assert!(
                matches!(save_error, AppError::CredentialStoreUnavailable(CredentialStoreProblem::NoDefaultKeyring)),
                "{save_error:?}"
            );
        }
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
