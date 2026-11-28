import { BackendError } from '../client'
import type {
  AwsProfile,
  CloudPlace,
  CliInfo,
  CompatibilityFix,
  CompatibilityReport,
  DeployAccount,
  DeployAccountInput,
  DeployEvent,
  DeployedVersion,
  DeployOptions,
  DeployOutcome,
  DeployProblem,
  DeployProvider,
  DeployReview,
  DeploymentView,
  DeployStep,
  DevicePairing,
  GoogleProject,
  LiveFeatures,
  ManageAction,
  OnlineFeatures,
  OnlineRuns,
  OnlineTarget,
  OwnServerInstructions,
  OwnServerView,
  PairedDevice,
  RotatedApiKey,
} from '../deployTypes'
import { deployProviderNames, noOnlineFeatures, onlineDeployNotAvailableMessage, onlineFeaturesNeedNewerToolsMessage } from '../deployTypes'
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
  /** Whether the sample tools know the chat page and the phone page once installed. */
  toolsKnowOnlineFeatures: boolean
  /** What each connected server offers (an online agent's comes from its deployment). */
  serverFeatures: Map<string, OnlineFeatures>
  /** Paired phones by target (`agent:<id>` / `server:<id>`), with their kept codes. */
  devices: Map<string, Array<PairedDevice & { link: string }>>
  deviceNumber: number
  /** Whether the sample tools put agents on Google Cloud Run. */
  toolsKnowCloudRun: boolean
  /** The signed-in Google account's projects. */
  googleProjects: GoogleProject[]
  /** Whether the sample tools give Lambda a store (the phone page and channels). */
  lambdaStore: boolean
  /** The AWS profiles of the sample computer. */
  awsProfiles: AwsProfile[]
}

/** The projects of the sample Google account: one with billing, one without. */
export const sampleGoogleProjects: GoogleProject[] = [
  { id: 'acme-agents', name: 'Acme agents', billing: 'enabled' },
  { id: 'acme-sandbox-2', name: 'Acme sandbox', billing: 'disabled' },
]

function freshState(): SampleDeployState {
  return {
    accounts: new Map(),
    deployments: new Map(),
    histories: new Map(),
    servers: [],
    cli: { status: 'not_installed', version: '0.9.0', downloadSizeBytes: 9_400_000, onlineFeatures: false },
    compatibility: new Map(),
    fixedAgents: new Set(),
    images: new Map(),
    keyNumber: 0,
    toolsKnowOnlineFeatures: true,
    serverFeatures: new Map(),
    devices: new Map(),
    deviceNumber: 0,
    toolsKnowCloudRun: true,
    googleProjects: sampleGoogleProjects,
    lambdaStore: false,
    awsProfiles: [
      { name: 'default', region: 'ap-southeast-3', hasKeys: true },
      { name: 'work-sso', region: 'eu-west-1', hasKeys: false },
    ],
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

/** Makes the sample tools older than the chat page and the phone page (the honest "needs an update" state). */
export function setSampleToolsKnowOnlineFeatures(known: boolean): void {
  state.toolsKnowOnlineFeatures = known
  state.cli = { ...state.cli, onlineFeatures: known && state.cli.status === 'installed' }
}

/** Gives Lambda deployments of the sample tools a store (the phone page and channels on AWS). */
export function setSampleLambdaStore(hasStore: boolean): void {
  state.lambdaStore = hasStore
}

/** Makes the sample tools older than Cloud Run (Google Cloud then stays "coming soon"). */
export function setSampleToolsKnowCloudRun(known: boolean): void {
  state.toolsKnowCloudRun = known
}

/** What a connected sample server offers (default: a chat page for guests and the phone page). */
export function setSampleServerFeatures(serverId: string, features: OnlineFeatures): void {
  state.serverFeatures.set(serverId, features)
}

/** Forces the checklist of one agent (tests and screenshots). */
export function setSampleCompatibility(agentId: string, report: CompatibilityReport): void {
  state.compatibility.set(agentId, report)
}

/** Puts an agent online without a deploy (screenshots of the deployed state). */
export function seedSampleDeployment(agentId: string, changes: Partial<DeploymentView['deployment']> = {}, hasChanges = false, features: OnlineFeatures = noOnlineFeatures): void {
  const agent = readStoredAgent(agentId)
  state.accounts.set('fly', 'Access key saved')
  state.deployments.set(agentId, { ...buildView(agent, { deployedVersionLabel: 'v3', deployedAgentVersion: agent.currentVersion, ...changes }, hasChanges), features })
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
  return { deployment, providerName: deployProviderNames[deployment.provider], area: deployment.provider === 'fly' ? regionArea(deployment.region) : null, hasChanges, agentVersion: agent.currentVersion, hasApiKey: true, features: noOnlineFeatures, place: null }
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
    canDeploy: canDeploy(provider),
    usedByAgents: [...state.deployments.values()].filter((view) => view.deployment.provider === provider).map((view) => names.get(view.deployment.agentId) ?? view.deployment.deploymentName),
  }))
}

function canDeploy(provider: DeployProvider): boolean {
  return provider === 'fly' || provider === 'aws' || (provider === 'google_cloud' && state.toolsKnowCloudRun)
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
    case 'aws':
      if (!/^[A-Z0-9]{16,128}$/.test(input.accessKeyId.trim())) invalid('The access key ID looks wrong. It is about 20 capital letters and digits, like AKIA…')
      if (input.secretAccessKey.trim().length < 20) invalid('The secret access key looks wrong. Copy it again from AWS')
      return `Access key ${input.accessKeyId.trim().slice(0, 4)}…${input.accessKeyId.trim().slice(-4)} · account 123456789012 · user graphrt-deployer`
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
    canDeploy: canDeploy(provider),
    deploymentName: name,
    expectedAddress: provider === 'google_cloud' ? `${name}-….a.run.app` : provider === 'aws' ? '….lambda-url.on.aws' : `${name}.fly.dev`,
    keys: [
      { friendlyName: 'Your OpenAI key', purpose: 'So it can write answers', isSaved: true, envName: 'OPENAI_API_KEY' },
      { friendlyName: 'WhatsApp Business access', purpose: 'So it can reply to customers', isSaved: true, envName: 'WHATSAPP_CLOUD_ACCESS_TOKEN' },
    ],
    cli: state.cli,
    mode: existing?.deployment.mode ?? 'scale_to_zero',
    area: existing?.area ?? 'us',
    image: state.images.get(agentId) ?? null,
    features: existing?.features ?? noOnlineFeatures,
    cloudPlace: existing?.deployment.provider === 'google_cloud' ? existing.place : null,
    region: existing?.deployment.provider === 'aws' ? existing.deployment.region : null,
    storeFeatures: provider !== 'aws' || state.lambdaStore,
  }
}

/** Like `deploy::online::OnlineFeatures::checked`: the website as an origin, options of what is off dropped. */
function checkedFeatures(features: OnlineFeatures): OnlineFeatures {
  const site = features.embedSite?.trim() ?? ''
  let embedSite: string | null = null
  if (features.chat && site) {
    let parsed: URL
    try {
      parsed = new URL(site.includes('://') ? site : `https://${site}`)
    } catch {
      return invalid(`\`${site}\` is not a website address such as https://www.example.com`)
    }
    if (!/^https?:$/.test(parsed.protocol) || !(parsed.hostname.includes('.') || parsed.hostname === 'localhost')) invalid(`\`${site}\` is not a website address such as https://www.example.com`)
    embedSite = parsed.origin
  }
  const notifications = features.phone && features.notifications
  const email = features.notifyEmail?.trim().replace(/^mailto:/, '') ?? ''
  if (notifications && !email) invalid('Enter your email address for notifications. Notification services use it only to reach you if something is wrong with this sender')
  if (notifications && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid(`\`${email}\` is not an email address such as you@example.com`)
  return { chat: features.chat, chatAudience: features.chat ? features.chatAudience : 'guests', embedSite, phone: features.phone, notifications, notifyEmail: notifications ? email : null, answerWhenTimeRunsOut: features.answerWhenTimeRunsOut, whatsapp: features.whatsapp, teams: features.teams }
}

function anyFeature(features: OnlineFeatures): boolean {
  return features.chat || features.phone || features.notifications || features.answerWhenTimeRunsOut || features.whatsapp || features.teams
}

function targetKey(target: OnlineTarget): string {
  if (target.kind === 'computer') return 'computer'
  return target.kind === 'agent' ? `agent:${target.agentId}` : `server:${target.serverId}`
}

/** The address and the features of a target, or a refusal like the backend's. */
function targetState(target: OnlineTarget): { url: string; features: OnlineFeatures; workflow: string } {
  if (target.kind === 'agent') {
    const view = state.deployments.get(target.agentId)
    if (!view?.deployment.url) throw new BackendError('not_found', "this agent's online copy not found")
    return { url: view.deployment.url, features: view.features, workflow: 'agent' }
  }
  if (target.kind === 'computer') invalid('phones of this computer are paired in Settings, Phone access')
  const server = state.servers.find((view) => view.server.id === target.serverId)
  if (!server) throw new BackendError('not_found', 'this server not found')
  const features = state.serverFeatures.get(target.serverId) ?? { ...noOnlineFeatures, chat: true, phone: true, notifications: true }
  return { url: server.server.url, features, workflow: 'support' }
}

function liveFeatures(target: OnlineTarget): LiveFeatures {
  const { url, features, workflow } = targetState(target)
  return {
    reachable: true,
    problem: null,
    chat: features.chat
      ? { audience: features.chatAudience, link: `${url}/chat/${workflow}`, widgetSnippet: `<script src="${url}/chat/embed.js" data-workflow="${workflow}" async></script>`, keepsConversations: false }
      : null,
    phone: features.phone ? { link: `${url}/monitor/`, canPair: true, approvals: true, answersWhenTimeRunsOut: features.answerWhenTimeRunsOut, notifications: features.notifications } : null,
  }
}

function requirePairing(target: OnlineTarget): string {
  const { url, features } = targetState(target)
  if (!features.phone) invalid('Pairing a phone is not turned on for this agent. Turn on "Follow it from your phone" and update the online copy')
  return url
}

function pair(target: OnlineTarget, name: string): DevicePairing {
  const url = requirePairing(target)
  const deviceName = name.trim()
  if (!deviceName || deviceName.length > 100) invalid('Give the phone a short name, like "Ana\'s phone"')
  state.deviceNumber += 1
  const id = `dev-sample${state.deviceNumber}`
  // A sample link: the real one carries the phone's key, which only the backend makes.
  const link = `${url}/monitor/#pair=grd1.${id}.sample-preview-only`
  const devices = state.devices.get(targetKey(target)) ?? []
  state.devices.set(targetKey(target), [{ id, name: deviceName, pairedAtMs: Date.now(), lastUsedAtMs: null, canShowCode: true, link }, ...devices])
  return { deviceId: id, deviceName, link }
}

function ownServerInstructions(agentId: string, requested: OnlineFeatures): OwnServerInstructions {
  const features = checkedFeatures(requested)
  const name = readStoredAgent(agentId).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
  const needsStorage = features.phone || features.notifications || features.whatsapp || features.teams
  const lines = [`docker run -d --name ${name} -p 8080:8080 \\`, '  -v "$PWD/bundles:/workflows:ro" \\']
  if (needsStorage) lines.push(`  -v ${name}-store:/data \\`)
  lines.push('  -e GRAPHRT_API_KEY=<generate one> \\', '  -e OPENAI_API_KEY=<your key> \\')
  if (features.chat) lines.push(`  -e GRAPHRT_CHAT=${name} \\`, `  -e GRAPHRT_CHAT_ACCESS=${features.chatAudience} \\`)
  if (features.chat && features.embedSite) lines.push(`  -e GRAPHRT_CORS_ORIGINS=${features.embedSite} \\`)
  if (needsStorage) lines.push('  -e GRAPHRT_STORE=/data \\', '  -e GRAPHRT_PUBLIC_URL="<https://the address of this server>" \\')
  if (features.phone) lines.push('  -e GRAPHRT_MONITOR=1 \\')
  if (features.notifications && features.notifyEmail) lines.push(`  -e GRAPHRT_PUSH=mailto:${features.notifyEmail} \\`)
  if (features.answerWhenTimeRunsOut) lines.push('  -e GRAPHRT_EXPIRE_APPROVALS=1 \\')
  if (features.whatsapp) {
    for (const variable of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) lines.push(`  -e ${variable}=<from the WhatsApp step> \\`)
  }
  if (features.teams) {
    for (const variable of ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD', 'TEAMS_TENANT_ID']) lines.push(`  -e ${variable}=<from the Teams step> \\`)
  }
  const image = anyFeature(features) ? '  ghcr.io/graphrt/graphrt:0.6.3' : '  ghcr.io/graphrt/graphrt'
  const channels = [features.whatsapp ? 'whatsapp' : null, features.teams ? 'teams' : null].filter((kind): kind is string => kind !== null)
  lines.push(channels.length > 0 ? `${image} \\\n  serve /workflows --addr 0.0.0.0:8080${channels.map((kind) => ` --channel ${kind}=${name}`).join('')}` : image)
  return {
    command: lines.join('\n'),
    needsGraphrtNewerThan: anyFeature(features) ? '0.6.2' : null,
    chatAddress: features.chat ? `https://<the address of this server>/chat/${name}` : null,
    phoneAddress: features.phone ? 'https://<the address of this server>/monitor/' : null,
    whatsappWebhook: features.whatsapp ? 'https://<the address of this server>/v1/channels/whatsapp/webhook' : null,
    teamsEndpoint: features.teams ? 'https://<the address of this server>/v1/channels/teams/webhook' : null,
  }
}

const sampleSteps: DeployStep[] = ['preparing', 'secrets', 'starting', 'checking']
const regionForArea = { asia: 'sin', europe: 'fra', us: 'iad' } as const

/** Like `google_cloud::problem_for` for the one refusal the preview shows: no billing. */
function billingProblem(place: CloudPlace): DeployProblem {
  return {
    provider: 'google_cloud',
    kind: 'billing_disabled',
    message: `Project ${place.project} has no billing account. Link one (Google asks for a card), then try again`,
    technical: `could not create the Cloud Storage bucket: project ${place.project} has no active billing account`,
    project: place.project,
    service: null,
    role: null,
    fix: { kind: 'open_page', url: `https://console.cloud.google.com/billing/linkedaccount?project=${place.project}` },
  }
}

async function deploy(agentId: string, options: DeployOptions): Promise<DeployOutcome> {
  if (!canDeploy(options.provider)) invalid(`Putting agents online with ${deployProviderNames[options.provider]} is coming soon`)
  const place = options.provider === 'google_cloud' ? (options.cloudPlace ?? invalid('Pick a Google Cloud project and region first')) : null
  const awsRegion = options.provider === 'aws' ? (options.region ?? invalid('Pick an AWS region such as ap-southeast-3 first')) : null
  if (state.cli.status === 'not_available') invalid(onlineDeployNotAvailableMessage())
  if (state.cli.status !== 'installed') invalid('Download the graphrt tools first (Review › Allow download)')
  const image = options.image?.trim() || null
  if (image && (image.startsWith('-') || !/^[A-Za-z0-9./:_@-]+$/.test(image))) invalid(`\`${image}\` is not an image name such as ghcr.io/you/graphrt:0.6.0 (leave it empty for graphrt's own image)`)
  const features = checkedFeatures(options.features ?? noOnlineFeatures)
  if (anyFeature(features) && !state.cli.onlineFeatures) invalid(onlineFeaturesNeedNewerToolsMessage())
  const needsStore = features.phone || features.notifications || features.whatsapp || features.teams
  if (options.provider === 'aws' && !state.lambdaStore && needsStore) invalid('Following the agent from your phone, notifications, WhatsApp Business and Microsoft Teams keep things on a storage space, which agents on AWS do not have yet. Turn them off, or put the agent online with Fly.io or Google Cloud.')
  if (!state.accounts.has(options.provider)) throw new BackendError('missing_credentials', `not set up yet: your ${deployProviderNames[options.provider]} account (connect it in Online accounts)`)
  const agent = readStoredAgent(agentId)
  for (const step of sampleSteps) {
    emit({ kind: 'step', agentId, step, status: 'running', message: null })
    emit({ kind: 'log', agentId, line: `${step}: working…` })
    await waitFor(700)
    if (place && state.googleProjects.find((project) => project.id === place.project)?.billing === 'disabled') {
      emit({ kind: 'step', agentId, step, status: 'failed', message: null })
      const problem = billingProblem(place)
      throw new BackendError('deploy_failed', problem.message, problem)
    }
    emit({ kind: 'step', agentId, step, status: 'done', message: null })
  }
  const previous = state.deployments.get(agentId)
  const nextNumber = Number(previous?.deployment.deployedVersionLabel?.slice(1) ?? 0) + 1
  const label = `v${nextNumber}`
  const name = slugFor(agent)
  const placeChanges = place
    ? { provider: 'google_cloud' as const, region: place.region, url: `https://${name}-x7k2q9fa3b-et.a.run.app` }
    : awsRegion
      ? { provider: 'aws' as const, region: awsRegion, url: `https://k3x9q2w7p5c4m8t6.lambda-url.${awsRegion}.on.aws/` }
      : { region: regionForArea[options.area] }
  const view = { ...buildView(agent, { mode: options.mode, ...placeChanges, deployedVersionLabel: label, createdAt: previous?.deployment.createdAt }), features, place }
  state.deployments.set(agentId, view)
  // Without the phone page its storage is removed, and the paired phones with it.
  if (!features.phone) state.devices.delete(`agent:${agentId}`)
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
    if (state.cli.status === 'not_available') invalid(onlineDeployNotAvailableMessage())
    state.cli = { ...state.cli, status: 'installing' }
    await waitFor(1200)
    state.cli = { ...state.cli, status: 'installed', onlineFeatures: state.toolsKnowOnlineFeatures }
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
  signInGoogleCloud: async (): Promise<DeployAccount> => {
    await waitFor(600)
    state.accounts.set('google_cloud', 'Signed in as ana@acme.com')
    return listAccounts().find((account) => account.provider === 'google_cloud') as DeployAccount
  },
  listAwsProfiles: () => respondWith(() => state.awsProfiles),
  connectAwsProfile: async (profile: string): Promise<DeployAccount> => {
    await waitFor(500)
    if (!state.awsProfiles.find((entry) => entry.name === profile)?.hasKeys) invalid(`The profile ${profile} has no access key (it signs in another way). Paste an access key instead`)
    state.accounts.set('aws', `Profile ${profile} · account 123456789012 · user graphrt-deployer`)
    return listAccounts().find((account) => account.provider === 'aws') as DeployAccount
  },
  listGoogleCloudProjects: () =>
    respondWith(() => {
      if (!state.accounts.has('google_cloud')) throw new BackendError('missing_credentials', 'not set up yet: sign in with Google')
      return state.googleProjects
    }),
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
  getOwnServerInstructions: (agentId: string, features: OnlineFeatures) => respondWith(() => ownServerInstructions(agentId, features)),
  getLiveOnlineFeatures: (target: OnlineTarget) => respondWith(() => liveFeatures(target)),
  listPairedDevices: (target: OnlineTarget) =>
    respondWith((): PairedDevice[] => {
      requirePairing(target)
      return (state.devices.get(targetKey(target)) ?? []).map((device) => ({ id: device.id, name: device.name, pairedAtMs: device.pairedAtMs, lastUsedAtMs: device.lastUsedAtMs, canShowCode: device.canShowCode }))
    }),
  pairDevice: (target: OnlineTarget, name: string) => respondWith(() => pair(target, name)),
  showDevicePairing: (target: OnlineTarget, deviceId: string) =>
    respondWith((): DevicePairing => {
      const device = (state.devices.get(targetKey(target)) ?? []).find((entry) => entry.id === deviceId)
      if (!device) throw new BackendError('not_found', "this phone's code on this computer not found")
      return { deviceId: device.id, deviceName: device.name, link: device.link }
    }),
  revokePairedDevice: (target: OnlineTarget, deviceId: string) =>
    respondWith(() => {
      const key = targetKey(target)
      state.devices.set(key, (state.devices.get(key) ?? []).filter((device) => device.id !== deviceId))
    }),
  openDeployLink: () => respondWith(() => undefined),
}
