//! "When something goes wrong" (screen 23): the problem list, one failed run
//! explained, and "Retry from the start".

use tauri::State;

use crate::error::AppResult;
use crate::problems::models::{FailedRunReport, Problem};
use crate::problems::{self, ProblemSources};
use crate::state::AppState;
use crate::storage::models::Run;

/// Every problem the app can detect right now (failed runs, missing keys,
/// plugins, the plugin and browser runtimes, schedules).
#[tauri::command]
pub fn list_problems(state: State<'_, AppState>) -> AppResult<Vec<Problem>> {
    let plugins = state.plugins.list_installed()?;
    let sources = ProblemSources {
        db: &state.db,
        credentials: &state.credentials,
        plugins: &plugins,
        browser_status: state.plugins.browser_runtime_status(),
        plugin_runtime_status: state.plugins.plugin_runtime_status(),
    };
    problems::collect_problems(&sources)
}

/// One failed run explained: cause, fix, steps and graphrt's error.
#[tauri::command]
pub fn get_failed_run_report(state: State<'_, AppState>, run_id: String) -> AppResult<FailedRunReport> {
    problems::failed_run_report(&state.db, run_id.trim())
}

/// Starts a new run of the same agent with the same inputs. graphrt cannot
/// resume a failed run (no snapshot is kept), so this always starts over.
#[tauri::command]
pub async fn retry_run(state: State<'_, AppState>, run_id: String) -> AppResult<Run> {
    problems::retry::retry_run(&state.db, &state.runs, run_id.trim()).await
}
