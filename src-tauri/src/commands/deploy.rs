//! "Put it online" (see `crate::deploy`): the graphrt tools, online accounts, the compatibility
//! checklist, deploying and managing an agent's online copy, online runs and "My own server".
//! Deploy progress arrives as `deploy-event` Tauri events.

use std::path::PathBuf;

use tauri::State;

use crate::deploy::cli::ManageAction;
use crate::deploy::compatibility::{CompatibilityFix, CompatibilityReport, WHATSAPP_CLOUD_PLUGIN};
use crate::deploy::google_cloud::{self, ConsolePage, GoogleProject};
use crate::deploy::online::{OnlineFeatures, OwnServerInstructions};
use crate::deploy::phone::{DevicePairing, LiveFeatures, OnlineTarget, PairedDevice};
use crate::deploy::providers::{DeployAccountInput, DeployProvider};
use crate::deploy::{
    CliInfo, DeployAccount, DeployOptions, DeployOutcome, DeployReview, DeployedVersion, DeploymentView, OnlineRuns,
    OwnServerView, RotatedApiKey,
};
use crate::error::{AppError, AppResult};
use crate::plugins::requirements::PluginRequirement;
use crate::state::AppState;
use crate::storage::models::Agent;

fn plugin_requirements(state: &AppState, agent: &Agent) -> AppResult<Vec<PluginRequirement>> {
    state.plugins.requirements(&agent.flow_yaml)
}

fn compatibility_for(state: &AppState, agent: &Agent) -> AppResult<(CompatibilityReport, Vec<PluginRequirement>)> {
    let requirements = plugin_requirements(state, agent)?;
    let whatsapp_cloud_available = state.plugins.plugin_display_names().contains_key(WHATSAPP_CLOUD_PLUGIN);
    let report = state.deploy.check_compatibility(agent, &requirements, whatsapp_cloud_available)?;
    Ok((report, requirements))
}

/// Whether the graphrt tools are available, downloaded or downloading, and their size.
#[tauri::command]
pub fn graphrt_cli_info(state: State<'_, AppState>) -> CliInfo {
    state.deploy.cli_info()
}

/// Downloads the pinned graphrt tools. Only for an explicit "Allow download".
#[tauri::command]
pub async fn install_graphrt_cli(state: State<'_, AppState>) -> AppResult<CliInfo> {
    state.deploy.install_cli().await
}

#[tauri::command]
pub fn list_deploy_accounts(state: State<'_, AppState>) -> AppResult<Vec<DeployAccount>> {
    state.deploy.list_accounts()
}

/// Checks and saves an online account in the keychain. Key files are given as paths and read here.
#[tauri::command]
pub async fn connect_deploy_account(
    state: State<'_, AppState>,
    account: DeployAccountInput,
) -> AppResult<DeployAccount> {
    state.deploy.connect_account(&account).await
}

/// Forgets an online account (a Google sign in is also revoked at Google).
#[tauri::command]
pub async fn disconnect_deploy_account(state: State<'_, AppState>, provider: DeployProvider) -> AppResult<()> {
    state.deploy.disconnect_account(provider).await
}

/// The AWS profiles of this computer (`~/.aws`), never their keys.
#[tauri::command]
pub fn list_aws_profiles(state: State<'_, AppState>) -> Vec<crate::deploy::aws::AwsProfile> {
    state.deploy.aws_profiles()
}

/// Connects AWS with the access key of a profile of this computer (checked with AWS, kept in
/// the keychain).
#[tauri::command]
pub async fn connect_aws_profile(state: State<'_, AppState>, profile: String) -> AppResult<DeployAccount> {
    state.deploy.connect_aws_profile(&profile).await
}

/// "Sign in with Google" for Google Cloud: opens the browser, waits for the sign in (at most
/// five minutes) and keeps the sign in in the keychain.
#[tauri::command]
pub async fn sign_in_google_cloud(state: State<'_, AppState>) -> AppResult<DeployAccount> {
    let open_browser = |url: &str| crate::crash_reports::sharing::open_in_browser(url).map_err(|e| e.to_string());
    state.deploy.sign_in_google_cloud(&open_browser).await
}

/// The signed-in Google account's active projects, with whether billing is on.
#[tauri::command]
pub async fn list_google_cloud_projects(state: State<'_, AppState>) -> AppResult<Vec<GoogleProject>> {
    state.deploy.google_cloud_projects().await
}

/// Opens a Google Cloud console page of a project (billing, permissions...) in the browser.
#[tauri::command]
pub fn open_google_cloud_page(page: ConsolePage, project: Option<String>) -> AppResult<()> {
    crate::crash_reports::sharing::open_in_browser(&google_cloud::console_url(page, project.as_deref())?)
}

/// Opens the fix of a deploy problem (a Google Cloud console page the backend named).
///
/// # Errors
/// `InvalidInput` for any other address.
#[tauri::command]
pub fn open_deploy_fix(url: String) -> AppResult<()> {
    if !google_cloud::is_fix_url(&url) {
        return Err(AppError::InvalidInput("this page cannot be opened from here".into()));
    }
    crate::crash_reports::sharing::open_in_browser(&url)
}

/// The contexts of a dropped kubeconfig, so the person can pick one before connecting.
#[tauri::command]
pub fn read_kubeconfig_contexts(path: String) -> AppResult<Vec<String>> {
    crate::deploy::providers::kubeconfig_contexts(&crate::deploy::providers::read_key_file(&path)?)
}

#[tauri::command]
pub fn check_deploy_compatibility(state: State<'_, AppState>, agent_id: String) -> AppResult<CompatibilityReport> {
    let agent = state.db.released_agent(agent_id.trim())?;
    Ok(compatibility_for(&state, &agent)?.0)
}

/// Applies a model switch from the checklist (a new, undoable agent version).
#[tauri::command]
pub fn apply_deploy_fix(state: State<'_, AppState>, agent_id: String, fix: CompatibilityFix) -> AppResult<Agent> {
    state.deploy.apply_model_fix(agent_id.trim(), &fix)
}

#[tauri::command]
pub fn get_deploy_review(
    state: State<'_, AppState>,
    agent_id: String,
    provider: DeployProvider,
) -> AppResult<DeployReview> {
    let agent = state.db.released_agent(agent_id.trim())?;
    let requirements = plugin_requirements(&state, &agent)?;
    state.deploy.review(&agent, &requirements, provider)
}

/// Puts the agent online, or updates its online copy with the latest version.
#[tauri::command]
pub async fn deploy_agent(
    state: State<'_, AppState>,
    agent_id: String,
    options: DeployOptions,
) -> AppResult<DeployOutcome> {
    let agent = state.db.released_agent(agent_id.trim())?;
    let (report, requirements) = compatibility_for(&state, &agent)?;
    state.deploy.deploy(&agent.id, options, &requirements, &report).await
}

/// Stops a running deploy. Returns whether one was running.
#[tauri::command]
pub fn cancel_deploy(state: State<'_, AppState>, agent_id: String) -> bool {
    state.deploy.cancel_deploy(agent_id.trim())
}

#[tauri::command]
pub fn get_agent_deployment(state: State<'_, AppState>, agent_id: String) -> AppResult<Option<DeploymentView>> {
    state.deploy.view(agent_id.trim())
}

/// Checks the online copy and returns its state.
#[tauri::command]
pub async fn refresh_agent_deployment(
    state: State<'_, AppState>,
    agent_id: String,
) -> AppResult<Option<DeploymentView>> {
    state.deploy.refresh_status(agent_id.trim()).await
}

/// Pause, resume, roll back or take offline (`None` once it is offline).
#[tauri::command]
pub async fn manage_agent_deployment(
    state: State<'_, AppState>,
    agent_id: String,
    action: ManageAction,
) -> AppResult<Option<DeploymentView>> {
    state.deploy.manage(agent_id.trim(), action).await
}

/// "Make a new key" (Connection details for developers): the new key, shown once.
#[tauri::command]
pub async fn rotate_deployment_api_key(state: State<'_, AppState>, agent_id: String) -> AppResult<RotatedApiKey> {
    state.deploy.rotate_api_key(agent_id.trim()).await
}

#[tauri::command]
pub async fn list_deployed_versions(state: State<'_, AppState>, agent_id: String) -> AppResult<Vec<DeployedVersion>> {
    state.deploy.list_versions(agent_id.trim()).await
}

/// Runs of every online agent and connected server.
#[tauri::command]
pub async fn list_online_runs(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<OnlineRuns> {
    state.deploy.online_runs(limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn list_own_servers(state: State<'_, AppState>) -> AppResult<Vec<OwnServerView>> {
    state.deploy.list_own_servers().await
}

#[tauri::command]
pub async fn connect_own_server(
    state: State<'_, AppState>,
    name: String,
    url: String,
    api_key: String,
) -> AppResult<OwnServerView> {
    state.deploy.connect_own_server(&name, &url, &api_key).await
}

#[tauri::command]
pub fn remove_own_server(state: State<'_, AppState>, server_id: String) -> AppResult<()> {
    state.deploy.remove_own_server(server_id.trim())
}

/// Saves the agent file for an IT team (`.grt`, or `.yaml`) at `path`.
#[tauri::command]
pub fn export_agent_file(state: State<'_, AppState>, agent_id: String, path: String) -> AppResult<String> {
    let saved = state.deploy.export_agent_file(agent_id.trim(), &PathBuf::from(path.trim()))?;
    Ok(saved.to_string_lossy().into_owned())
}

/// The Docker instructions of "My own server" for the agent, with the chosen chat page and
/// phone page as environment variables of `graphrt serve`.
#[tauri::command]
pub fn get_own_server_instructions(
    state: State<'_, AppState>,
    agent_id: String,
    features: OnlineFeatures,
) -> AppResult<OwnServerInstructions> {
    let agent = state.db.released_agent(agent_id.trim())?;
    let requirements = plugin_requirements(&state, &agent)?;
    state.deploy.own_server_instructions(&agent, &requirements, &features)
}

/// What an online agent or a connected server offers right now (chat page, phone page).
#[tauri::command]
pub async fn get_live_online_features(state: State<'_, AppState>, target: OnlineTarget) -> AppResult<LiveFeatures> {
    state.deploy.live_features(&target).await
}

/// The phones paired with an online agent or a connected server.
#[tauri::command]
pub async fn list_paired_devices(state: State<'_, AppState>, target: OnlineTarget) -> AppResult<Vec<PairedDevice>> {
    if target == OnlineTarget::Computer {
        return state.phone_access.list_devices();
    }
    state.deploy.list_devices(&target).await
}

/// Pairs a new phone and returns its code (a link that is the phone's key).
#[tauri::command]
pub async fn pair_device(state: State<'_, AppState>, target: OnlineTarget, name: String) -> AppResult<DevicePairing> {
    if target == OnlineTarget::Computer {
        return state.phone_access.pair(&name).await;
    }
    state.deploy.pair_device(&target, &name).await
}

/// The kept code of a paired phone. Call only for an explicit "Show code".
#[tauri::command]
pub fn show_device_pairing(
    state: State<'_, AppState>,
    target: OnlineTarget,
    device_id: String,
) -> AppResult<DevicePairing> {
    state.deploy.device_pairing(&target, &device_id)
}

/// Removes a paired phone: its key stops working at once.
#[tauri::command]
pub async fn revoke_paired_device(
    state: State<'_, AppState>,
    target: OnlineTarget,
    device_id: String,
) -> AppResult<()> {
    if target == OnlineTarget::Computer {
        return state.phone_access.revoke(&device_id);
    }
    state.deploy.revoke_device(&target, &device_id).await
}

/// Pages the online-provider screens link to (fixed addresses; the UI names one, never a URL).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployLink {
    FlyTokens,
    FlyPricing,
    AwsAccessKeys,
    AwsIamPolicy,
    AwsCreateUser,
    AwsPricing,
    AwsRegions,
    AzureAppRegistrations,
}

impl DeployLink {
    pub fn url(self) -> &'static str {
        match self {
            Self::FlyTokens => "https://fly.io/user/personal_access_tokens",
            Self::FlyPricing => "https://fly.io/docs/about/pricing/",
            Self::AwsAccessKeys => "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
            Self::AwsIamPolicy => crate::deploy::aws::IAM_POLICY_DOCS_URL,
            Self::AwsCreateUser => "https://console.aws.amazon.com/iam/home#/users/create",
            Self::AwsPricing => "https://aws.amazon.com/lambda/pricing/",
            Self::AwsRegions => "https://console.aws.amazon.com/billing/home#/account",
            Self::AzureAppRegistrations => {
                "https://learn.microsoft.com/entra/identity-platform/quickstart-register-app"
            }
        }
    }
}

/// Opens a provider page (token page, pricing, guide) in the default browser.
#[tauri::command]
pub fn open_deploy_link(link: DeployLink) -> AppResult<()> {
    crate::crash_reports::sharing::open_in_browser(link.url())
}
