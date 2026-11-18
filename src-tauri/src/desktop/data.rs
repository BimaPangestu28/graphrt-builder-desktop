//! "Export all agents" and "Delete all data" from Settings › Privacy and data.
//!
//! The export is a JSON document of every agent with its workflow, version
//! history and schedules. It never contains secrets: API keys and workflow
//! secrets live in the OS keychain, and workflows only *name* their `env.*`
//! values. Runs are not exported (they may contain customer data).
//!
//! Deleting removes every agent (with its versions, runs, events and
//! schedules) and every setting, and optionally the keychain items graphrt
//! wrote: the provider keys and the workflow secrets named by the deleted
//! agents' workflows and by the configured MCP servers.

use std::path::Path;

use serde::Serialize;

use crate::credentials::{CredentialStore, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::{Agent, AgentVersion, Trigger};
use crate::storage::{now_rfc3339, Database};

/// `format` field of an export, so an import can recognize the file.
pub const EXPORT_FORMAT: &str = "graphrt-agents";
pub const EXPORT_FORMAT_VERSION: u32 = 1;

/// Providers whose key may be in the keychain.
const KEYED_PROVIDERS: [ModelProvider; 4] =
    [ModelProvider::Openai, ModelProvider::Anthropic, ModelProvider::Gemini, ModelProvider::Deepseek];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedAgent {
    #[serde(flatten)]
    agent: Agent,
    versions: Vec<AgentVersion>,
    schedules: Vec<Trigger>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExport {
    format: &'static str,
    format_version: u32,
    exported_at: String,
    agents: Vec<ExportedAgent>,
}

/// Result of an export, shown in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub agent_count: usize,
}

/// The export document of every agent, as pretty JSON.
///
/// @throws AppError::Database - when agents cannot be read
pub fn export_agents_json(db: &Database) -> AppResult<(String, usize)> {
    let agents = db
        .list_agents()?
        .into_iter()
        .map(|agent| {
            Ok(ExportedAgent {
                versions: db.list_agent_versions(&agent.id)?,
                schedules: db.list_triggers(Some(&agent.id))?,
                agent,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let agent_count = agents.len();
    let export = AgentExport {
        format: EXPORT_FORMAT,
        format_version: EXPORT_FORMAT_VERSION,
        exported_at: now_rfc3339(),
        agents,
    };
    Ok((serde_json::to_string_pretty(&export)?, agent_count))
}

/// Writes the export to `path` (absolute, ending in `.json`, in an existing folder).
///
/// @throws AppError::InvalidInput - when the path is not usable
/// @throws AppError::Internal - when the file cannot be written
pub fn export_agents_to_file(db: &Database, path: &Path) -> AppResult<ExportSummary> {
    validate_export_path(path)?;
    let (json, agent_count) = export_agents_json(db)?;
    std::fs::write(path, json)
        .map_err(|error| AppError::Internal(format!("could not write {}: {error}", path.display())))?;
    Ok(ExportSummary { path: path.display().to_string(), agent_count })
}

fn validate_export_path(path: &Path) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::InvalidInput("the export path must be absolute".into()));
    }
    if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
        return Err(AppError::InvalidInput("the export file must end in .json".into()));
    }
    let has_folder = path.parent().is_some_and(Path::is_dir);
    if !has_folder {
        return Err(AppError::InvalidInput(format!("the folder of {} does not exist", path.display())));
    }
    Ok(())
}

/// What `delete_all_data` removed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionSummary {
    pub deleted_agent_count: usize,
    /// Keychain items removed (provider keys and workflow secrets).
    pub removed_keychain_item_count: usize,
}

/// Deletes every agent, run, schedule and setting; with `remove_keychain_items`
/// also the provider keys and the workflow secrets the agents used.
/// Keychain failures are logged and do not stop the deletion.
///
/// @throws AppError::Database - when the tables cannot be emptied
pub fn delete_all_data(
    db: &Database,
    credentials: &CredentialStore,
    remove_keychain_items: bool,
) -> AppResult<DeletionSummary> {
    let agents = db.list_agents()?;
    let mut secret_names = workflow_secret_names(&agents);
    secret_names.extend(mcp_secret_names(db));
    secret_names.sort();
    secret_names.dedup();
    db.delete_all_data()?;
    let mut summary = DeletionSummary { deleted_agent_count: agents.len(), removed_keychain_item_count: 0 };
    if !remove_keychain_items {
        return Ok(summary);
    }
    for provider in KEYED_PROVIDERS {
        match credentials.delete_api_key(provider) {
            Ok(()) => summary.removed_keychain_item_count += 1,
            Err(error) => log::warn!("could not remove a provider key: {error}"),
        }
    }
    for secret_name in secret_names {
        match credentials.delete_workflow_secret(&secret_name) {
            Ok(()) => summary.removed_keychain_item_count += 1,
            Err(error) => log::warn!("could not remove a workflow secret: {error}"),
        }
    }
    Ok(summary)
}

/// Secrets the configured MCP servers need (their list is a setting, deleted with the rest).
fn mcp_secret_names(db: &Database) -> Vec<String> {
    let definitions = crate::mcp::definitions::load_definitions(db).unwrap_or_else(|error| {
        log::warn!("could not read the MCP servers before deleting all data: {error}");
        Vec::new()
    });
    definitions.iter().flat_map(|definition| definition.secret_names()).map(str::to_owned).collect()
}

/// Distinct `env.*` names declared by the agents' workflows (unreadable workflows are skipped).
fn workflow_secret_names(agents: &[Agent]) -> Vec<String> {
    let mut names: Vec<String> = agents
        .iter()
        .filter_map(|agent| flow::summarize_flow(&agent.flow_yaml).ok())
        .flat_map(|summary| summary.env.into_iter().map(|variable| variable.name))
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, MissedRunPolicy, NewAgent, NewTrigger, RunTrigger};

    const SECRET_VALUE: &str = "sk-export-secret-0123456789";

    fn database_with_agent() -> (Database, Agent) {
        let db = Database::open_in_memory().unwrap();
        let agent = db
            .create_agent(NewAgent {
                name: "Morning email digest".into(),
                kind: AgentKind::Task,
                description: "Summarize my inbox".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        db.create_trigger(
            NewTrigger {
                agent_id: agent.id.clone(),
                cron_expression: "0 0 7 * * *".into(),
                timezone: "UTC".into(),
                missed_run_policy: MissedRunPolicy::Skip,
                inputs: json!({}),
            },
            None,
        )
        .unwrap();
        db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        db.set_setting("default_model_provider", "openai").unwrap();
        (db, agent)
    }

    #[test]
    fn export_has_agents_versions_and_schedules_but_no_secrets() {
        let (db, agent) = database_with_agent();
        let credentials = CredentialStore::in_memory();
        credentials.set_api_key(ModelProvider::Openai, SECRET_VALUE).unwrap();
        credentials.set_workflow_secret("MAPS_API_KEY", SECRET_VALUE).unwrap();

        let (json_text, agent_count) = export_agents_json(&db).unwrap();
        assert_eq!(agent_count, 1);
        assert!(!json_text.contains(SECRET_VALUE));
        let export: serde_json::Value = serde_json::from_str(&json_text).unwrap();
        assert_eq!(export["format"], EXPORT_FORMAT);
        assert_eq!(export["agents"][0]["id"], json!(agent.id));
        assert_eq!(export["agents"][0]["flowYaml"], "nodes: []");
        assert_eq!(export["agents"][0]["versions"].as_array().unwrap().len(), 1);
        assert_eq!(export["agents"][0]["schedules"][0]["cronExpression"], "0 0 7 * * *");
        assert!(export["agents"][0].get("runs").is_none());
    }

    #[test]
    fn export_writes_a_file_and_rejects_bad_paths() {
        let (db, _) = database_with_agent();
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("agents.json");
        let summary = export_agents_to_file(&db, &path).unwrap();
        assert_eq!(summary.agent_count, 1);
        assert!(std::fs::read_to_string(&path).unwrap().contains("Morning email digest"));

        let relative = export_agents_to_file(&db, Path::new("agents.json"));
        assert!(matches!(relative, Err(AppError::InvalidInput(_))));
        let wrong_extension = export_agents_to_file(&db, &folder.path().join("agents.txt"));
        assert!(matches!(wrong_extension, Err(AppError::InvalidInput(_))));
        let missing_folder = export_agents_to_file(&db, &folder.path().join("nope").join("agents.json"));
        assert!(matches!(missing_folder, Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn delete_all_data_empties_every_table() {
        let (db, _) = database_with_agent();
        let credentials = CredentialStore::in_memory();
        credentials.set_api_key(ModelProvider::Openai, SECRET_VALUE).unwrap();

        let summary = delete_all_data(&db, &credentials, false).unwrap();
        assert_eq!(summary.deleted_agent_count, 1);
        assert!(db.list_agents().unwrap().is_empty());
        assert!(db.list_triggers(None).unwrap().is_empty());
        assert!(db.list_runs(&Default::default()).unwrap().is_empty());
        assert_eq!(db.get_setting("default_model_provider").unwrap(), None);
        assert_eq!(credentials.read_api_key(ModelProvider::Openai).unwrap().as_deref(), Some(SECRET_VALUE));
    }

    #[test]
    fn delete_all_data_can_remove_keychain_items() {
        let (db, _) = database_with_agent();
        let credentials = CredentialStore::in_memory();
        credentials.set_api_key(ModelProvider::Openai, SECRET_VALUE).unwrap();

        let summary = delete_all_data(&db, &credentials, true).unwrap();
        assert_eq!(summary.removed_keychain_item_count, KEYED_PROVIDERS.len());
        assert_eq!(credentials.read_api_key(ModelProvider::Openai).unwrap(), None);
    }

    #[test]
    fn delete_all_data_also_removes_the_mcp_servers_and_their_secrets() {
        let (db, _) = database_with_agent();
        let credentials = CredentialStore::in_memory();
        credentials.set_workflow_secret("GITHUB_TOKEN", SECRET_VALUE).unwrap();
        let input = crate::mcp::McpServerInput {
            name: "github".into(),
            transport: crate::mcp::McpServerTransport::Stdio { command: "github-mcp".into(), args: vec![] },
            secret_env: vec!["GITHUB_TOKEN".into()],
            bearer_token_secret: None,
        };
        crate::mcp::definitions::add_definition(&db, input).unwrap();

        delete_all_data(&db, &credentials, true).unwrap();
        assert!(!credentials.has_workflow_secret("GITHUB_TOKEN").unwrap());
        assert!(crate::mcp::definitions::load_definitions(&db).unwrap().is_empty());
    }
}
