/**
 * "Put it online" shapes, mirroring `src-tauri/src/deploy` (serde camelCase). Secrets never
 * appear here except `DeployOutcome.apiKey`, which is shown once and then only in the keychain.
 */

export type DeployProvider = 'fly' | 'google_cloud' | 'aws' | 'azure' | 'kubernetes'

export const deployProviderNames: Record<DeployProvider, string> = {
  fly: 'Fly.io',
  google_cloud: 'Google Cloud',
  aws: 'AWS',
  azure: 'Microsoft Azure',
  kubernetes: 'Kubernetes',
}

/**
 * Why online deploy can't be used yet (mirrors `NOT_AVAILABLE_MESSAGE` in `src-tauri/src/deploy`):
 * no graphrt release with `deploy --direct` and its server image is pinned in this app build.
 */
export const onlineDeployNotAvailableMessage =
  'Online deploy is not available yet. It needs a graphrt release that can put agents online (graphrt deploy --direct) and the matching graphrt server image published with it, and neither exists yet. It comes with an app update.'

/** `not_available`: this app build pins no graphrt release yet. */
export type CliStatus = 'not_available' | 'not_installed' | 'installing' | 'installed'

export interface CliInfo {
  status: CliStatus
  version: string | null
  downloadSizeBytes: number | null
}

export interface DeployAccount {
  provider: DeployProvider
  displayName: string
  connected: boolean
  /** Non-secret, e.g. "Service account graphrt@acme · project acme". */
  summary: string | null
  /** Agents can be put online with it in this release (Fly.io only for now). */
  canDeploy: boolean
  usedByAgents: string[]
}

/** What a Connect dialog sends; files are paths (dropped or picked), read by the backend. */
export type DeployAccountInput =
  | { provider: 'fly'; accessToken: string }
  | { provider: 'google_cloud'; keyFilePath: string }
  | { provider: 'aws'; accessKeyId: string; secretAccessKey: string; sessionToken?: string | null }
  | { provider: 'azure'; tenantId: string; clientId: string; certificatePath?: string | null; clientSecret?: string | null }
  | { provider: 'kubernetes'; kubeconfigPath: string; context?: string | null }

export type CompatibilityLevel = 'blocker' | 'info' | 'ok'

export type CompatibilityFix =
  | { kind: 'switch_model'; fromProvider: string; toProvider: string; toProviderName: string }
  | { kind: 'switch_whats_app_to_cloud' }

export interface CompatibilityItem {
  id: string
  level: CompatibilityLevel
  title: string
  detail: string
  fix: CompatibilityFix | null
  fixLabel: string | null
}

export interface CompatibilityReport {
  ready: boolean
  items: CompatibilityItem[]
}

export type DeployMode = 'always_on' | 'scale_to_zero'
export type ServerArea = 'asia' | 'europe' | 'us'

export interface KeyToCopy {
  friendlyName: string
  purpose: string
  isSaved: boolean
  envName: string
}

export interface DeployReview {
  provider: DeployProvider
  providerConnected: boolean
  canDeploy: boolean
  deploymentName: string
  expectedAddress: string
  keys: KeyToCopy[]
  cli: CliInfo
  mode: DeployMode
  area: ServerArea
  /** The `--image` of the last deploy (Advanced); null: graphrt's own image. */
  image: string | null
}

export interface DeployOptions {
  provider: DeployProvider
  mode: DeployMode
  area: ServerArea
  /** Advanced: another image running `graphrt serve`; null or empty: graphrt's own image. */
  image?: string | null
}

export type DeploymentStatus = 'deploying' | 'working' | 'paused' | 'needs_attention' | 'failed'

export interface DeploymentRecord {
  agentId: string
  provider: DeployProvider
  deploymentName: string
  app: string | null
  url: string | null
  region: string | null
  mode: DeployMode
  deployedVersionLabel: string | null
  deployedAgentVersion: number | null
  status: DeploymentStatus
  statusMessage: string | null
  statusCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DeploymentView {
  deployment: DeploymentRecord
  providerName: string
  area: ServerArea | null
  hasChanges: boolean
  agentVersion: number
  hasApiKey: boolean
}

export interface DeployOutcome {
  view: DeploymentView
  /** Shown once on the first deploy; null on later ones (the saved key keeps working). */
  apiKey: string | null
  /** The name to call: `POST {url}/v1/workflows/{workflow}/runs`. */
  workflow: string | null
}

/** "Make a new key": shown once; the old key stops working. */
export interface RotatedApiKey {
  view: DeploymentView
  apiKey: string
  /** The new key works but the online copy didn't restart cleanly (plain sentence). */
  problem: string | null
}

export interface DeployedVersion {
  label: string
  agentVersion: number
  changeSummary: string
  deployedAt: string
  isCurrent: boolean
}

export type ManageAction =
  | { action: 'status' }
  | { action: 'list_versions' }
  | { action: 'rollback'; version: string }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'remove' }

export type DeployStep = 'preparing' | 'secrets' | 'starting' | 'checking'
export type StepStatus = 'running' | 'done' | 'failed'

export type DeployEvent =
  | { kind: 'step'; agentId: string; step: DeployStep; status: StepStatus; message: string | null }
  | { kind: 'log'; agentId: string; line: string }

export interface CloudRun {
  id: string
  workflow: string | null
  status: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface OnlineRun {
  agentId: string | null
  sourceName: string
  place: string
  run: CloudRun
}

export interface OnlineRuns {
  runs: OnlineRun[]
  problems: string[]
}

export interface OwnServer {
  id: string
  name: string
  url: string
  createdAt: string
}

export interface HealthCheck {
  healthy: boolean
  message: string
}

export interface OwnServerView {
  server: OwnServer
  health: HealthCheck | null
}

/** Provider pages the app may open (fixed addresses in the backend). */
export type DeployLink = 'fly_tokens' | 'fly_pricing' | 'google_cloud_keys' | 'aws_access_keys' | 'azure_app_registrations'
