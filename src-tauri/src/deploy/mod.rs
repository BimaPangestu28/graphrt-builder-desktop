//! "Put it online": running an agent with an online provider (Fly.io today) or on a server an
//! IT team runs, from the desktop.
//!
//! - [`cli_release`]: the pinned graphrt CLI, downloaded on demand with the user's OK
//! - [`providers`]: online accounts and checking their credentials (stored in the keychain)
//! - [`compatibility`]: what must change before an agent can run online, with one-click fixes
//! - [`plan`]: the keys an online copy needs, by friendly name
//! - [`cli`]: `graphrt deploy` with secrets passed only as environment variables
//! - [`http`]: health checks, online runs and the Fly.io key check
//!
//! [`DeployService`] ties them to the database (`storage::deployments`) and the keychain.
//! Keychain names (`CredentialStore::set_deploy_secret`): `account:<provider>` (the provider
//! credential JSON), `key:<agent id>` (a deployment's API key, shown once), `server:<id>`.

pub mod cli;
pub mod cli_release;
pub mod compatibility;
pub mod fixes;
pub mod http;
pub mod plan;
pub mod providers;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use self::cli::{CliEvent, CliLine, DeployRequest, DeployStep, ManageAction, StepStatus};
use self::compatibility::{CompatibilityFacts, CompatibilityFix, CompatibilityReport, KeyFacts, PluginFacts};
use self::http::{CloudRun, DeployHttp, HealthCheck};
use self::plan::{KeyToCopy, KeyToCopyView, PluginSettings};
use self::providers::{DeployAccountInput, DeployProvider, ALL_DEPLOY_PROVIDERS};
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::plugins::download::Downloader;
use crate::plugins::requirements::PluginRequirement;
use crate::storage::deployments::{DeployMode, DeploymentRecord, DeploymentStatus, OwnServer};
use crate::storage::models::Agent;
use crate::storage::{now_rfc3339, Database};

/// Tauri event carrying deploy progress ([`DeployEvent`]).
pub const DEPLOY_EVENT: &str = "deploy-event";
/// `agent_settings` key of the deployed versions ([`DeployedVersion`]).
const DEPLOY_HISTORY_KEY: &str = "deploy_history";
/// Settings key prefix of an account's non-secret summary.
const ACCOUNT_SUMMARY_SETTING_PREFIX: &str = "deploy_account_summary:";
const CLI_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Debug builds only: use this graphrt binary instead of the downloaded one (development).
const DEV_CLI_PATH_ENV: &str = "GRAPHRT_DEPLOY_CLI";

/// Server locations people pick ("Closest to Asia") and Fly.io's region for each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerArea {
    Asia,
    Europe,
    Us,
}

impl ServerArea {
    /// The Fly.io region code: Singapore, Frankfurt, Ashburn (Virginia).
    pub fn fly_region(self) -> &'static str {
        match self {
            Self::Asia => "sin",
            Self::Europe => "fra",
            Self::Us => "iad",
        }
    }

    pub fn from_fly_region(region: &str) -> Option<Self> {
        [Self::Asia, Self::Europe, Self::Us].into_iter().find(|area| area.fly_region() == region)
    }
}

/// Whether the graphrt tools can be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CliStatus {
    /// No release is pinned in this app build (or none for this computer).
    NotAvailable,
    NotInstalled,
    Installing,
    Installed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub status: CliStatus,
    pub version: Option<String>,
    pub download_size_bytes: Option<u64>,
}

/// One row of "Online accounts".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployAccount {
    pub provider: DeployProvider,
    pub display_name: String,
    pub connected: bool,
    pub summary: Option<String>,
    /// Whether agents can be put online with it in this release.
    pub can_deploy: bool,
    /// Names of the agents online with it.
    pub used_by_agents: Vec<String>,
}

/// Progress of a deploy, sent as [`DEPLOY_EVENT`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DeployEvent {
    Step { agent_id: String, step: DeployStep, status: StepStatus, message: Option<String> },
    Log { agent_id: String, line: String },
}

/// Delivers [`DeployEvent`]s: Tauri in the app, a recorder in tests.
pub trait DeployEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, event: DeployEvent);
}

#[derive(Debug)]
pub struct TauriDeployEventSink {
    app_handle: AppHandle,
}

impl TauriDeployEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl DeployEventSink for TauriDeployEventSink {
    fn send(&self, event: DeployEvent) {
        if let Err(error) = self.app_handle.emit(DEPLOY_EVENT, event) {
            log::warn!("could not emit deploy event: {error}");
        }
    }
}

/// What the Review screen shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployReview {
    pub provider: DeployProvider,
    pub provider_connected: bool,
    pub can_deploy: bool,
    pub deployment_name: String,
    /// e.g. `menu-chatbot-1a2b.fly.dev` (the provider may give another one).
    pub expected_address: String,
    pub keys: Vec<KeyToCopyView>,
    pub cli: CliInfo,
    pub mode: DeployMode,
    pub area: ServerArea,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployOptions {
    pub provider: DeployProvider,
    pub mode: DeployMode,
    pub area: ServerArea,
}

/// The agent's online state for the builder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentView {
    pub deployment: DeploymentRecord,
    pub provider_name: String,
    pub area: Option<ServerArea>,
    /// The agent changed since the online version was deployed.
    pub has_changes: bool,
    pub agent_version: i64,
    /// A deployment API key is saved (for Runs).
    pub has_api_key: bool,
}

/// A finished deploy. `api_key` is the only time the key leaves the backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployOutcome {
    pub view: DeploymentView,
    pub api_key: Option<String>,
}

/// One deployed version of an agent ("History").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployedVersion {
    pub label: String,
    pub agent_version: i64,
    pub change_summary: String,
    pub deployed_at: String,
    #[serde(default)]
    pub is_current: bool,
}

/// A run of an online agent or a connected server, for Runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineRun {
    pub agent_id: Option<String>,
    /// The agent's name, or the server's.
    pub source_name: String,
    /// "Fly.io", or the server's name.
    pub place: String,
    pub run: CloudRun,
}

/// Online runs from every source, and the sources that could not be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineRuns {
    pub runs: Vec<OnlineRun>,
    pub problems: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnServerView {
    pub server: OwnServer,
    pub health: Option<HealthCheck>,
}

pub struct DeployServiceConfig {
    pub app_data_dir: PathBuf,
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub downloader: Option<Arc<dyn Downloader>>,
    pub http: Arc<dyn DeployHttp>,
    pub events: Arc<dyn DeployEventSink>,
}

/// See the module docs. Cheap to share (`Arc<DeployService>`).
pub struct DeployService {
    runtime_dir: PathBuf,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    downloader: Option<Arc<dyn Downloader>>,
    http: Arc<dyn DeployHttp>,
    events: Arc<dyn DeployEventSink>,
    /// Tests and development: this executable instead of the downloaded one.
    cli_override: Option<PathBuf>,
    install_lock: tokio::sync::Mutex<()>,
    installing: std::sync::atomic::AtomicBool,
    /// One cancel signal per agent with a deploy running.
    running_deploys: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

impl std::fmt::Debug for DeployService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("DeployService").field("runtime_dir", &self.runtime_dir).finish_non_exhaustive()
    }
}

/// `menu-questions-chatbot-1a2b3c`: lowercase letters, digits and dashes, at most 48 characters.
pub fn deployment_name_for(agent: &Agent) -> String {
    let mut slug = String::new();
    for character in agent.name.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug: String = slug.trim_matches('-').chars().take(40).collect();
    let suffix: String =
        agent.id.chars().filter(char::is_ascii_alphanumeric).take(6).collect::<String>().to_lowercase();
    let base = if slug.is_empty() { "agent".to_owned() } else { slug.trim_end_matches('-').to_owned() };
    format!("{base}-{suffix}")
}

/// `v1` after nothing, `v4` after `v3`.
pub fn next_version_label(current: Option<&str>) -> String {
    let number = current.and_then(|label| label.strip_prefix('v')?.parse::<u64>().ok()).unwrap_or(0);
    format!("v{}", number + 1)
}

/// The deployment's state from `graphrt deploy status --json` output (lenient: the last object
/// with a `status` / `state` field).
pub fn status_from_cli(json: &[serde_json::Value]) -> Option<DeploymentStatus> {
    let state = json.iter().rev().find_map(|value| {
        value.get("status").or_else(|| value.get("state")).and_then(serde_json::Value::as_str).map(str::to_lowercase)
    })?;
    Some(match state.as_str() {
        "running" | "started" | "ok" | "healthy" | "working" | "deployed" => DeploymentStatus::Working,
        "stopped" | "paused" | "suspended" | "scaled_to_zero" => DeploymentStatus::Paused,
        _ => DeploymentStatus::NeedsAttention,
    })
}

/// Version labels from `graphrt deploy list-versions --json` (an array, `versions`, or one object per line).
pub fn version_labels_from_cli(json: &[serde_json::Value]) -> Vec<String> {
    let entries: Vec<&serde_json::Value> = json
        .iter()
        .flat_map(|value| match value {
            serde_json::Value::Array(items) => items.iter().collect::<Vec<_>>(),
            serde_json::Value::Object(_) => match value.get("versions").and_then(serde_json::Value::as_array) {
                Some(items) => items.iter().collect(),
                None => vec![value],
            },
            _ => Vec::new(),
        })
        .collect();
    entries
        .iter()
        .filter_map(|entry| match entry {
            serde_json::Value::String(label) => Some(label.clone()),
            _ => entry
                .get("version")
                .or_else(|| entry.get("label"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        })
        .collect()
}

impl DeployService {
    pub fn new(config: DeployServiceConfig) -> Self {
        let cli_override = cfg!(debug_assertions)
            .then(|| std::env::var_os(DEV_CLI_PATH_ENV).map(PathBuf::from))
            .flatten()
            .filter(|path| path.is_file());
        Self {
            runtime_dir: config.app_data_dir.join(crate::node_runtime::release::RUNTIME_DIR_NAME),
            db: config.db,
            credentials: config.credentials,
            downloader: config.downloader,
            http: config.http,
            events: config.events,
            cli_override,
            install_lock: tokio::sync::Mutex::new(()),
            installing: std::sync::atomic::AtomicBool::new(false),
            running_deploys: Mutex::new(HashMap::new()),
        }
    }

    /// Tests: run this executable as `graphrt`.
    #[cfg(test)]
    pub(crate) fn with_cli_executable(mut self, executable: PathBuf) -> Self {
        self.cli_override = Some(executable);
        self
    }

    // ---- graphrt tools ----

    fn installed_cli(&self) -> Option<PathBuf> {
        if let Some(path) = &self.cli_override {
            return Some(path.clone());
        }
        let version = cli_release::GRAPHRT_CLI_VERSION?;
        let path = cli_release::installed_executable(&self.runtime_dir, version);
        path.is_file().then_some(path)
    }

    pub fn cli_info(&self) -> CliInfo {
        let archive = cli_release::archive_for_this_computer();
        let status = if self.installed_cli().is_some() {
            CliStatus::Installed
        } else if archive.is_none() {
            CliStatus::NotAvailable
        } else if self.installing.load(std::sync::atomic::Ordering::SeqCst) {
            CliStatus::Installing
        } else {
            CliStatus::NotInstalled
        };
        CliInfo {
            status,
            version: cli_release::GRAPHRT_CLI_VERSION.map(str::to_owned),
            download_size_bytes: archive.map(|archive| archive.size_bytes),
        }
    }

    /// Downloads, verifies and installs the pinned graphrt tools. Only for an explicit OK.
    ///
    /// # Errors
    /// `InvalidInput` when no release is pinned ("not available yet") or the download is not
    /// the pinned one; `Internal` when offline.
    pub async fn install_cli(&self) -> AppResult<CliInfo> {
        let _exclusive = self.install_lock.lock().await;
        if self.installed_cli().is_some() {
            return Ok(self.cli_info());
        }
        let (Some(version), Some(archive)) =
            (cli_release::GRAPHRT_CLI_VERSION, cli_release::archive_for_this_computer())
        else {
            return Err(AppError::InvalidInput("Online deploy is not available yet in this version of graphrt".into()));
        };
        let url = cli_release::download_url(version, archive);
        if !cli_release::is_allowed_download_url(&url) {
            return Err(AppError::InvalidInput(format!("refused to download the graphrt tools from {url}")));
        }
        let downloader = self
            .downloader
            .clone()
            .ok_or_else(|| AppError::Internal("the graphrt tools cannot be downloaded here".into()))?;
        self.installing.store(true, std::sync::atomic::Ordering::SeqCst);
        let result = async {
            let bytes = downloader.fetch(&url, cli_release::MAX_ARCHIVE_BYTES, CLI_DOWNLOAD_TIMEOUT, None).await?;
            let runtime_dir = self.runtime_dir.clone();
            let archive = *archive;
            tokio::task::spawn_blocking(move || {
                cli_release::install_from_archive(&runtime_dir, &bytes, version, &archive, &check_cli_runs)
            })
            .await
            .map_err(|error| AppError::Internal(format!("the install task stopped: {error}")))?
        }
        .await;
        self.installing.store(false, std::sync::atomic::Ordering::SeqCst);
        let executable = result?;
        log::info!("installed the graphrt tools {version} at {}", executable.display());
        Ok(self.cli_info())
    }

    fn require_cli(&self) -> AppResult<PathBuf> {
        self.installed_cli().ok_or_else(|| {
            if cli_release::archive_for_this_computer().is_none() {
                AppError::InvalidInput("Online deploy is not available yet in this version of graphrt".into())
            } else {
                AppError::InvalidInput("Download the graphrt tools first (Review › Allow download)".into())
            }
        })
    }

    // ---- online accounts ----

    fn account_secret_name(provider: DeployProvider) -> String {
        format!("account:{}", provider.key())
    }

    fn account_summary(&self, provider: DeployProvider) -> AppResult<Option<String>> {
        self.db.get_setting(&format!("{ACCOUNT_SUMMARY_SETTING_PREFIX}{}", provider.key()))
    }

    pub fn list_accounts(&self) -> AppResult<Vec<DeployAccount>> {
        let deployments = self.db.list_deployments()?;
        let agent_names: HashMap<String, String> =
            self.db.list_agents()?.into_iter().map(|agent| (agent.id, agent.name)).collect();
        ALL_DEPLOY_PROVIDERS
            .into_iter()
            .map(|provider| {
                let summary = self.account_summary(provider)?;
                Ok(DeployAccount {
                    provider,
                    display_name: provider.display_name().to_owned(),
                    connected: summary.is_some(),
                    summary,
                    can_deploy: provider.can_deploy(),
                    used_by_agents: deployments
                        .iter()
                        .filter(|deployment| deployment.provider == provider)
                        .filter_map(|deployment| agent_names.get(&deployment.agent_id).cloned())
                        .collect(),
                })
            })
            .collect()
    }

    /// Checks and saves an account; Fly.io keys are also checked with Fly.io (read-only).
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence when the details are not usable.
    pub async fn connect_account(&self, input: &DeployAccountInput) -> AppResult<DeployAccount> {
        let checked = providers::check_account(input)?;
        if let DeployAccountInput::Fly { access_token } = input {
            http::check_fly_token_online(self.http.as_ref(), access_token.trim()).await?;
        }
        self.credentials.set_deploy_secret(&Self::account_secret_name(checked.provider), &checked.secret_json)?;
        self.db
            .set_setting(&format!("{ACCOUNT_SUMMARY_SETTING_PREFIX}{}", checked.provider.key()), &checked.summary)?;
        log::info!("connected the {} online account", checked.provider.display_name());
        self.list_accounts()?
            .into_iter()
            .find(|account| account.provider == checked.provider)
            .ok_or_else(|| AppError::Internal("the account was not saved".into()))
    }

    /// Forgets the account's key. Agents already online stay online.
    pub fn disconnect_account(&self, provider: DeployProvider) -> AppResult<()> {
        self.credentials.delete_deploy_secret(&Self::account_secret_name(provider))?;
        let key = format!("{ACCOUNT_SUMMARY_SETTING_PREFIX}{}", provider.key());
        self.db.lock()?.execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(())
    }

    /// The environment variables carrying a provider's credential to the graphrt process.
    fn provider_environment(&self, provider: DeployProvider) -> AppResult<Vec<(String, String)>> {
        let stored = self.credentials.read_deploy_secret(&Self::account_secret_name(provider))?.ok_or_else(|| {
            AppError::MissingCredentials(format!(
                "your {} account (connect it in Online accounts)",
                provider.display_name()
            ))
        })?;
        let credential: serde_json::Value = serde_json::from_str(&stored)?;
        match provider {
            DeployProvider::Fly => {
                let token = credential.get("token").and_then(serde_json::Value::as_str).unwrap_or_default();
                Ok(vec![(cli::FLY_TOKEN_ENV.to_owned(), token.to_owned())])
            }
            other => Err(AppError::InvalidInput(format!(
                "Putting agents online with {} is coming soon",
                other.display_name()
            ))),
        }
    }

    // ---- compatibility, review ----

    fn plugin_settings(requirements: &[PluginRequirement]) -> Vec<PluginSettings> {
        requirements
            .iter()
            .filter(|requirement| !requirement.needs_browser && !requirement.needs_session)
            .map(|requirement| PluginSettings {
                name: requirement.name.clone(),
                display_name: requirement.display_name.clone(),
                variables: requirement.permissions.env.clone(),
            })
            .collect()
    }

    fn keys_for(&self, agent: &Agent, requirements: &[PluginRequirement]) -> AppResult<Vec<KeyToCopy>> {
        let summary = crate::flow::summarize_flow(&agent.flow_yaml)?;
        plan::keys_to_copy(
            &self.credentials,
            &summary.model_providers,
            &summary.env,
            &Self::plugin_settings(requirements),
        )
    }

    /// The checklist for the agent. `whatsapp_cloud_available`: the WhatsApp Business plugin is known.
    pub fn check_compatibility(
        &self,
        agent: &Agent,
        requirements: &[PluginRequirement],
        whatsapp_cloud_available: bool,
    ) -> AppResult<CompatibilityReport> {
        let summary = crate::flow::summarize_flow(&agent.flow_yaml)?;
        let keys = self.keys_for(agent, requirements)?;
        let mut connected_api_providers = Vec::new();
        if let Ok(choice) = crate::credentials::default_model(&self.credentials, &self.db) {
            if choice.provider.uses_api_key() {
                connected_api_providers.push(choice.provider);
            }
        }
        for (provider, _) in crate::credentials::RECOMMENDED_MODELS {
            if !connected_api_providers.contains(&provider)
                && self.credentials.read_provider_key_for_deploy(provider)?.is_some()
            {
                connected_api_providers.push(provider);
            }
        }
        let facts = CompatibilityFacts {
            model_providers: summary.model_providers.clone(),
            plugins: requirements
                .iter()
                .map(|requirement| PluginFacts {
                    name: requirement.name.clone(),
                    display_name: requirement.display_name.clone(),
                    needs_browser: requirement.needs_browser,
                    needs_session: requirement.needs_session,
                })
                .collect(),
            uses_knowledge: summary.steps.iter().any(|step| step.node_type == "knowledge-retrieval"),
            keys: keys
                .iter()
                // Keys of providers being switched away from are not needed; local providers have none.
                .map(|key| KeyFacts { friendly_name: key.friendly_name.clone(), is_saved: key.is_saved })
                .collect(),
            connected_api_providers,
            whatsapp_cloud_available,
        };
        Ok(compatibility::check_compatibility(&facts))
    }

    /// Applies a model switch (a new agent version, undoable from History).
    ///
    /// # Errors
    /// `InvalidInput` for fixes that are not applied here (WhatsApp goes through the builder).
    pub fn apply_model_fix(&self, agent_id: &str, fix: &CompatibilityFix) -> AppResult<Agent> {
        let CompatibilityFix::SwitchModel { from_provider, to_provider, to_provider_name } = fix else {
            return Err(AppError::InvalidInput("this fix is made in the builder chat".into()));
        };
        let model_name = crate::credentials::RECOMMENDED_MODELS
            .iter()
            .find(|(provider, _)| provider == to_provider)
            .map(|(_, name)| (*name).to_owned())
            .or_else(|| {
                crate::credentials::default_model(&self.credentials, &self.db)
                    .ok()
                    .filter(|choice| choice.provider == *to_provider)
                    .map(|choice| choice.name)
            })
            .ok_or_else(|| AppError::InvalidInput(format!("{to_provider_name} has no model to switch to")))?;
        let agent = self.db.get_agent(agent_id)?;
        let (flow_yaml, changed) =
            fixes::switch_model_provider(&agent.flow_yaml, from_provider, to_provider.registry_name(), &model_name)?;
        crate::flow::summarize_flow(&flow_yaml)?;
        let summary = format!("Switched {changed} AI step(s) to {to_provider_name} so it can run online");
        self.db.update_agent_flow(agent_id, &flow_yaml, &summary)
    }

    pub fn review(
        &self,
        agent: &Agent,
        requirements: &[PluginRequirement],
        provider: DeployProvider,
    ) -> AppResult<DeployReview> {
        let existing = self.db.get_deployment(&agent.id)?;
        let deployment_name =
            existing.as_ref().map_or_else(|| deployment_name_for(agent), |record| record.deployment_name.clone());
        let expected_address = existing
            .as_ref()
            .and_then(|record| record.url.clone())
            .unwrap_or_else(|| format!("{deployment_name}.fly.dev"))
            .trim_start_matches("https://")
            .to_owned();
        Ok(DeployReview {
            provider,
            provider_connected: self.account_summary(provider)?.is_some(),
            can_deploy: provider.can_deploy(),
            deployment_name,
            expected_address,
            keys: self.keys_for(agent, requirements)?.iter().map(KeyToCopy::view).collect(),
            cli: self.cli_info(),
            mode: existing.as_ref().map_or(DeployMode::ScaleToZero, |record| record.mode),
            area: existing
                .as_ref()
                .and_then(|record| record.region.as_deref())
                .and_then(ServerArea::from_fly_region)
                .unwrap_or(ServerArea::Us),
        })
    }

    // ---- deploying ----

    /// Stops the agent's deploy between steps (the graphrt process is killed).
    pub fn cancel_deploy(&self, agent_id: &str) -> bool {
        let cancel = self.running_deploys.lock().ok().and_then(|running| running.get(agent_id).cloned());
        cancel.map(|notify| notify.notify_one()).is_some()
    }

    /// Puts the agent online (or updates the online copy) with `graphrt deploy`. Progress goes to
    /// [`DEPLOY_EVENT`]. Returns the deployment and, once, its API key.
    ///
    /// # Errors
    /// `InvalidInput` when the provider cannot deploy yet, the tools are missing, keys are not
    /// saved, or the agent is not ready; `Conflict` when a deploy is already running or was
    /// cancelled; otherwise the CLI's plain error message.
    pub async fn deploy(
        &self,
        agent_id: &str,
        options: DeployOptions,
        requirements: &[PluginRequirement],
        report: &CompatibilityReport,
    ) -> AppResult<DeployOutcome> {
        if !options.provider.can_deploy() {
            return Err(AppError::InvalidInput(format!(
                "Putting agents online with {} is coming soon",
                options.provider.display_name()
            )));
        }
        if !report.ready {
            return Err(AppError::InvalidInput("Fix the items in the checklist before putting it online".into()));
        }
        let executable = self.require_cli()?;
        let agent = self.db.get_agent(agent_id)?;
        let keys = self.keys_for(&agent, requirements)?;
        if let Some(missing) = keys.iter().find(|key| !key.is_saved) {
            return Err(AppError::MissingCredentials(missing.friendly_name.clone()));
        }
        let mut environment_extra = self.provider_environment(options.provider)?;
        for key in &keys {
            let value = plan::read_key_value(&self.credentials, key)?
                .ok_or_else(|| AppError::MissingCredentials(key.friendly_name.clone()))?;
            environment_extra.push((key.env_name.clone(), value));
        }
        let environment = cli::compose_environment(|name| std::env::var(name).ok(), &environment_extra);

        let cancel = Arc::new(tokio::sync::Notify::new());
        {
            let mut running =
                self.running_deploys.lock().map_err(|_| AppError::Internal("deploy lock poisoned".into()))?;
            if running.contains_key(agent_id) {
                return Err(AppError::Conflict("This agent is already being put online".into()));
            }
            running.insert(agent_id.to_owned(), cancel.clone());
        }
        let result = self.run_deploy(&agent, options, &keys, &executable, &environment, cancel).await;
        if let Ok(mut running) = self.running_deploys.lock() {
            running.remove(agent_id);
        }
        result
    }

    async fn run_deploy(
        &self,
        agent: &Agent,
        options: DeployOptions,
        keys: &[KeyToCopy],
        executable: &Path,
        environment: &[(String, String)],
        cancel: Arc<tokio::sync::Notify>,
    ) -> AppResult<DeployOutcome> {
        let previous = self.db.get_deployment(&agent.id)?;
        let is_first = previous.as_ref().is_none_or(|record| record.status == DeploymentStatus::Failed);
        let version_label =
            next_version_label(previous.as_ref().and_then(|record| record.deployed_version_label.as_deref()));
        let mut record = previous.clone().unwrap_or_else(|| DeploymentRecord {
            agent_id: agent.id.clone(),
            provider: options.provider,
            deployment_name: deployment_name_for(agent),
            app: None,
            url: None,
            region: None,
            mode: options.mode,
            deployed_version_label: None,
            deployed_agent_version: None,
            status: DeploymentStatus::Deploying,
            status_message: None,
            status_checked_at: None,
            created_at: String::new(),
            updated_at: String::new(),
        });
        record.provider = options.provider;
        record.mode = options.mode;
        record.region = Some(options.area.fly_region().to_owned());
        if is_first {
            record.status = DeploymentStatus::Deploying;
        }
        self.db.save_deployment(&record)?;

        let work_dir =
            tempfile::tempdir().map_err(|error| AppError::Internal(format!("no temporary folder: {error}")))?;
        let agent_file = work_dir.path().join("agent.yaml");
        std::fs::write(&agent_file, &agent.flow_yaml)
            .map_err(|error| AppError::Internal(format!("could not write the agent file: {error}")))?;
        let request = DeployRequest {
            target: options.provider,
            deployment: record.deployment_name.clone(),
            version_label: version_label.clone(),
            region: record.region.clone(),
            mode: options.mode,
            org: None,
            secret_names: keys.iter().map(|key| key.env_name.clone()).collect(),
            agent_file,
        };
        let events = self.events.clone();
        let agent_id = agent.id.clone();
        let on_line: cli::LineCallback = Arc::new(move |line| match line {
            CliLine::Event(CliEvent::Step { step, status, message }) => events.send(DeployEvent::Step {
                agent_id: agent_id.clone(),
                step: *step,
                status: *status,
                message: message.clone(),
            }),
            CliLine::Event(CliEvent::Error { message, .. }) => {
                events.send(DeployEvent::Log { agent_id: agent_id.clone(), line: format!("error: {message}") })
            }
            CliLine::Text(text) if !text.is_empty() => {
                events.send(DeployEvent::Log { agent_id: agent_id.clone(), line: text.clone() })
            }
            CliLine::Json(value) => {
                events.send(DeployEvent::Log { agent_id: agent_id.clone(), line: value.to_string() })
            }
            _ => {}
        });
        log::info!("putting agent {} online as {} {version_label}", agent.id, record.deployment_name);
        let output = cli::run_cli(
            executable,
            &cli::deploy_arguments(&request),
            environment,
            cli::DEPLOY_TIMEOUT,
            cancel,
            on_line,
        )
        .await;
        let output = match output {
            Ok(output) => output,
            Err(error) => {
                self.record_failure(&record, is_first, &error.to_string())?;
                return Err(error);
            }
        };
        let Some(CliEvent::Result { url, version, app, api_key }) = output.result().cloned() else {
            let message = output
                .error()
                .map(|(_, message)| message.clone())
                .unwrap_or_else(|| "The graphrt tools stopped without saying why. See Details".into());
            self.record_failure(&record, is_first, &message)?;
            return Err(AppError::Internal(message));
        };
        if let Some(key) = api_key.as_deref() {
            self.credentials.set_deploy_secret(&format!("key:{}", agent.id), key)?;
        }
        record.url = Some(url);
        record.app = app.or(record.app);
        record.deployed_version_label = Some(version.clone());
        record.deployed_agent_version = Some(agent.current_version);
        record.status = DeploymentStatus::Working;
        record.status_message = None;
        record.status_checked_at = Some(now_rfc3339());
        self.db.save_deployment(&record)?;
        self.append_history(agent, &version)?;
        Ok(DeployOutcome {
            view: self.view(&agent.id)?.ok_or_else(|| AppError::Internal("deployment lost".into()))?,
            api_key,
        })
    }

    fn record_failure(&self, record: &DeploymentRecord, is_first: bool, message: &str) -> AppResult<()> {
        if is_first {
            let mut failed = record.clone();
            failed.status = DeploymentStatus::Failed;
            failed.status_message = Some(message.to_owned());
            self.db.save_deployment(&failed)?;
        }
        Ok(())
    }

    fn history(&self, agent_id: &str) -> AppResult<Vec<DeployedVersion>> {
        Ok(self
            .db
            .get_agent_setting(agent_id, DEPLOY_HISTORY_KEY)?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default())
    }

    fn append_history(&self, agent: &Agent, label: &str) -> AppResult<()> {
        let mut history = self.history(&agent.id)?;
        let change_summary = self
            .db
            .get_agent_version(&agent.id, agent.current_version)
            .map(|version| version.change_summary)
            .unwrap_or_default();
        history.retain(|entry| entry.label != label);
        history.push(DeployedVersion {
            label: label.to_owned(),
            agent_version: agent.current_version,
            change_summary,
            deployed_at: now_rfc3339(),
            is_current: false,
        });
        self.db.set_agent_setting(&agent.id, DEPLOY_HISTORY_KEY, &serde_json::to_value(history)?)
    }

    // ---- the deployed state ----

    pub fn view(&self, agent_id: &str) -> AppResult<Option<DeploymentView>> {
        let Some(deployment) = self.db.get_deployment(agent_id)? else { return Ok(None) };
        let agent = self.db.get_agent(agent_id)?;
        Ok(Some(DeploymentView {
            has_changes: deployment.deployed_agent_version.is_some_and(|version| version != agent.current_version),
            agent_version: agent.current_version,
            provider_name: deployment.provider.display_name().to_owned(),
            area: deployment.region.as_deref().and_then(ServerArea::from_fly_region),
            has_api_key: self.credentials.read_deploy_secret(&format!("key:{agent_id}"))?.is_some(),
            deployment,
        }))
    }

    fn require_deployment(&self, agent_id: &str) -> AppResult<DeploymentRecord> {
        self.db.get_deployment(agent_id)?.ok_or_else(|| AppError::NotFound("this agent's online copy".into()))
    }

    async fn run_manage(&self, record: &DeploymentRecord, action: &ManageAction) -> AppResult<cli::CliOutput> {
        let executable = self.require_cli()?;
        let environment =
            cli::compose_environment(|name| std::env::var(name).ok(), &self.provider_environment(record.provider)?);
        let arguments = cli::manage_arguments(action, record.provider, &record.deployment_name);
        cli::run_cli(
            &executable,
            &arguments,
            &environment,
            cli::MANAGE_TIMEOUT,
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(|_| {}),
        )
        .await
    }

    /// Pause, resume, roll back or take offline. Returns the new state (`None` after removing).
    ///
    /// # Errors
    /// The CLI's plain message when the provider refused.
    pub async fn manage(&self, agent_id: &str, action: ManageAction) -> AppResult<Option<DeploymentView>> {
        let record = self.require_deployment(agent_id)?;
        if action == ManageAction::Status {
            return self.refresh_status(agent_id).await;
        }
        let output = self.run_manage(&record, &action).await?;
        output.ensure_success("The change")?;
        match &action {
            ManageAction::Pause => {
                self.db.set_deployment_status(agent_id, DeploymentStatus::Paused, Some("Paused by you"))?;
            }
            ManageAction::Resume => {
                self.db.set_deployment_status(agent_id, DeploymentStatus::Working, None)?;
            }
            ManageAction::Rollback { version } => {
                let history = self.history(agent_id)?;
                let mut updated = record.clone();
                updated.deployed_version_label = Some(version.clone());
                updated.deployed_agent_version =
                    history.iter().find(|entry| &entry.label == version).map(|entry| entry.agent_version);
                self.db.save_deployment(&updated)?;
            }
            ManageAction::Remove => {
                self.db.delete_deployment(agent_id)?;
                self.credentials.delete_deploy_secret(&format!("key:{agent_id}"))?;
                self.db.set_agent_setting(agent_id, DEPLOY_HISTORY_KEY, &serde_json::json!([]))?;
                log::info!("took agent {agent_id} offline");
                return Ok(None);
            }
            ManageAction::Status | ManageAction::ListVersions => {}
        }
        self.view(agent_id)
    }

    /// Deployed versions, newest first; the CLI's list (when it answers) drops ones it no longer has.
    pub async fn list_versions(&self, agent_id: &str) -> AppResult<Vec<DeployedVersion>> {
        let record = self.require_deployment(agent_id)?;
        let mut history = self.history(agent_id)?;
        if self.installed_cli().is_some() {
            match self.run_manage(&record, &ManageAction::ListVersions).await {
                Ok(output) if output.exit_success => {
                    let labels = version_labels_from_cli(&output.json);
                    if !labels.is_empty() {
                        history.retain(|entry| labels.contains(&entry.label));
                    }
                }
                Ok(_) | Err(_) => {
                    log::info!("could not list the online versions of agent {agent_id}; showing the saved ones")
                }
            }
        }
        for entry in &mut history {
            entry.is_current = record.deployed_version_label.as_deref() == Some(entry.label.as_str());
        }
        history.reverse();
        Ok(history)
    }

    /// Checks the online agent (`GET /healthz`, plus `graphrt deploy status` when the tools are
    /// there) and caches the result. A paused agent stays paused.
    pub async fn refresh_status(&self, agent_id: &str) -> AppResult<Option<DeploymentView>> {
        let record = self.require_deployment(agent_id)?;
        if matches!(record.status, DeploymentStatus::Paused | DeploymentStatus::Deploying | DeploymentStatus::Failed) {
            return self.view(agent_id);
        }
        let Some(url) = record.url.clone() else { return self.view(agent_id) };
        let health = http::check_health(self.http.as_ref(), &url).await;
        let (status, message) = if health.healthy {
            (DeploymentStatus::Working, None)
        } else {
            let from_cli = match self.installed_cli() {
                Some(_) => self
                    .run_manage(&record, &ManageAction::Status)
                    .await
                    .ok()
                    .and_then(|output| status_from_cli(&output.json)),
                None => None,
            };
            (
                from_cli.unwrap_or(DeploymentStatus::NeedsAttention),
                Some(format!("We couldn't reach it: {}", health.message)),
            )
        };
        self.db.set_deployment_status(agent_id, status, message.as_deref())?;
        self.view(agent_id)
    }

    // ---- online runs ----

    /// Runs from every online agent with a saved key and every connected server.
    pub async fn online_runs(&self, limit: u32) -> AppResult<OnlineRuns> {
        let limit = limit.clamp(1, 200);
        let agent_names: HashMap<String, String> =
            self.db.list_agents()?.into_iter().map(|agent| (agent.id, agent.name)).collect();
        let mut runs = Vec::new();
        let mut problems = Vec::new();
        for deployment in self.db.list_deployments()? {
            let (Some(url), Some(api_key)) =
                (deployment.url.clone(), self.credentials.read_deploy_secret(&format!("key:{}", deployment.agent_id))?)
            else {
                continue;
            };
            let name =
                agent_names.get(&deployment.agent_id).cloned().unwrap_or_else(|| deployment.deployment_name.clone());
            match http::fetch_cloud_runs(self.http.as_ref(), &url, &api_key, limit).await {
                Ok(found) => runs.extend(found.into_iter().map(|run| OnlineRun {
                    agent_id: Some(deployment.agent_id.clone()),
                    source_name: name.clone(),
                    place: deployment.provider.display_name().to_owned(),
                    run,
                })),
                Err(error) => problems.push(format!("{name}: {error}")),
            }
        }
        for server in self.db.list_own_servers()? {
            let Some(api_key) = self.credentials.read_deploy_secret(&format!("server:{}", server.id))? else {
                continue;
            };
            match http::fetch_cloud_runs(self.http.as_ref(), &server.url, &api_key, limit).await {
                Ok(found) => runs.extend(found.into_iter().map(|run| OnlineRun {
                    agent_id: None,
                    source_name: run.workflow.clone().unwrap_or_else(|| server.name.clone()),
                    place: server.name.clone(),
                    run,
                })),
                Err(error) => problems.push(format!("{}: {error}", server.name)),
            }
        }
        runs.sort_by(|left, right| right.run.started_at.cmp(&left.run.started_at));
        Ok(OnlineRuns { runs, problems })
    }

    // ---- my own server ----

    pub async fn list_own_servers(&self) -> AppResult<Vec<OwnServerView>> {
        let mut views = Vec::new();
        for server in self.db.list_own_servers()? {
            let health = Some(http::check_health(self.http.as_ref(), &server.url).await);
            views.push(OwnServerView { server, health });
        }
        Ok(views)
    }

    /// Tests `GET /healthz` and an authenticated `GET /v1/runs`, then saves the server.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence when the server does not answer or refuses the key.
    pub async fn connect_own_server(&self, name: &str, url: &str, api_key: &str) -> AppResult<OwnServerView> {
        let parsed = http::check_server_url(url)?;
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::InvalidInput("Paste the server's access key".into()));
        }
        let base = parsed.as_str().trim_end_matches('/').to_owned();
        let health = http::check_health(self.http.as_ref(), &base).await;
        if !health.healthy {
            return Err(AppError::InvalidInput(format!("The server didn't answer. {}", health.message)));
        }
        http::fetch_cloud_runs(self.http.as_ref(), &base, api_key, 1).await.map_err(|error| match error {
            AppError::Credentials(_) => AppError::InvalidInput("The server didn't accept this access key".into()),
            other => AppError::InvalidInput(format!("The server answers but its runs can't be read: {other}")),
        })?;
        let server = self.db.add_own_server(name, &base)?;
        self.credentials.set_deploy_secret(&format!("server:{}", server.id), api_key)?;
        Ok(OwnServerView { server, health: Some(health) })
    }

    pub fn remove_own_server(&self, server_id: &str) -> AppResult<()> {
        self.db.remove_own_server(server_id)?;
        self.credentials.delete_deploy_secret(&format!("server:{server_id}"))
    }

    /// Writes the agent as a `.grt` bundle (or plain YAML when `path` ends in `.yaml` / `.yml`).
    /// Keys are never inside: the IT team adds them on the server.
    pub fn export_agent_file(&self, agent_id: &str, path: &Path) -> AppResult<PathBuf> {
        let agent = self.db.get_agent(agent_id)?;
        let extension =
            path.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase();
        let bytes = if extension == "yaml" || extension == "yml" {
            agent.flow_yaml.clone().into_bytes()
        } else {
            graphrt_bundle::BundleBuilder::new(deployment_name_for(&agent), format!("{}.0.0", agent.current_version))
                .description(agent.description.clone())
                .workflow("workflow.yaml", agent.flow_yaml.clone())
                .and_then(graphrt_bundle::BundleBuilder::build)
                .map_err(|error| AppError::Workflow(format!("could not build the agent file: {error}")))?
        };
        std::fs::write(path, bytes)
            .map_err(|error| AppError::Internal(format!("could not save {}: {error}", path.display())))?;
        Ok(path.to_path_buf())
    }

    /// Delete all data: forgets every deploy credential in the keychain (before the rows go).
    pub fn forget_all_secrets(&self) {
        let forget = |name: String| {
            if let Err(error) = self.credentials.delete_deploy_secret(&name) {
                log::warn!("could not remove a deploy credential: {error}");
            }
        };
        for provider in ALL_DEPLOY_PROVIDERS {
            forget(Self::account_secret_name(provider));
        }
        for deployment in self.db.list_deployments().unwrap_or_default() {
            forget(format!("key:{}", deployment.agent_id));
        }
        for server in self.db.list_own_servers().unwrap_or_default() {
            forget(format!("server:{}", server.id));
        }
    }
}

/// `graphrt --version` must run.
fn check_cli_runs(executable: &Path) -> AppResult<()> {
    let output = std::process::Command::new(executable)
        .arg("--version")
        .output()
        .map_err(|error| AppError::InvalidInput(format!("the graphrt tools do not start on this computer: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::InvalidInput("the graphrt tools do not start on this computer".into()))
    }
}
