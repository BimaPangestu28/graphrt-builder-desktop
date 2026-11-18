use tauri::State;

use crate::credentials::{
    self, ModelChoice, ModelProvider, ProviderStatus, SETTING_DEFAULT_MODEL, SETTING_DEFAULT_PROVIDER,
    SETTING_OLLAMA_BASE_URL,
};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::state::AppState;

#[tauri::command]
pub fn set_api_key(state: State<'_, AppState>, provider: ModelProvider, api_key: String) -> AppResult<()> {
    state.credentials.set_api_key(provider, api_key.trim())
}

#[tauri::command]
pub fn delete_api_key(state: State<'_, AppState>, provider: ModelProvider) -> AppResult<()> {
    state.credentials.delete_api_key(provider)
}

#[tauri::command]
pub fn list_provider_statuses(state: State<'_, AppState>) -> AppResult<Vec<ProviderStatus>> {
    state.credentials.provider_statuses(&state.db)
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

#[tauri::command]
pub fn set_workflow_secret(state: State<'_, AppState>, name: String, value: String) -> AppResult<()> {
    state.credentials.set_workflow_secret(name.trim(), &value)
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
    state.credentials.delete_workflow_secret(name.trim())
}
