//! MCP servers that come from MCP preset plugins (`runtime: mcp` in the
//! plugin manifest, e.g. the Upwork plugin of the graphrt-plugins catalog).
//!
//! After every plugin reload, [`sync`] makes the stored MCP servers match the
//! installed presets: a new preset adds a server named after the plugin (its
//! address, sign-in kind, approval rule and builder guide), an updated one
//! refreshes those fields (the user's relaxed tools, known tools and last check
//! stay), and a server whose plugin is gone is removed with its local sign-in.
//! Revoking the tokens at the sign-in server happens before, when the plugin
//! is removed ([`sign_out_plugin_server`]). A server the user added by hand is
//! never touched: a preset whose name is taken is reported and skipped.

use graphrt_plugin::{McpApprovalDefault, McpAuth};

use super::definitions::{self, McpAuthKind, McpServerDefinition, McpServerInput, McpServerTransport};
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::plugins::host::PluginMcpServer;
use crate::storage::Database;

/// What [`sync`] changed and could not do.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SyncOutcome {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    /// `(plugin, why its server was not added)`.
    pub skipped: Vec<(String, String)>,
}

/// The definition an MCP preset plugin stands for (name = plugin name).
///
/// # Errors
/// The reason, when the plugin name or server cannot be an MCP server here.
pub(crate) fn definition_for(plugin: &str, server: &PluginMcpServer) -> Result<McpServerDefinition, String> {
    let spec = &server.spec;
    let auth = match spec.auth {
        McpAuth::None => McpAuthKind::None,
        McpAuth::Bearer => McpAuthKind::Bearer,
        McpAuth::Oauth => McpAuthKind::Oauth,
    };
    let checked = definitions::validate_input(McpServerInput {
        name: plugin.to_owned(),
        transport: McpServerTransport::Http { url: spec.url.clone() },
        secret_env: Vec::new(),
        bearer_token_secret: spec.bearer_token_env.clone(),
        auth: Some(auth),
    })
    .map_err(|error| error.to_string())?;
    Ok(McpServerDefinition {
        plugin: Some(plugin.to_owned()),
        guide: server.guide.clone(),
        approval: definitions::McpApprovalPolicy {
            read_only: spec.approval.read_only.clone(),
            ask_first: spec.approval.ask_first.clone(),
            default_asks: spec.approval.default == McpApprovalDefault::Ask,
            without_approval: Vec::new(),
        },
        ..checked
    })
}

/// Makes the stored servers match the installed MCP presets (`presets`: plugin
/// name and server). Removed servers lose their local sign-in.
///
/// # Errors
/// `Database` when the server list cannot be read or saved.
pub(crate) fn sync(
    db: &Database,
    credentials: &CredentialStore,
    presets: &[(String, PluginMcpServer)],
) -> AppResult<(SyncOutcome, Vec<McpServerDefinition>)> {
    let (outcome, all) = definitions::modify_definitions(db, |stored| Ok(apply(stored, presets)))?;
    for name in &outcome.removed {
        if let Err(error) = super::oauth::store::delete_all(credentials, name) {
            log::warn!("could not remove the sign-in of MCP server `{name}`: {error}");
        }
    }
    Ok((outcome, all))
}

/// The pure part of [`sync`].
pub(crate) fn apply(stored: &mut Vec<McpServerDefinition>, presets: &[(String, PluginMcpServer)]) -> SyncOutcome {
    let mut outcome = SyncOutcome::default();
    stored.retain(|definition| match &definition.plugin {
        Some(plugin) if !presets.iter().any(|(name, _)| name == plugin) => {
            outcome.removed.push(definition.name.clone());
            false
        }
        _ => true,
    });
    for (plugin, server) in presets {
        let fresh = match definition_for(plugin, server) {
            Ok(fresh) => fresh,
            Err(reason) => {
                outcome.skipped.push((plugin.clone(), reason));
                continue;
            }
        };
        match stored.iter_mut().find(|definition| definition.name == fresh.name) {
            Some(existing) if existing.plugin.as_deref() == Some(plugin.as_str()) => {
                let same_server = existing.transport == fresh.transport;
                let relaxed = std::mem::take(&mut existing.approval.without_approval);
                let (known_tools, last_check) = if same_server {
                    (std::mem::take(&mut existing.known_tools), existing.last_check.take())
                } else {
                    (Vec::new(), None)
                };
                *existing = McpServerDefinition { known_tools, last_check, ..fresh };
                existing.approval.without_approval = relaxed;
            }
            Some(_) => outcome.skipped.push((
                plugin.clone(),
                format!(
                    "an MCP server named `{}` was added by hand; remove or rename it to use the plugin",
                    fresh.name
                ),
            )),
            None => {
                outcome.added.push(fresh.name.clone());
                stored.push(fresh);
            }
        }
    }
    outcome
}

/// Revokes the sign-in of the server that plugin `plugin` added (when it is an
/// OAuth server), before the plugin is removed. Failures are logged.
pub async fn sign_out_plugin_server(db: &Database, credentials: &CredentialStore, plugin: &str) {
    let definitions = match definitions::load_definitions(db) {
        Ok(definitions) => definitions,
        Err(error) => {
            log::warn!("could not read the MCP servers before removing plugin {plugin}: {error}");
            return;
        }
    };
    let servers = definitions
        .iter()
        .filter(|definition| definition.plugin.as_deref() == Some(plugin) && definition.auth == McpAuthKind::Oauth);
    for definition in servers {
        super::oauth::cancel_sign_in(&definition.name);
        let outcome = match super::oauth::client::OAuthHttp::new() {
            Ok(http) => super::oauth::sign_out(&http, credentials, &definition.name).await,
            Err(error) => Err(error),
        };
        if let Err(error) = outcome {
            log::warn!("could not sign out of MCP server `{}`: {error}", definition.name);
        }
    }
}
