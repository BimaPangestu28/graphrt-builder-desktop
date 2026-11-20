//! Everything checked and built before a run is recorded: the compiled
//! workflow, the provider-key check, graphrt services and run inputs.

use std::sync::Arc;

use graphrt_core::engine::Limits;
use graphrt_core::tool::ToolRegistry;
use graphrt_core::{Engine, IndexMap, Services, Value};

use super::ModelRegistrySource;
use crate::credentials::CredentialStore;
use crate::desktop::app_settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::Agent;
use crate::storage::Database;

/// Compiles the flow, checks provider keys and wires graphrt services.
///
/// `tools` is the graphrt tool registry for `tool` / `agent` nodes (the
/// `agents` provider, see `agent_tools`); other tool providers are added to it.
///
/// # Errors
/// `MissingPlugins` when the flow uses plugins that are not installed,
/// `InvalidInput` / `Workflow` for a bad flow, `MissingCredentials` when a model
/// provider the flow uses is not configured, or whatever building the model
/// registry / HTTP client reports.
pub(super) fn build_engine(
    flow_yaml: &str,
    credentials: &CredentialStore,
    db: &Database,
    model_source: &dyn ModelRegistrySource,
    tools: ToolRegistry,
) -> AppResult<Engine> {
    ensure_plugins_installed(flow_yaml)?;
    let summary = flow::summarize_flow(flow_yaml)?;
    ensure_providers_configured(&summary.model_providers, credentials, db)?;
    let graph = flow::compile_flow(flow_yaml)?;
    let http_client = graphrt_http::HttpClient::new(graphrt_http::EgressPolicy::default())
        .map_err(|error| AppError::Internal(format!("could not set up the HTTP client: {error}")))?;
    let services = Services::new().with(model_source.build_registry(credentials, db)?).with(http_client).with(tools);
    // Knowledge bases for the `knowledge-retrieval` node (stores open on first search).
    let services = services.with(crate::knowledge::knowledge_service_for_runs(db, credentials)?);
    Ok(Engine::new(Arc::new(graph)).with_services(services).with_limits(run_limits(db)))
}

/// The run limits from Settings › Runner (graphrt counts active run time, not time paused).
/// A settings read failure is logged and the defaults apply.
pub(super) fn run_limits(db: &Database) -> Limits {
    AppSettings::load_or_default(db).run_limits.to_engine_limits()
}

/// `MissingPlugins` naming every plugin the flow uses that is not installed.
/// Drafts may use catalog plugins before they are installed; they never run.
fn ensure_plugins_installed(flow_yaml: &str) -> AppResult<()> {
    let missing_plugins = flow::find_missing_plugins(flow_yaml);
    if missing_plugins.is_empty() {
        Ok(())
    } else {
        Err(AppError::MissingPlugins(missing_plugins))
    }
}

/// `MissingCredentials` naming the first provider in `providers` without a key.
/// Providers the app does not know can never be configured, so they fail too.
fn ensure_providers_configured(providers: &[String], credentials: &CredentialStore, db: &Database) -> AppResult<()> {
    if providers.is_empty() {
        return Ok(());
    }
    let statuses = credentials.provider_statuses(db)?;
    let is_configured = |provider_name: &str| {
        statuses.iter().any(|status| {
            status.configured
                && serde_json::to_value(status.provider).ok().as_ref().and_then(serde_json::Value::as_str)
                    == Some(provider_name)
        })
    };
    match providers.iter().find(|provider_name| !is_configured(provider_name)) {
        Some(missing_provider) => Err(AppError::MissingCredentials(missing_provider.clone())),
        None => Ok(()),
    }
}

/// The flow of `version`: the agent's current flow, or the stored version's.
///
/// # Errors
/// `NotFound` when that version no longer exists.
pub(crate) fn flow_for_version(db: &Database, agent: &Agent, version: i64) -> AppResult<String> {
    if agent.current_version == version {
        return Ok(agent.flow_yaml.clone());
    }
    db.list_agent_versions(&agent.id)?
        .into_iter()
        .find(|agent_version| agent_version.version == version)
        .map(|agent_version| agent_version.flow_yaml)
        .ok_or_else(|| AppError::NotFound(format!("version {version} of agent {}", agent.id)))
}

/// Converts a JSON object (or `null`, meaning empty) into graphrt values.
///
/// Values come from the UI and are converted as untrusted JSON, so they can
/// never forge graphrt file references.
///
/// # Errors
/// `InvalidInput` when `json` is neither an object nor `null`.
pub(super) fn json_object_to_value_map(json: serde_json::Value, what: &str) -> AppResult<IndexMap<String, Value>> {
    match json {
        serde_json::Value::Null => Ok(IndexMap::new()),
        serde_json::Value::Object(fields) => {
            Ok(fields.into_iter().map(|(name, value)| (name, Value::from_json(value))).collect())
        }
        other => Err(AppError::InvalidInput(format!("{what} must be a JSON object, got {other}"))),
    }
}

/// Workflow `env.*` values for a run of `flow_yaml`, read from the keychain and
/// supplied on start and resume (graphrt never stores them in snapshots).
///
/// Variables declared as `type: secret` are passed as graphrt secrets, so they
/// are masked in events and logs. A variable with no stored value falls back to
/// its declared default; one with neither is reported as missing.
///
/// # Errors
/// `MissingCredentials` listing every variable that has no value and no default,
/// so the UI can ask for all of them at once.
pub(super) fn workflow_env(flow_yaml: &str, credentials: &CredentialStore) -> AppResult<IndexMap<String, Value>> {
    let summary = flow::summarize_flow(flow_yaml)?;
    let mut env = IndexMap::new();
    let mut missing_names = Vec::new();
    for variable in summary.env {
        match credentials.read_workflow_secret(&variable.name)? {
            Some(stored_value) => {
                let value = if variable.is_secret {
                    Value::Secret(Arc::from(stored_value.as_str()))
                } else {
                    Value::String(Arc::from(stored_value.as_str()))
                };
                env.insert(variable.name, value);
            }
            None if variable.has_default => {}
            None => missing_names.push(variable.name),
        }
    }
    if missing_names.is_empty() {
        Ok(env)
    } else {
        Err(AppError::MissingCredentials(missing_names.join(", ")))
    }
}

/// The compiled engine and the `env.*` values for one run of `flow_yaml`,
/// for hosts that drive graphrt themselves instead of through `RunManager`
/// (chatbot conversations run one short workflow per customer message).
///
/// # Errors
/// Everything [`build_engine`] and [`workflow_env`] report.
pub(crate) fn prepare_engine_and_env(
    flow_yaml: &str,
    credentials: &CredentialStore,
    db: &Database,
    model_source: &dyn ModelRegistrySource,
    tools: ToolRegistry,
) -> AppResult<(Engine, IndexMap<String, Value>)> {
    let engine = build_engine(flow_yaml, credentials, db, model_source, tools)?;
    let env = workflow_env(flow_yaml, credentials)?;
    Ok((engine, env))
}
