//! [`LazyMcpRuntime`]: an MCP server in a run's tool registry that connects
//! only when a node first lists or calls its tools.
//!
//! Building a run's tool registry stays synchronous and cheap: nothing is
//! spawned and no secret is read for servers the workflow never uses. The
//! connection lives as long as the registry (one run), so a stdio server's
//! process stops when the run ends.

use std::fmt;
use std::sync::Arc;

use futures::future::BoxFuture;
use graphrt_core::tool::{ToolError, ToolOutput, ToolRuntime, ToolSpec};
use graphrt_mcp::McpToolRuntime;
use tokio::sync::OnceCell;

use super::definitions::{runtime_config, McpServerDefinition};
use crate::credentials::CredentialStore;

/// One configured MCP server, connected on first use.
pub(crate) struct LazyMcpRuntime {
    definition: McpServerDefinition,
    credentials: Arc<CredentialStore>,
    /// The connection, or why it could not be made (kept so a run does not retry every call).
    connection: OnceCell<Result<McpToolRuntime, String>>,
}

impl fmt::Debug for LazyMcpRuntime {
    /// Only the server name: the config may hold secret values.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("LazyMcpRuntime").field("server", &self.definition.name).finish_non_exhaustive()
    }
}

impl LazyMcpRuntime {
    pub(crate) fn new(definition: McpServerDefinition, credentials: Arc<CredentialStore>) -> Self {
        Self { definition, credentials, connection: OnceCell::new() }
    }

    async fn connection(&self) -> Result<&McpToolRuntime, ToolError> {
        let connection = self.connection.get_or_init(|| connect(&self.definition, &self.credentials)).await;
        connection
            .as_ref()
            .map_err(|message| ToolError { tool: format!("{}/*", self.definition.name), message: message.clone() })
    }

    async fn list_tools(&self) -> Result<Vec<ToolSpec>, ToolError> {
        self.connection().await?.list().await
    }

    async fn call_tool(&self, name: &str, arguments: serde_json::Value) -> Result<ToolOutput, ToolError> {
        self.connection().await?.call(name, arguments).await
    }
}

/// Reads the secrets and completes the MCP handshake.
pub(crate) async fn connect(
    definition: &McpServerDefinition,
    credentials: &Arc<CredentialStore>,
) -> Result<McpToolRuntime, String> {
    let config = runtime_config(definition, credentials).map_err(|error| {
        format!("MCP server `{}` is not ready: {error}. Set it in Connections > Advanced", definition.name)
    })?;
    McpToolRuntime::connect(&config).await.map_err(|error| error.to_string())
}

impl ToolRuntime for LazyMcpRuntime {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ToolSpec>, ToolError>> {
        Box::pin(self.list_tools())
    }

    fn call<'a>(&'a self, name: &'a str, arguments: serde_json::Value) -> BoxFuture<'a, Result<ToolOutput, ToolError>> {
        Box::pin(self.call_tool(name, arguments))
    }
}
