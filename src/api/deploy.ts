import { callBackend, isDesktopApp, listenToBackend } from './client'
import type {
  CliInfo,
  CompatibilityFix,
  CompatibilityReport,
  DeployAccount,
  DeployAccountInput,
  DeployEvent,
  DeployedVersion,
  DeployLink,
  DeployOptions,
  DeployOutcome,
  DeployProvider,
  DeployReview,
  DeploymentView,
  ManageAction,
  OnlineRuns,
  OwnServerView,
} from './deployTypes'
import { sampleDeployBackend, subscribeToSampleDeployEvents } from './sampleBackend/deploy'
import type { Agent } from './types'

/**
 * "Put it online": the graphrt tools, online accounts, the compatibility checklist, deploying
 * an agent, its online state, online runs and "My own server" (see `src-tauri/src/deploy`).
 * Sample data outside the desktop app.
 */

const useSample = () => __SAMPLE_BACKEND__ && !isDesktopApp()

export function getGraphrtCliInfo(): Promise<CliInfo> {
  return useSample() ? sampleDeployBackend.graphrtCliInfo() : callBackend('graphrt_cli_info')
}

/** Downloads the pinned graphrt tools. Call only after the person allowed the download. */
export function installGraphrtCli(): Promise<CliInfo> {
  return useSample() ? sampleDeployBackend.installGraphrtCli() : callBackend('install_graphrt_cli')
}

export function listDeployAccounts(): Promise<DeployAccount[]> {
  return useSample() ? sampleDeployBackend.listDeployAccounts() : callBackend('list_deploy_accounts')
}

/**
 * Checks and saves an online account in the keychain (never shown again).
 *
 * @throws BackendError - `invalid_input` with a plain sentence when the details can't be used
 */
export function connectDeployAccount(account: DeployAccountInput): Promise<DeployAccount> {
  return useSample() ? sampleDeployBackend.connectDeployAccount(account) : callBackend('connect_deploy_account', { account })
}

export function disconnectDeployAccount(provider: DeployProvider): Promise<void> {
  return useSample() ? sampleDeployBackend.disconnectDeployAccount(provider) : callBackend('disconnect_deploy_account', { provider })
}

/** The contexts of a dropped kubeconfig (the backend reads the file). */
export function readKubeconfigContexts(path: string): Promise<string[]> {
  return useSample() ? sampleDeployBackend.readKubeconfigContexts(path) : callBackend('read_kubeconfig_contexts', { path })
}

export function checkDeployCompatibility(agentId: string): Promise<CompatibilityReport> {
  return useSample() ? sampleDeployBackend.checkDeployCompatibility(agentId) : callBackend('check_deploy_compatibility', { agentId })
}

/** Applies a model switch from the checklist; returns the agent at its new version. */
export function applyDeployFix(agentId: string, fix: CompatibilityFix): Promise<Agent> {
  return useSample() ? sampleDeployBackend.applyDeployFix(agentId, fix) : callBackend('apply_deploy_fix', { agentId, fix })
}

export function getDeployReview(agentId: string, provider: DeployProvider): Promise<DeployReview> {
  return useSample() ? sampleDeployBackend.getDeployReview(agentId, provider) : callBackend('get_deploy_review', { agentId, provider })
}

/** Puts the agent online (or updates it). Progress arrives through {@link subscribeToDeployEvents}. */
export function deployAgent(agentId: string, options: DeployOptions): Promise<DeployOutcome> {
  return useSample() ? sampleDeployBackend.deployAgent(agentId, options) : callBackend('deploy_agent', { agentId, options })
}

export function cancelDeploy(agentId: string): Promise<boolean> {
  return useSample() ? sampleDeployBackend.cancelDeploy() : callBackend('cancel_deploy', { agentId })
}

export function getAgentDeployment(agentId: string): Promise<DeploymentView | null> {
  return useSample() ? sampleDeployBackend.getAgentDeployment(agentId) : callBackend('get_agent_deployment', { agentId })
}

/** Checks the online copy (health) and returns its state. */
export function refreshAgentDeployment(agentId: string): Promise<DeploymentView | null> {
  return useSample() ? sampleDeployBackend.refreshAgentDeployment(agentId) : callBackend('refresh_agent_deployment', { agentId })
}

/** Pause, resume, roll back or take offline; null once offline. */
export function manageAgentDeployment(agentId: string, action: ManageAction): Promise<DeploymentView | null> {
  return useSample() ? sampleDeployBackend.manageAgentDeployment(agentId, action) : callBackend('manage_agent_deployment', { agentId, action })
}

export function listDeployedVersions(agentId: string): Promise<DeployedVersion[]> {
  return useSample() ? sampleDeployBackend.listDeployedVersions(agentId) : callBackend('list_deployed_versions', { agentId })
}

export function listOnlineRuns(limit = 50): Promise<OnlineRuns> {
  return useSample() ? sampleDeployBackend.listOnlineRuns() : callBackend('list_online_runs', { limit })
}

export function listOwnServers(): Promise<OwnServerView[]> {
  return useSample() ? sampleDeployBackend.listOwnServers() : callBackend('list_own_servers')
}

/** Tests the server (health + its runs with the key), then saves it. */
export function connectOwnServer(name: string, url: string, apiKey: string): Promise<OwnServerView> {
  return useSample() ? sampleDeployBackend.connectOwnServer(name, url, apiKey) : callBackend('connect_own_server', { name, url, apiKey })
}

export function removeOwnServer(serverId: string): Promise<void> {
  return useSample() ? sampleDeployBackend.removeOwnServer(serverId) : callBackend('remove_own_server', { serverId })
}

/** Saves the agent file for an IT team at `path` (`.grt`, or `.yaml`). */
export function exportAgentFile(agentId: string, path: string): Promise<string> {
  return useSample() ? sampleDeployBackend.exportAgentFile(agentId, path) : callBackend('export_agent_file', { agentId, path })
}

/** Asks where to save the agent file (desktop); a sample path in the preview. */
export async function pickAgentFileSavePath(suggestedName: string): Promise<string | null> {
  if (useSample()) return `~/Downloads/${suggestedName}.grt`
  const [{ save }, { downloadDir, join }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/path')])
  const chosenPath = await save({
    title: 'Save the agent file',
    defaultPath: await join(await downloadDir(), `${suggestedName}.grt`),
    filters: [
      { name: 'graphrt agent file', extensions: ['grt'] },
      { name: 'YAML', extensions: ['yaml'] },
    ],
  })
  return chosenPath ?? null
}

export function openDeployLink(link: DeployLink): Promise<void> {
  return useSample() ? sampleDeployBackend.openDeployLink() : callBackend('open_deploy_link', { link })
}

/** Deploy progress (steps and technical log lines). Returns an unsubscribe function. */
export async function subscribeToDeployEvents(onEvent: (event: DeployEvent) => void): Promise<() => void> {
  if (useSample()) return subscribeToSampleDeployEvents(onEvent)
  return listenToBackend<DeployEvent>('deploy-event', onEvent)
}
