use tauri::State;

use crate::credentials::{
    self, ModelChoice, ModelProvider, ProviderStatus, SETTING_DEFAULT_MODEL, SETTING_DEFAULT_PROVIDER,
    SETTING_OLLAMA_BASE_URL, SETTING_WELCOME_CHOICE,
};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::local_cli::{self, LocalCli, LocalCliCheck};
use crate::state::AppState;

/// Runs blocking work (subprocess detection, keychain reads) off the async runtime.
async fn run_blocking<T: Send + 'static>(work: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| AppError::Internal(format!("a background task failed: {error}")))?
}

fn local_cli_of(provider: ModelProvider) -> AppResult<LocalCli> {
    provider.local_cli().ok_or_else(|| AppError::InvalidInput(format!("{} is not a local CLI", serde_name(provider))))
}

fn serde_name(provider: ModelProvider) -> String {
    serde_json::to_value(provider).ok().and_then(|name| name.as_str().map(str::to_owned)).unwrap_or_default()
}

#[tauri::command]
pub fn set_api_key(state: State<'_, AppState>, provider: ModelProvider, api_key: String) -> AppResult<()> {
    state.credentials.set_api_key(provider, api_key.trim())?;
    state.model_catalog.forget(provider);
    Ok(())
}

#[tauri::command]
pub fn delete_api_key(state: State<'_, AppState>, provider: ModelProvider) -> AppResult<()> {
    state.credentials.delete_api_key(provider)?;
    state.model_catalog.forget(provider);
    Ok(())
}

/// The chat models every connected provider offers, asked from the providers with the
/// stored keys (cached for ten minutes; `refresh` asks again). Keys are never returned.
#[tauri::command]
pub async fn list_available_models(
    state: State<'_, AppState>,
    refresh: Option<bool>,
) -> AppResult<Vec<crate::model_catalog::ProviderModels>> {
    state.model_catalog.list(&state.credentials, &state.db, refresh.unwrap_or(false)).await
}

/// Every provider's status. The local CLIs' detection is cached for a few minutes;
/// `refresh` looks for them again ("Detect again").
#[tauri::command]
pub async fn list_provider_statuses(
    state: State<'_, AppState>,
    refresh: Option<bool>,
) -> AppResult<Vec<ProviderStatus>> {
    let (credentials, db) = (state.credentials.clone(), state.db.clone());
    run_blocking(move || {
        if refresh.unwrap_or(false) {
            for cli in LocalCli::ALL {
                local_cli::detect::cached(cli, true);
            }
        }
        credentials.provider_statuses(&db)
    })
    .await
}

/// Turns a local CLI provider (Claude Code, Codex, Gemini CLI, …) on or off (Experimental, opt-in) and
/// returns its new status.
#[tauri::command]
pub async fn set_local_cli_enabled(
    state: State<'_, AppState>,
    provider: ModelProvider,
    enabled: bool,
) -> AppResult<ProviderStatus> {
    local_cli_of(provider)?;
    let (credentials, db) = (state.credentials.clone(), state.db.clone());
    let status = run_blocking(move || credentials::set_local_cli_enabled(&credentials, &db, provider, enabled)).await?;
    state.model_catalog.forget(provider);
    Ok(status)
}

/// "Check connection": one tiny prompt through the CLI (spends a little of the user's
/// plan), so only when the user asks.
#[tauri::command]
pub async fn check_local_cli(provider: ModelProvider) -> AppResult<LocalCliCheck> {
    let cli = local_cli_of(provider)?;
    let detection = run_blocking(move || Ok(local_cli::detect::cached(cli, false))).await?;
    Ok(local_cli::check_connection(cli, detection).await)
}

/// Where Ollama is downloaded from.
const OLLAMA_DOWNLOAD_URL: &str = "https://ollama.com/download";

/// Opens the official install page of a local CLI or Ollama in the default browser (fixed
/// addresses only; the frontend names the provider, never a URL).
#[tauri::command]
pub fn open_model_install_page(provider: ModelProvider) -> AppResult<()> {
    let url = match provider {
        ModelProvider::Ollama => OLLAMA_DOWNLOAD_URL,
        other => local_cli_of(other)?.install_url(),
    };
    crate::crash_reports::sharing::open_in_browser(url)
}

/// What the user picked on the Welcome screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WelcomeChoice {
    #[serde(rename = "claude-code-cli")]
    ClaudeCodeCli,
    #[serde(rename = "codex-cli")]
    CodexCli,
    #[serde(rename = "gemini-cli")]
    GeminiCli,
    #[serde(rename = "cursor-cli")]
    CursorCli,
    #[serde(rename = "copilot-cli")]
    CopilotCli,
    #[serde(rename = "opencode-cli")]
    OpencodeCli,
    #[serde(rename = "qwen-code-cli")]
    QwenCodeCli,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "api-key")]
    ApiKey,
    /// "Skip for now — explore first".
    #[serde(rename = "skip")]
    Skip,
}

/// The Welcome choice, or `None` before the first launch was finished.
#[tauri::command]
pub fn get_welcome_choice(state: State<'_, AppState>) -> AppResult<Option<WelcomeChoice>> {
    let stored = state.db.get_setting(SETTING_WELCOME_CHOICE)?;
    Ok(stored.and_then(|choice| serde_json::from_value(serde_json::Value::String(choice)).ok()))
}

#[tauri::command]
pub fn set_welcome_choice(state: State<'_, AppState>, choice: WelcomeChoice) -> AppResult<()> {
    let name = serde_json::to_value(choice)?;
    state.db.set_setting(SETTING_WELCOME_CHOICE, name.as_str().unwrap_or_default())
}

#[tauri::command]
pub fn get_default_model(state: State<'_, AppState>) -> AppResult<ModelChoice> {
    credentials::default_model(&state.credentials, &state.db)
}

#[tauri::command]
pub fn set_default_model(state: State<'_, AppState>, choice: ModelChoice) -> AppResult<()> {
    if choice.name.trim().is_empty() {
        return Err(AppError::InvalidInput("model name is empty".into()));
    }
    if let Some(cli) = choice.provider.local_cli() {
        if !credentials::is_provider_ready(&state.credentials, &state.db, choice.provider)? {
            return Err(AppError::InvalidInput(format!(
                "turn on {} in Connections > AI models first",
                cli.display_name()
            )));
        }
    }
    let provider_name = serde_json::to_value(choice.provider)?;
    let provider_name = provider_name.as_str().unwrap_or_default().to_owned();
    state.db.set_setting(SETTING_DEFAULT_PROVIDER, &provider_name)?;
    state.db.set_setting(SETTING_DEFAULT_MODEL, choice.name.trim())
}

#[tauri::command]
pub fn set_ollama_base_url(state: State<'_, AppState>, base_url: String) -> AppResult<()> {
    let trimmed = base_url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(AppError::InvalidInput("Ollama address must start with http:// or https://".into()));
    }
    state.db.set_setting(SETTING_OLLAMA_BASE_URL, trimmed)
}

/// One `env.*` value an agent's workflow needs, and whether it is set.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSecretStatus {
    pub name: String,
    pub description: Option<String>,
    pub is_secret: bool,
    /// No default in the document, so a run cannot start without it.
    pub required: bool,
    pub configured: bool,
}

/// The `env.*` values the agent's current version declares, with their status.
/// Values themselves are never returned.
#[tauri::command]
pub fn list_workflow_secrets(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<WorkflowSecretStatus>> {
    let agent = state.db.get_agent(&agent_id)?;
    let summary = flow::summarize_flow(&agent.flow_yaml)?;
    summary
        .env
        .into_iter()
        .map(|variable| {
            Ok(WorkflowSecretStatus {
                configured: state.credentials.has_workflow_secret(&variable.name)?,
                required: !variable.has_default,
                name: variable.name,
                description: variable.description,
                is_secret: variable.is_secret,
            })
        })
        .collect()
}

/// Saves or replaces one secret's value (Replace, or a value the builder asks for)
/// and remembers its name so the builder can offer it to other agents.
#[tauri::command]
pub fn set_workflow_secret(state: State<'_, AppState>, name: String, value: String) -> AppResult<()> {
    crate::workflow_secrets::saved::replace_workflow_secret(&state.db, &state.credentials, &name, &value)
}

/// Adds a secret the user names themselves (Connections > Advanced > Secrets > Add secret).
#[tauri::command]
pub fn add_workflow_secret(
    state: State<'_, AppState>,
    secret: crate::workflow_secrets::saved::NewWorkflowSecret,
) -> AppResult<()> {
    crate::workflow_secrets::saved::add_workflow_secret(&state.db, &state.credentials, secret)
}

/// Every secret name any agent declares or an MCP server needs, with its
/// status and users (Connections > Advanced > Secrets). Never values.
#[tauri::command]
pub fn list_all_workflow_secrets(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::workflow_secrets::WorkflowSecretOverview>> {
    let mcp_servers = crate::mcp::definitions::load_definitions(&state.db)?;
    crate::workflow_secrets::list_all_workflow_secrets(&state.db, &state.credentials, &mcp_servers)
}

#[tauri::command]
pub fn delete_workflow_secret(state: State<'_, AppState>, name: String) -> AppResult<()> {
    crate::workflow_secrets::saved::remove_workflow_secret(&state.db, &state.credentials, &name)
}
