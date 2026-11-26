//! MCP servers (Connections > Advanced): list, add by hand (servers of MCP preset plugins are added by the plugin),
//! remove, test the connection, sign in / out (OAuth) and per-tool approvals.
//! Every change republishes the list so new runs and the builder prompt see it.

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::mcp::oauth::{self, McpSignInStatus, OAuthError, SignInOptions};
use crate::mcp::{self, definitions, McpAuthKind, McpServerInput, McpServerTransport, McpServerView};
use crate::state::AppState;

#[tauri::command]
pub fn list_mcp_servers(state: State<'_, AppState>) -> AppResult<Vec<McpServerView>> {
    Ok(definitions::load_definitions(&state.db)?
        .into_iter()
        .map(|definition| mcp::view(definition, &state.credentials))
        .collect())
}

/// Stores a new server (no connection yet: use `test_mcp_server`).
#[tauri::command]
pub fn add_mcp_server(state: State<'_, AppState>, server: McpServerInput) -> AppResult<McpServerView> {
    let (added, all_definitions) = definitions::add_definition(&state.db, server)?;
    mcp::publish(all_definitions);
    Ok(mcp::view(added, &state.credentials))
}

/// Removes a server; an OAuth server is signed out first (tokens revoked when possible).
#[tauri::command]
pub async fn remove_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let name = name.trim();
    let definition = find_definition(&state, name)?;
    if let Some(plugin) = &definition.plugin {
        return Err(AppError::InvalidInput(format!("remove the {plugin} plugin to remove this server")));
    }
    if definition.auth == McpAuthKind::Oauth {
        oauth::cancel_sign_in(name);
        let http = oauth::client::OAuthHttp::new().map_err(oauth_error)?;
        oauth::sign_out(&http, &state.credentials, name).await.map_err(oauth_error)?;
    }
    let all_definitions = definitions::remove_definition(&state.db, name)?;
    mcp::publish(all_definitions);
    Ok(())
}

/// Connects, lists the tools and disconnects; the outcome is stored in `lastCheck`.
#[tauri::command]
pub async fn test_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<McpServerView> {
    let checked = mcp::check_connection(&state.db, &state.credentials, name.trim()).await?;
    Ok(mcp::view(checked, &state.credentials))
}

/// Opens the server's sign-in page in the browser and waits (up to 5 minutes)
/// for the user to finish; then tests the connection so the tools are listed.
#[tauri::command]
pub async fn sign_in_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<McpServerView> {
    let name = name.trim();
    let definition = find_definition(&state, name)?;
    let McpServerTransport::Http { url } = &definition.transport else {
        return Err(AppError::InvalidInput("signing in only applies to servers reached by URL".into()));
    };
    if definition.auth != McpAuthKind::Oauth {
        return Err(AppError::InvalidInput(format!("`{name}` does not use sign-in")));
    }
    let http = oauth::client::OAuthHttp::new().map_err(oauth_error)?;
    let open_browser = |url: &str| crate::crash_reports::sharing::open_in_browser(url).map_err(|e| e.to_string());
    let options = SignInOptions { http: &http, open_browser: &open_browser, timeout: oauth::SIGN_IN_TIMEOUT };
    let status = oauth::sign_in(&state.credentials, name, url, options).await.map_err(oauth_error)?;
    if matches!(status, McpSignInStatus::SignedIn { .. }) {
        let checked = mcp::check_connection(&state.db, &state.credentials, name).await?;
        return Ok(mcp::view(checked, &state.credentials));
    }
    Ok(mcp::view(definition, &state.credentials))
}

/// Stops a sign-in that is waiting for the browser.
#[tauri::command]
pub fn cancel_mcp_sign_in(name: String) {
    oauth::cancel_sign_in(name.trim());
}

/// Revokes the tokens (when the server supports it) and forgets the sign-in.
#[tauri::command]
pub async fn sign_out_mcp_server(state: State<'_, AppState>, name: String) -> AppResult<McpServerView> {
    let name = name.trim();
    let definition = find_definition(&state, name)?;
    let http = oauth::client::OAuthHttp::new().map_err(oauth_error)?;
    oauth::sign_out(&http, &state.credentials, name).await.map_err(oauth_error)?;
    Ok(mcp::view(definition, &state.credentials))
}

/// Lets one tool run without asking first (`ask: false`) or makes it ask again.
#[tauri::command]
pub fn set_mcp_tool_approval(
    state: State<'_, AppState>,
    name: String,
    tool: String,
    ask: bool,
) -> AppResult<McpServerView> {
    let (changed, all_definitions) = definitions::set_tool_approval(&state.db, name.trim(), &tool, ask)?;
    mcp::publish(all_definitions);
    Ok(mcp::view(changed, &state.credentials))
}

fn find_definition(state: &AppState, name: &str) -> AppResult<definitions::McpServerDefinition> {
    definitions::load_definitions(&state.db)?
        .into_iter()
        .find(|definition| definition.name == name)
        .ok_or_else(|| AppError::NotFound(format!("MCP server {name}")))
}

/// `stopped` for a cancelled sign-in (the page shows nothing), the reason otherwise.
fn oauth_error(error: OAuthError) -> AppError {
    match error {
        OAuthError::Storage(message) => AppError::Credentials(message),
        OAuthError::Cancelled => AppError::Stopped,
        other => AppError::Internal(other.to_string()),
    }
}
