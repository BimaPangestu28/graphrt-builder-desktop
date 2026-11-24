import { BackendError } from '../client'
import type {
  CliInfo,
  CompatibilityFix,
  CompatibilityReport,
  DeployAccount,
  DeployAccountInput,
  DeployEvent,
  DeployedVersion,
  DeployOptions,
  DeployOutcome,
  DeployProvider,
  DeployReview,
  DeploymentView,
  DeployStep,
  ManageAction,
  OnlineRuns,
  OwnServerView,
  RotatedApiKey,
} from '../deployTypes'
import { deployProviderNames, onlineDeployNotAvailableMessage } from '../deployTypes'
import type { Agent } from '../types'
import { listStoredAgents, readCurrentSteps, readStoredAgent, saveNewVersion } from './sampleAgentStore'
import { respondWith, waitFor } from './sampleResponse'

/**
 * Sample "Put it online" for the browser preview and tests, kept in memory. Deploys walk the
 * four steps with short pauses and emit the same events as the desktop. Validation mirrors the
 * backend in fewer words. {@link resetSampleDeploy} starts clean; {@link setSampleCliStatus}
 * and {@link setSampleCompatibility} put a screen in a given state.
 */

const providers: DeployProvider[] = ['fly', 'google_cloud', 'aws', 'azure', 'kubernetes']

interface SampleDeployState {
  accounts: Map<DeployProvider, string>
  deployments: Map<string, DeploymentView>
  histories: Map<string, DeployedVersion[]>
  servers: OwnServerView[]
  cli: CliInfo
  compatibility: Map<string, CompatibilityReport>
  fixedAgents: Set<string>
  images: Map<string, string>
  keyNumber: number
}

function freshState(): SampleDeployState {
  return {
    accounts: new Map(),
    deployments: new Map(),
    histories: new Map(),
    servers: [],
    cli: { status: 'not_installed', version: '0.9.0', downloadSizeBytes: 9_400_000 },
    compatibility: new Map(),
    fixedAgents: new Set(),
    images: new Map(),
    keyNumber: 0,
  }
}

let state = freshState()
const eventListeners = new Set<(event: DeployEvent) => void>()

export function resetSampleDeploy(): void {
  state = freshState()
}

export function setSampleCliStatus(cli: CliInfo): void {
  state.cli = cli
}

/** Forces the checklist of one agent (tests and screenshots). */
export function setSampleCompatibility(agentId: string, report: CompatibilityReport): void {
  state.compatibility.set(agentId, report)
}

/** Puts an agent online without a deploy (screenshots of the deployed state). */
export function seedSampleDeployment(agentId: string, changes: Partial<DeploymentView['deployment']> = {}, hasChanges = false): void {
  const agent = readStoredAgent(agentId)
  state.accounts.set('fly', 'Access key saved')
  state.deployments.set(agentId, buildView(agent, { deployedVersionLabel: 'v3', deployedAgentVersion: agent.currentVersion, ...changes }, hasChanges))
  state.histories.set(agentId, [
    { label: 'v1', agentVersion: 1, changeSummary: 'First time online', deployedAt: '2026-11-12T09:00:00Z', isCurrent: false },
    { label: 'v2', agentVersion: Math.max(1, agent.currentVersion - 1), changeSummary: 'Friendlier greeting', deployedAt: '2026-11-19T09:00:00Z', isCurrent: false },
    { label: 'v3', agentVersion: agent.currentVersion, changeSummary: 'Added opening hours', deployedAt: '2026-11-24T10:05:00Z', isCurrent: true },
  ])
}

export function subscribeToSampleDeployEvents(listener: (event: DeployEvent) => void): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

function emit(event: DeployEvent): void {
  eventListeners.forEach((listener) => listener(event))
}

function slugFor(agent: Agent): string {
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent'
  return `${slug}-${agent.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`
}

function buildView(agent: Agent, changes: Partial<DeploymentView['deployment']>, hasChanges = false): DeploymentView {
  const name = slugFor(agent)
  const now = new Date().toISOString()
  const deployment: DeploymentView['deployment'] = {
    agentId: agent.id,
    provider: 'fly',
    deploymentName: name,
    app: name,
    url: `https://${name}.fly.dev`,
    region: 'sin',
    mode: 'scale_to_zero',
    deployedVersionLabel: 'v1',
    deployedAgentVersion: agent.currentVersion,
    status: 'working',
    statusMessage: null,
    statusCheckedAt: now,
    createdAt: now,
    updatedAt: now,
    ...changes,
  }
  return { deployment, providerName: deployProviderNames[deployment.provider], area: regionArea(deployment.region), hasChanges, agentVersion: agent.currentVersion, hasApiKey: true }
}

function regionArea(region: string | null): DeploymentView['area'] {
  if (region === 'sin') return 'asia'
  if (region === 'fra') return 'europe'
  if (region === 'iad') return 'us'
  return null
}

function withDrift(agentId: string): DeploymentView | null {
  const view = state.deployments.get(agentId)
  if (!view) return null
  const agent = readStoredAgent(agentId)
  const hasChanges = view.hasChanges || (view.deployment.deployedAgentVersion !== null && view.deployment.deployedAgentVersion !== agent.currentVersion)
  return { ...view, agentVersion: agent.currentVersion, hasChanges }
}

function listAccounts(): DeployAccount[] {
  const names = new Map(listStoredAgents().map((agent) => [agent.id, agent.name]))
  return providers.map((provider) => ({
    provider,
    displayName: deployProviderNames[provider],
    connected: state.accounts.has(provider),
    summary: state.accounts.get(provider) ?? null,
    canDeploy: provider === 'fly',
    usedByAgents: [...state.deployments.values()].filter((view) => view.deployment.provider === provider).map((view) => names.get(view.deployment.agentId) ?? view.deployment.deploymentName),
  }))
}

function invalid(message: string): never {
  throw new BackendError('invalid_input', message)
}

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Checks like `deploy::providers`; key files are only names in the preview. */
function checkAccount(input: DeployAccountInput): string {
  switch (input.provider) {
    case 'fly': {
      const token = input.accessToken.trim()
      if (!token) invalid('Paste your Fly.io access key first')
      if (token.replace(/^FlyV1 /, '').length < 20 || /\s/.test(token.replace(/^FlyV1 /, ''))) invalid("This doesn't look like a Fly.io access key. Copy the whole key from the Tokens page")
      return 'Access key saved'
    }
    case 'google_cloud':
      if (!input.keyFilePath.toLowerCase().endsWith('.json')) invalid('This is not a Google Cloud key file (it is not JSON)')
      return 'Service account graphrt@acme-agents · project acme-agents'
    case 'aws':
      if (!/^[A-Z0-9]{16,128}$/.test(input.accessKeyId.trim())) invalid('The access key ID looks wrong. It is about 20 capital letters and digits, like AKIA…')
      if (input.secretAccessKey.trim().length < 20) invalid('The secret access key looks wrong. Copy it again from AWS')
      return `Access key ${input.accessKeyId.trim().slice(0, 4)}…${input.accessKeyId.trim().slice(-4)}`
    case 'azure':
      if (!guidPattern.test(input.tenantId.trim())) invalid('The tenant ID looks wrong. It looks like 00000000-0000-0000-0000-000000000000')
      if (!guidPattern.test(input.clientId.trim())) invalid('The app (client) ID looks wrong. It looks like 00000000-0000-0000-0000-000000000000')
      if (!input.certificatePath && !input.clientSecret?.trim()) invalid('Add the certificate file, or paste a client secret instead')
      return `App ${input.clientId.trim().slice(0, 8)}… · ${input.certificatePath ? 'certificate' : 'client secret'}`
    case 'kubernetes':
      return `Context ${input.context ?? 'default'}`
  }
}

function compatibilityFor(agentId: string): CompatibilityReport {
  const forced = state.compatibility.get(agentId)
  if (forced && !state.fixedAgents.has(agentId)) return forced
  return {
    ready: true,
    items: [
      { id: 'knowledge', level: 'info', title: 'Your knowledge will go with it', detail: 'A copy is taken now. If you edit it later, update the online version.', fix: null, fixLabel: null },
      { id: 'key:openai', level: 'ok', title: 'Your OpenAI key can be copied safely', detail: "It goes straight to the provider's safe storage.", fix: null, fixLabel: null },
    ],
  }
}

function review(agentId: string, provider: DeployProvider): DeployReview {
  const agent = readStoredAgent(agentId)
  const existing = state.deployments.get(agentId)
  const name = existing?.deployment.deploymentName ?? slugFor(agent)
  return {
    provider,
    providerConnected: state.accounts.has(provider),
    canDeploy: provider === 'fly',
    deploymentName: name,
    expectedAddress: `${name}.fly.dev`,
    keys: [
      { friendlyName: 'Your OpenAI key', purpose: 'So it can write answers', isSaved: true, envName: 'OPENAI_API_KEY' },
      { friendlyName: 'WhatsApp Business access', purpose: 'So it can reply to customers', isSaved: true, envName: 'WHATSAPP_CLOUD_ACCESS_TOKEN' },
    ],
    cli: state.cli,
    mode: existing?.deployment.mode ?? 'scale_to_zero',
    area: existing?.area ?? 'us',
    image: state.images.get(agentId) ?? null,
  }
}

const sampleSteps: DeployStep[] = ['preparing', 'secrets', 'starting', 'checking']
const regionForArea = { asia: 'sin', europe: 'fra', us: 'iad' } as const

async function deploy(agentId: string, options: DeployOptions): Promise<DeployOutcome> {
  if (options.provider !== 'fly') invalid(`Putting agents online with ${deployProviderNames[options.provider]} is coming soon`)
  if (state.cli.status === 'not_available') invalid(onlineDeployNotAvailableMessage)
  if (state.cli.status !== 'installed') invalid('Download the graphrt tools first (Review › Allow download)')
  const image = options.image?.trim() || null
  if (image && (image.startsWith('-') || !/^[A-Za-z0-9./:_@-]+$/.test(image))) invalid(`\`${image}\` is not an image name such as ghcr.io/you/graphrt:0.6.0 (leave it empty for graphrt's own image)`)
  if (!state.accounts.has('fly')) throw new BackendError('missing_credentials', 'not set up yet: your Fly.io account (connect it in Online accounts)')
  const agent = readStoredAgent(agentId)
  for (const step of sampleSteps) {
    emit({ kind: 'step', agentId, step, status: 'running', message: null })
    emit({ kind: 'log', agentId, line: `${step}: working…` })
    await waitFor(700)
    emit({ kind: 'step', agentId, step, status: 'done', message: null })
  }
  const previous = state.deployments.get(agentId)
  const nextNumber = Number(previous?.deployment.deployedVersionLabel?.slice(1) ?? 0) + 1
  const label = `v${nextNumber}`
  const view = buildView(agent, { mode: options.mode, region: regionForArea[options.area], deployedVersionLabel: label, createdAt: previous?.deployment.createdAt })
  state.deployments.set(agentId, view)
  const history = (state.histories.get(agentId) ?? []).map((entry) => ({ ...entry, isCurrent: false }))
  state.histories.set(agentId, [...history, { label, agentVersion: agent.currentVersion, changeSummary: nextNumber === 1 ? 'First time online' : 'Latest changes', deployedAt: new Date().toISOString(), isCurrent: true }])
  if (image) state.images.set(agentId, image)
  else state.images.delete(agentId)
  // Like graphrt: the key only on the first deploy, null afterwards.
  return { view, apiKey: previous ? null : 'grk_sample_preview_key', workflow: 'agent' }
}

async function rotateApiKey(agentId: string): Promise<RotatedApiKey> {
  const view = withDrift(agentId)
  if (!view || view.deployment.status === 'failed') invalid('Put the agent online first')
  await waitFor(800)
  state.keyNumber += 1
  return { view, apiKey: `grk_sample_new_key_${state.keyNumber}`, problem: null }
}

function manage(agentId: string, action: ManageAction): DeploymentView | null {
  const view = state.deployments.get(agentId)
  if (!view) throw new BackendError('not_found', "this agent's online copy not found")
  const setStatus = (status: DeploymentView['deployment']['status'], statusMessage: string | null) =>
    state.deployments.set(agentId, { ...view, deployment: { ...view.deployment, status, statusMessage } })
  switch (action.action) {
    case 'pause':
      setStatus('paused', 'Paused by you')
      break
    case 'resume':
      setStatus('working', null)
      break
    case 'remove':
      state.deployments.delete(agentId)
      state.histories.delete(agentId)
      return null
    case 'rollback': {
      const history = state.histories.get(agentId) ?? []
      const target = history.find((entry) => entry.label === action.version)
      state.histories.set(agentId, history.map((entry) => ({ ...entry, isCurrent: entry.label === action.version })))
      state.deployments.set(agentId, { ...view, deployment: { ...view.deployment, deployedVersionLabel: action.version, deployedAgentVersion: target?.agentVersion ?? null } })
      break
    }
    case 'status':
    case 'list_versions':
      break
  }
  return withDrift(agentId)
}

function onlineRuns(): OnlineRuns {
  const names = new Map(listStoredAgents().map((agent) => [agent.id, agent.name]))
  const runs = [...state.deployments.values()].flatMap((view, index) => {
    const sourceName = names.get(view.deployment.agentId) ?? view.deployment.deploymentName
    return [
      { agentId: view.deployment.agentId, sourceName, place: view.providerName, run: { id: `online-${index}-1`, workflow: view.deployment.deploymentName, status: 'succeeded', startedAt: '2026-11-24T12:41:00Z', finishedAt: '2026-11-24T12:41:02Z', error: null } },
      { agentId: view.deployment.agentId, sourceName, place: view.providerName, run: { id: `online-${index}-2`, workflow: view.deployment.deploymentName, status: 'failed', startedAt: '2026-11-24T09:12:00Z', finishedAt: '2026-11-24T09:12:05Z', error: 'The AI service was busy. It will try again' } },
    ]
  })
  return { runs, problems: [] }
}

function applyFix(agentId: string, fix: CompatibilityFix): Agent {
  if (fix.kind !== 'switch_model') invalid('this fix is made in the builder chat')
  state.fixedAgents.add(agentId)
  return saveNewVersion(agentId, readCurrentSteps(agentId), `Switched AI steps to ${fix.toProviderName} so it can run online`)
}

export const sampleDeployBackend = {
  graphrtCliInfo: () => respondWith(() => state.cli),
  installGraphrtCli: async (): Promise<CliInfo> => {
    if (state.cli.status === 'not_available') invalid(onlineDeployNotAvailableMessage)
    state.cli = { ...state.cli, status: 'installing' }
    await waitFor(1200)
    state.cli = { ...state.cli, status: 'installed' }
    return state.cli
  },
  listDeployAccounts: () => respondWith(listAccounts),
  connectDeployAccount: async (input: DeployAccountInput): Promise<DeployAccount> => {
    await waitFor(600)
    const summary = checkAccount(input)
    state.accounts.set(input.provider, summary)
    return listAccounts().find((account) => account.provider === input.provider) as DeployAccount
  },
  disconnectDeployAccount: (provider: DeployProvider) => respondWith(() => void state.accounts.delete(provider)),
  readKubeconfigContexts: (path: string) => respondWith(() => (path.toLowerCase().includes('config') || path.toLowerCase().endsWith('.yaml') ? ['staging', 'prod'] : invalid('This file is not a kubeconfig (it is not YAML)'))),
  checkDeployCompatibility: (agentId: string) => respondWith(() => compatibilityFor(agentId)),
  applyDeployFix: (agentId: string, fix: CompatibilityFix) => respondWith(() => applyFix(agentId, fix)),
  getDeployReview: (agentId: string, provider: DeployProvider) => respondWith(() => review(agentId, provider)),
  deployAgent: deploy,
  cancelDeploy: () => respondWith(() => false),
  getAgentDeployment: (agentId: string) => respondWith(() => withDrift(agentId)),
  refreshAgentDeployment: (agentId: string) => respondWith(() => withDrift(agentId)),
  manageAgentDeployment: (agentId: string, action: ManageAction) => respondWith(() => manage(agentId, action)),
  rotateDeploymentApiKey: rotateApiKey,
  listDeployedVersions: (agentId: string) => respondWith(() => [...(state.histories.get(agentId) ?? [])].reverse()),
  listOnlineRuns: () => respondWith(onlineRuns),
  listOwnServers: () => respondWith(() => state.servers),
  connectOwnServer: async (name: string, url: string, apiKey: string): Promise<OwnServerView> => {
    await waitFor(500)
    if (!/^https?:\/\//.test(url.trim())) invalid('Enter the full address, like https://agents.example.com')
    if (!apiKey.trim()) invalid("Paste the server's access key")
    if (!name.trim()) invalid('Give the server a name')
    const view: OwnServerView = { server: { id: `server-${state.servers.length + 1}`, name: name.trim(), url: url.trim().replace(/\/$/, ''), createdAt: new Date().toISOString() }, health: { healthy: true, message: 'It answers' } }
    state.servers = [...state.servers, view]
    return view
  },
  removeOwnServer: (serverId: string) => respondWith(() => void (state.servers = state.servers.filter((view) => view.server.id !== serverId))),
  exportAgentFile: (_agentId: string, path: string) => respondWith(() => path),
  openDeployLink: () => respondWith(() => undefined),
}
