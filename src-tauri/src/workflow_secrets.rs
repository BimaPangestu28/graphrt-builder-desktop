//! Every workflow secret the app knows about (Connections > Advanced > Secrets):
//! the `env.*` values any agent's current workflow declares, plus the secrets
//! configured MCP servers need, each with whether it is stored and who uses it.
//!
//! Values never leave the keychain; this only reports names and status.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::flow;
use crate::mcp::McpServerDefinition;
use crate::storage::Database;

/// An agent that declares a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAgentUse {
    pub agent_id: String,
    pub agent_name: String,
}

/// One secret name across every agent and MCP server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSecretOverview {
    pub name: String,
    /// The first description an agent's workflow gives it.
    pub description: Option<String>,
    /// Declared `type: secret` by at least one agent (or needed by an MCP server).
    pub is_secret: bool,
    /// At least one user cannot run without it (no default in its workflow, or an MCP server).
    pub required: bool,
    pub configured: bool,
    /// Agents whose current version declares it, by name.
    pub agents: Vec<SecretAgentUse>,
    /// MCP servers that need it.
    pub mcp_servers: Vec<String>,
}

#[derive(Default)]
struct SecretUses {
    description: Option<String>,
    is_secret: bool,
    required: bool,
    agents: Vec<SecretAgentUse>,
    mcp_servers: Vec<String>,
}

/// Every secret name, sorted by name. Agents whose workflow cannot be read are
/// skipped (and logged) rather than failing the whole list.
///
/// # Errors
/// `Database` when agents cannot be listed, `Credentials` when the keychain cannot be read.
pub fn list_all_workflow_secrets(
    db: &Database,
    credentials: &CredentialStore,
    mcp_servers: &[McpServerDefinition],
) -> AppResult<Vec<WorkflowSecretOverview>> {
    let mut uses_by_name: BTreeMap<String, SecretUses> = BTreeMap::new();
    collect_agent_uses(db, &mut uses_by_name)?;
    for server in mcp_servers {
        for secret_name in server.secret_names() {
            let uses = uses_by_name.entry(secret_name.to_owned()).or_default();
            uses.is_secret = true;
            uses.required = true;
            uses.mcp_servers.push(server.name.clone());
        }
    }
    uses_by_name
        .into_iter()
        .map(|(name, uses)| {
            Ok(WorkflowSecretOverview {
                configured: credentials.has_workflow_secret(&name)?,
                name,
                description: uses.description,
                is_secret: uses.is_secret,
                required: uses.required,
                agents: uses.agents,
                mcp_servers: uses.mcp_servers,
            })
        })
        .collect()
}

fn collect_agent_uses(db: &Database, uses_by_name: &mut BTreeMap<String, SecretUses>) -> AppResult<()> {
    let mut agents = db.list_agents()?;
    agents.sort_by_key(|agent| agent.name.to_lowercase());
    for agent in agents {
        let summary = match flow::summarize_flow(&agent.flow_yaml) {
            Ok(summary) => summary,
            Err(error) => {
                log::warn!("skipping the secrets of agent {}: {error}", agent.id);
                continue;
            }
        };
        for variable in summary.env {
            let uses = uses_by_name.entry(variable.name).or_default();
            if uses.description.is_none() {
                uses.description = variable.description.filter(|description| !description.trim().is_empty());
            }
            uses.is_secret |= variable.is_secret;
            uses.required |= !variable.has_default;
            if !uses.agents.iter().any(|existing| existing.agent_id == agent.id) {
                uses.agents.push(SecretAgentUse { agent_id: agent.id.clone(), agent_name: agent.name.clone() });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::McpServerTransport;
    use crate::storage::models::{AgentKind, NewAgent};

    /// A one-step workflow declaring `env_entries` (YAML flow mappings, one per line).
    fn flow_with_env(env_entries: &[&str]) -> String {
        let env_yaml: String = env_entries.iter().map(|entry| format!("  - {entry}\n")).collect();
        format!(
            "version: \"1\"\nname: secrets-test\nenv:\n{env_yaml}graph:\n  nodes:\n    - id: start\n      type: start\n      variables: []\n    - id: end\n      type: end\n      outputs: []\n  edges:\n    - {{ source: start, target: end }}\n"
        )
    }

    fn create_agent(db: &Database, name: &str, flow_yaml: String) -> String {
        db.create_agent(NewAgent { name: name.into(), kind: AgentKind::Task, description: String::new(), flow_yaml })
            .unwrap()
            .id
    }

    #[test]
    fn lists_each_secret_once_with_every_agent_and_server_using_it() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        let maps_agent = create_agent(
            &db,
            "Maps leads",
            flow_with_env(&[
                "{ name: GOOGLE_PLACES_KEY, type: secret, description: Google Places API key }",
                "{ name: CITY, type: string, value: Jakarta }",
            ]),
        );
        let digest_agent = create_agent(
            &db,
            "Digest",
            flow_with_env(&["{ name: GOOGLE_PLACES_KEY, type: secret }", "{ name: GITHUB_TOKEN, type: secret }"]),
        );
        create_agent(&db, "Broken", "not: [valid".into());
        credentials.set_workflow_secret("GOOGLE_PLACES_KEY", "value").unwrap();
        let server = McpServerDefinition {
            name: "github".into(),
            transport: McpServerTransport::Stdio { command: "github-mcp".into(), args: vec![] },
            secret_env: vec!["GITHUB_TOKEN".into()],
            bearer_token_secret: None,
            known_tools: vec![],
            last_check: None,
        };

        let secrets = list_all_workflow_secrets(&db, &credentials, &[server]).unwrap();

        let names: Vec<&str> = secrets.iter().map(|secret| secret.name.as_str()).collect();
        assert_eq!(names, ["CITY", "GITHUB_TOKEN", "GOOGLE_PLACES_KEY"]);
        let places = &secrets[2];
        assert!(places.configured && places.is_secret && places.required);
        assert_eq!(places.description.as_deref(), Some("Google Places API key"));
        let agent_ids: Vec<&str> = places.agents.iter().map(|agent| agent.agent_id.as_str()).collect();
        assert_eq!(agent_ids, [digest_agent.as_str(), maps_agent.as_str()], "sorted by agent name");
        let github = &secrets[1];
        assert!(!github.configured);
        assert_eq!(github.mcp_servers, ["github"]);
        assert_eq!(github.agents.len(), 1);
        let city = &secrets[0];
        assert!(!city.is_secret && !city.required, "a plain value with a default");
    }

    #[test]
    fn never_includes_values() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        create_agent(&db, "Maps", flow_with_env(&["{ name: MAPS_KEY, type: secret }"]));
        credentials.set_workflow_secret("MAPS_KEY", "super-secret-value").unwrap();
        let json = serde_json::to_string(&list_all_workflow_secrets(&db, &credentials, &[]).unwrap()).unwrap();
        assert!(!json.contains("super-secret-value"));
        assert!(json.contains("\"configured\":true"));
    }
}
