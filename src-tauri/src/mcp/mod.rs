//! MCP servers the user adds in Connections > Advanced: their tools become
//! available to `tool` and `agent` nodes of every run (graphrt-mcp).
//!
//! - [`definitions`]: what is stored (name, command or URL, the workflow
//!   secrets it needs; never secret values) and the graphrt-mcp config.
//! - [`lazy_runtime`]: the registry entry that connects on first use.
//! - [`prompt_guide`]: the builder prompt's section listing the servers' tools.
//!
//! Like plugins (`plugins::active`), the definitions are published process-wide
//! ([`publish`]) on start-up and after every change, because run tool
//! registries and the builder prompt are built where `AppState` is not at hand.
//! Each server is registered under `<name>` and `mcp:<name>` next to the
//! `agents` and plugin providers; a name already taken by one of those is
//! skipped with a warning, so a server can never shadow them.

pub mod definitions;
pub(crate) mod lazy_runtime;
pub mod oauth;
pub mod plugin_servers;
pub mod prompt_guide;

#[cfg(test)]
mod tests;

use std::sync::{Arc, RwLock};

use graphrt_core::tool::ToolRegistry;

pub use self::definitions::{
    McpApprovalPolicy, McpAuthKind, McpConnectionCheck, McpServerDefinition, McpServerInput, McpServerTransport,
    McpToolInfo,
};
use self::lazy_runtime::LazyMcpRuntime;
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::storage::Database;

/// Alias prefix graphrt-mcp uses (`provider_id: mcp:<name>`).
pub const PROVIDER_PREFIX: &str = graphrt_mcp::PROVIDER_PREFIX;

static ACTIVE_DEFINITIONS: RwLock<Option<Arc<Vec<McpServerDefinition>>>> = RwLock::new(None);

/// Replaces the published definitions.
pub fn publish(definitions: Vec<McpServerDefinition>) {
    let published = Some(Arc::new(definitions));
    match ACTIVE_DEFINITIONS.write() {
        Ok(mut slot) => *slot = published,
        Err(poisoned) => *poisoned.into_inner() = published,
    }
}

/// Publishes what is stored (on start-up). A read failure is logged and publishes nothing.
pub fn publish_from_database(db: &Database) {
    match definitions::load_definitions(db) {
        Ok(definitions) => publish(definitions),
        Err(error) => log::warn!("could not load MCP servers: {error}"),
    }
}

/// The published definitions (empty before [`publish`]).
pub fn current() -> Arc<Vec<McpServerDefinition>> {
    let slot = match ACTIVE_DEFINITIONS.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    slot.unwrap_or_default()
}

/// Adds the published MCP servers to a run's tool registry.
pub fn add_mcp_tools(registry: &mut ToolRegistry, credentials: &Arc<CredentialStore>) {
    register_servers(registry, &current(), credentials);
}

/// Registers each server under `<name>` and `mcp:<name>`, skipping names
/// another provider already uses. Nothing connects until a node uses it.
pub(crate) fn register_servers(
    registry: &mut ToolRegistry,
    definitions: &[McpServerDefinition],
    credentials: &Arc<CredentialStore>,
) {
    for definition in definitions {
        let alias = format!("{PROVIDER_PREFIX}{}", definition.name);
        if registry.get(&definition.name).is_some() || registry.get(&alias).is_some() {
            log::warn!("MCP server `{}` is not available: another tool provider uses that name", definition.name);
            continue;
        }
        let runtime = Arc::new(LazyMcpRuntime::new(definition.clone(), credentials.clone()));
        registry.add(alias, runtime.clone());
        registry.add(definition.name.clone(), runtime);
    }
}

/// Connects to the stored server `name`, lists its tools, disconnects, and
/// stores the outcome (tools for the builder prompt, or the error). Publishes
/// the updated list.
///
/// # Errors
/// `NotFound` for an unknown server, `Database` when the outcome cannot be stored.
/// A failed connection is not an error: it is recorded in `last_check`.
pub async fn check_connection(
    db: &Database,
    credentials: &Arc<CredentialStore>,
    name: &str,
) -> AppResult<McpServerDefinition> {
    let definition = definitions::load_definitions(db)?
        .into_iter()
        .find(|definition| definition.name == name)
        .ok_or_else(|| crate::error::AppError::NotFound(format!("MCP server {name}")))?;
    let (tools, error) = match list_server_tools(&definition, credentials).await {
        Ok(tools) => (Some(tools), None),
        Err(message) => (None, Some(message)),
    };
    let (checked, all_definitions) = definitions::record_check(db, name, tools, error)?;
    publish(all_definitions);
    Ok(checked)
}

async fn list_server_tools(
    definition: &McpServerDefinition,
    credentials: &Arc<CredentialStore>,
) -> Result<Vec<McpToolInfo>, String> {
    let connection = lazy_runtime::connect(definition, credentials).await?;
    let listed = connection.refresh().await;
    connection.close().await;
    let specs = listed.map_err(|error| error.message)?;
    Ok(specs
        .into_iter()
        .map(|spec| McpToolInfo { name: spec.name, description: spec.description, input_schema: Some(spec.parameters) })
        .collect())
}

/// A server as the Connections page shows it: the definition plus, for OAuth
/// servers, whether the user is signed in (read from the credential store).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    #[serde(flatten)]
    pub definition: McpServerDefinition,
    pub sign_in: Option<oauth::McpSignInStatus>,
    /// For each known tool, whether a run asks before calling it.
    pub tool_approvals: Vec<McpToolApproval>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolApproval {
    pub name: String,
    pub asks_first: bool,
}

/// The view of `definition`.
pub fn view(definition: McpServerDefinition, credentials: &CredentialStore) -> McpServerView {
    let sign_in = (definition.auth == McpAuthKind::Oauth).then(|| oauth::sign_in_status(credentials, &definition.name));
    let tool_approvals = definition
        .known_tools
        .iter()
        .map(|tool| McpToolApproval { name: tool.name.clone(), asks_first: definition.approval.tool_sends(&tool.name) })
        .collect();
    McpServerView { definition, sign_in, tool_approvals }
}

/// Whether `tool` of the MCP server `provider` (`<name>` or `mcp:<name>`) sends,
/// following that server's approval policy. `None` when no MCP server has that name.
pub fn tool_sends(provider: &str, tool: &str) -> Option<bool> {
    tool_sends_in(&current(), provider, tool)
}

/// [`tool_sends`] over `definitions`.
pub(crate) fn tool_sends_in(definitions: &[McpServerDefinition], provider: &str, tool: &str) -> Option<bool> {
    let name = provider.trim().strip_prefix(PROVIDER_PREFIX).unwrap_or(provider.trim());
    definitions.iter().find(|definition| definition.name == name).map(|definition| definition.approval.tool_sends(tool))
}
