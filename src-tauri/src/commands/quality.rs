//! Tests and releases of an agent (see `crate::quality`). Check progress arrives as
//! `agent-check-event` Tauri events.

use tauri::State;

use crate::deploy::OnlineSwitch;
use crate::error::AppResult;
use crate::quality::suggest::SuggestedTest;
use crate::quality::view::CheckView;
use crate::quality::{QualityOverview, QualitySettings};
use crate::state::AppState;
use crate::storage::quality::{AgentTest, Release, TestInput};

/// Tests, the latest check, whether the latest version may be released, and the releases.
#[tauri::command]
pub fn get_agent_quality(state: State<'_, AppState>, agent_id: String) -> AppResult<QualityOverview> {
    state.quality.overview(agent_id.trim())
}

#[tauri::command]
pub fn add_agent_tests(
    state: State<'_, AppState>,
    agent_id: String,
    tests: Vec<TestInput>,
) -> AppResult<Vec<AgentTest>> {
    state.quality.add_tests(agent_id.trim(), tests)
}

#[tauri::command]
pub fn update_agent_test(
    state: State<'_, AppState>,
    agent_id: String,
    test_id: String,
    test: TestInput,
) -> AppResult<AgentTest> {
    state.quality.update_test(agent_id.trim(), test_id.trim(), test)
}

#[tauri::command]
pub fn delete_agent_test(state: State<'_, AppState>, agent_id: String, test_id: String) -> AppResult<()> {
    state.quality.delete_test(agent_id.trim(), test_id.trim())
}

/// Draft tests written by the person's model from what the agent is for (nothing is saved).
#[tauri::command]
pub async fn suggest_agent_tests(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<SuggestedTest>> {
    state.quality.suggest_tests(agent_id.trim()).await
}

/// Starts checking the latest version; returns at once with the running check.
#[tauri::command]
pub fn start_agent_check(state: State<'_, AppState>, agent_id: String) -> AppResult<CheckView> {
    state.quality.start_check(agent_id.trim())
}

#[tauri::command]
pub fn get_agent_check(state: State<'_, AppState>, agent_id: String, check_id: String) -> AppResult<CheckView> {
    state.quality.get_check(agent_id.trim(), check_id.trim())
}

#[tauri::command]
pub fn set_agent_quality_settings(
    state: State<'_, AppState>,
    agent_id: String,
    settings: QualitySettings,
) -> AppResult<QualitySettings> {
    state.quality.set_settings(agent_id.trim(), settings)
}

/// Releases the latest version; `overrideReason` releases it although the check does not allow it.
#[tauri::command]
pub fn create_agent_release(
    state: State<'_, AppState>,
    agent_id: String,
    notes: String,
    override_reason: Option<String>,
) -> AppResult<Release> {
    state.quality.create_release(agent_id.trim(), &notes, override_reason)
}

/// What putting another release in use did, here and online.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSwitchOutcome {
    pub release: Release,
    pub online: OnlineSwitch,
}

/// Puts an earlier (or later) release back in use, and the online copy with it when it can.
#[tauri::command]
pub async fn use_agent_release(
    state: State<'_, AppState>,
    agent_id: String,
    number: i64,
) -> AppResult<ReleaseSwitchOutcome> {
    let agent_id = agent_id.trim();
    let release = state.quality.switch_release(agent_id, number)?;
    let online = state.deploy.use_release_online(agent_id, &release).await?;
    Ok(ReleaseSwitchOutcome { release, online })
}
