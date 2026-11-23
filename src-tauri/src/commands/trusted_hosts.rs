//! The hosts an agent trusts for read-only lookups (Builder › Trusted hosts,
//! chatbot setup, and the "Trust" action of a problem). Logic lives in
//! `crate::flow::trusted_hosts` and `crate::storage::trusted_hosts`.
//!
//! These commands are the only way to add a host: the builder model can only
//! propose one in its reply, which the UI shows as a button for the user.

use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;

/// The agent's trusted hosts, in the order they were added.
#[tauri::command]
pub fn list_trusted_lookup_hosts(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<String>> {
    Ok(state.db.trusted_lookup_hosts(&agent_id)?.entries().to_vec())
}

/// Trusts `host` (`api.example.com`, `*.example.com`, optionally `:port`) for the
/// agent's read-only lookups; returns the new list.
///
/// Errors the UI shows: `invalid_input` with a plain reason for a host it cannot use.
#[tauri::command]
pub fn add_trusted_lookup_host(state: State<'_, AppState>, agent_id: String, host: String) -> AppResult<Vec<String>> {
    Ok(state.db.add_trusted_lookup_host(&agent_id, &host)?.entries().to_vec())
}

/// Stops trusting `host` for the agent's lookups; returns the new list.
#[tauri::command]
pub fn remove_trusted_lookup_host(
    state: State<'_, AppState>,
    agent_id: String,
    host: String,
) -> AppResult<Vec<String>> {
    Ok(state.db.remove_trusted_lookup_host(&agent_id, &host)?.entries().to_vec())
}
