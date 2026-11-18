use tauri::State;

use crate::credentials::{self, ModelChoice, ModelProvider, ProviderStatus, SETTING_DEFAULT_MODEL, SETTING_DEFAULT_PROVIDER, SETTING_OLLAMA_BASE_URL};
use crate::error::{AppError, AppResult};
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
