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
use crate::flow::{self, TrustedHosts};
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
    trusted_hosts: &TrustedHosts,
    credentials: &CredentialStore,
    db: &Database,
    model_source: &dyn ModelRegistrySource,
    tools: ToolRegistry,
) -> AppResult<Engine> {
    ensure_plugins_installed(flow_yaml)?;
    let summary = flow::summarize_flow(flow_yaml)?;
    ensure_providers_configured(&summary.model_providers, credentials, db)?;
    let graph = flow::compile_flow_with_secret_env(flow_yaml, &keychain_env_names(&summary, credentials)?)?;
    ensure_lookups_trusted(&graph, trusted_hosts)?;
    let http_client = graphrt_http::HttpClient::new(egress_policy(&graph, trusted_hosts))
        .map_err(|error| AppError::Internal(format!("could not set up the HTTP client: {error}")))?;
    let services = Services::new().with(model_source.build_registry(credentials, db)?).with(http_client).with(tools);
    // Knowledge bases for the `knowledge-retrieval` node (stores open on first search).
    let services = services.with(crate::knowledge::knowledge_service_for_runs(db, credentials)?);
    // Files the user chose for `file` / `file-list` inputs (and data URLs).
    let services = services.with(super::chosen_files::run_file_resolver());
    Ok(Engine::new(Arc::new(graph)).with_services(services).with_limits(run_limits(db)))
}

/// `InvalidInput` naming the first lookup that only runs without asking once its
/// host is trusted, while it is not (the builder may save such a lookup after
/// proposing "Trust <host> for lookups"; the host may also have been removed since).
fn ensure_lookups_trusted(graph: &graphrt_core::Graph, trusted_hosts: &TrustedHosts) -> AppResult<()> {
    let untrusted_lookup = flow::unapproved_steps(graph, trusted_hosts)
        .into_iter()
        .find_map(|step| step.trustable_host.map(|host| (step.label, host)));
    match untrusted_lookup {
        None => Ok(()),
        Some((label, host)) => Err(AppError::InvalidInput(format!(
            "{label} looks up data on {host}, which this agent does not trust: trust {host} for lookups, or ask \
             before sending"
        ))),
    }
}

/// The run's HTTP rules: graphrt-http's defaults, except that a run with a
/// lookup that reads only because its host is trusted follows no redirects (a
/// 3xx response then fails that step). graphrt-http has no per-step redirect
/// setting, so the whole run stops following them; otherwise a trusted host
/// could bounce the lookup, with the values in its query, to a host nobody trusted.
pub(super) fn egress_policy(graph: &graphrt_core::Graph, trusted_hosts: &TrustedHosts) -> graphrt_http::EgressPolicy {
    let mut policy = graphrt_http::EgressPolicy::default();
    if flow::has_trusted_lookups(graph, trusted_hosts) {
        policy.max_redirects = 0;
    }
    policy
}

/// Declared env variables not typed `secret` whose value is stored in the
/// keychain: [`workflow_env`] passes those as secrets, so the run's graph
/// declares them `secret` too (graphrt checks supplied values against the type).
fn keychain_env_names(summary: &flow::FlowSummary, credentials: &CredentialStore) -> AppResult<Vec<String>> {
    let mut names = Vec::new();
    for variable in summary.env.iter().filter(|variable| !variable.is_secret) {
        if credentials.has_workflow_secret(&variable.name)? {
            names.push(variable.name.clone());
        }
    }
    Ok(names)
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
        Some(missing_provider) => {
            Err(AppError::MissingCredentials(match crate::local_cli::LocalCli::from_provider_name(missing_provider) {
                Some(cli) => format!("{} (turn it on in Connections > AI models)", cli.display_name()),
                None => missing_provider.clone(),
            }))
        }
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
/// Every value read from the keychain is passed as a graphrt secret, so it is
/// masked in events, logs and stored rows even when the document does not
/// declare the variable `type: secret`. A variable with no stored value falls
/// back to its declared default (plain, from the document); one with neither is
/// reported as missing.
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
            // Everything kept in the keychain is masked, whatever type the document
            // declares: a draft must not unmask a stored secret by leaving out `type: secret`.
            Some(stored_value) => {
                env.insert(variable.name, Value::Secret(Arc::from(stored_value.as_str())));
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
    trusted_hosts: &TrustedHosts,
    credentials: &CredentialStore,
    db: &Database,
    model_source: &dyn ModelRegistrySource,
    tools: ToolRegistry,
) -> AppResult<(Engine, IndexMap<String, Value>)> {
    let engine = build_engine(flow_yaml, trusted_hosts, credentials, db, model_source, tools)?;
    let env = workflow_env(flow_yaml, credentials)?;
    Ok((engine, env))
}
