import type { PluginRequirement, PluginSessionState } from '../pluginRequirementTypes'
import { BackendError } from '../client'
import type {
  BrowserRuntimeEvent,
  BrowserRuntimeStatus,
  InstalledPlugin,
  PluginActionResult,
  PluginAutoUpdate,
  PluginBulkUpdateSummary,
  PluginCatalog,
  PluginCatalogEntry,
  PluginEvent,
  PluginInstallStage,
  PluginPermissions,
} from '../pluginTypes'
import type { FlowStep } from '../types'
import { readCurrentSteps } from './sampleAgentStore'
import { requireText, respondWith } from './sampleResponse'
import {
  initiallyInstalledSamplePlugins,
  isOptionalSampleSetting,
  samplePluginNeedsByAgentId,
  samplePluginSeeds,
  sampleRequiredPluginSettings,
  type SamplePluginNeed,
  type SamplePluginSeed,
} from './samplePluginSeeds'

/**
 * Sample plugins backend for the browser preview and tests. Keeps the install state,
 * trust and which settings have a value in module memory (setting values are dropped,
 * like the keychain-backed store that never hands them back), and emits the same
 * `plugin-event` / `node-runtime-event` payloads the desktop app does.
 */

interface SampleInstalledRecord {
  name: string
  version: string
  trusted: boolean
  configuredVariables: Set<string>
  /** What the installed version asks for (the catalog's, unless a test says otherwise). */
  permissions: PluginPermissions
}

interface SamplePluginsState {
  installedByName: Map<string, SampleInstalledRecord>
  browserRuntimeStatus: BrowserRuntimeStatus
  /** Whether the sample personal WhatsApp session is linked (after `whatsapp-web.login`). */
  isWhatsAppWebLoggedIn: boolean
  /** Plugins each agent uses besides `<plugin>.<kind>` steps (tests may change them). */
  pluginNeedsByAgentId: Record<string, SamplePluginNeed[]>
  /** Updates "installed automatically", newest first (tests set them). */
  autoUpdates: PluginAutoUpdate[]
}

function createInitialState(): SamplePluginsState {
  const installedByName = new Map<string, SampleInstalledRecord>()
  for (const installedPlugin of initiallyInstalledSamplePlugins) {
    const permissions = copyPermissions(findSeed(installedPlugin.name).permissions)
    installedByName.set(installedPlugin.name, { ...installedPlugin, configuredVariables: new Set<string>(), permissions })
  }
  return {
    installedByName,
    browserRuntimeStatus: 'not_installed',
    isWhatsAppWebLoggedIn: false,
    pluginNeedsByAgentId: { ...samplePluginNeedsByAgentId },
    autoUpdates: [],
  }
}

function copyPermissions(permissions: PluginPermissions): PluginPermissions {
  return { ...permissions, env: [...permissions.env] }
}

/** Same rule as `PluginPermissions::asks_for_more_than` in the backend. */
function asksForMoreThan(requested: PluginPermissions, previous: PluginPermissions): boolean {
  return (requested.secrets && !previous.secrets) || requested.env.some((variable) => !previous.env.includes(variable))
}

let pluginsState = createInitialState()
const pluginEventListeners = new Set<(pluginEvent: PluginEvent) => void>()
const browserRuntimeListeners = new Set<(runtimeEvent: BrowserRuntimeEvent) => void>()

function emitPluginEvent(pluginEvent: PluginEvent): void {
  pluginEventListeners.forEach((listener) => listener(pluginEvent))
}

/** @throws BackendError - `not_found` when the catalog has no such plugin */
function findSeed(name: string): SamplePluginSeed {
  const seed = samplePluginSeeds.find((candidate) => candidate.name === name)
  if (!seed) throw new BackendError('not_found', `No plugin named ${name} in the catalog`)
  return seed
}

/** @throws BackendError - `not_found` when the plugin is not installed */
function findInstalledRecord(name: string): SampleInstalledRecord {
  const installedRecord = pluginsState.installedByName.get(name)
  if (!installedRecord) throw new BackendError('not_found', `${name} is not installed`)
  return installedRecord
}

function listWarnings(seed: SamplePluginSeed, installedRecord: SampleInstalledRecord): string[] {
  if (installedRecord.trusted || seed.permissions.env.length === 0) return []
  return [`Not trusted: ${seed.name} does not receive its settings${seed.permissions.secrets ? ' or secrets' : ''}`]
}

function toInstalledPlugin(installedRecord: SampleInstalledRecord): InstalledPlugin {
  const seed = findSeed(installedRecord.name)
  return {
    name: seed.name,
    displayName: seed.displayName,
    version: installedRecord.version,
    description: seed.description,
    permissions: copyPermissions(installedRecord.permissions),
    trusted: installedRecord.trusted,
    needsBrowser: seed.needsBrowser,
    nodes: seed.nodes.map((node) => ({ ...node })),
    tools: [...seed.tools],
    config: seed.permissions.env.map((variable) => ({
      name: variable,
      configured: installedRecord.configuredVariables.has(variable),
      optional: isOptionalSampleSetting(variable),
    })),
    loadError: null,
    warnings: listWarnings(seed, installedRecord),
    readmeUrl: seed.readmeUrl,
    iconUrl: seed.iconUrl,
  }
}

function toCatalogEntry(seed: SamplePluginSeed): PluginCatalogEntry {
  const installedRecord = pluginsState.installedByName.get(seed.name)
  const installedVersion = installedRecord?.version ?? null
  const updateAvailable = installedVersion !== null && installedVersion !== seed.version
  return {
    ...seed,
    permissions: { ...seed.permissions, env: [...seed.permissions.env] },
    nodes: seed.nodes.map((node) => ({ ...node })),
    tools: [...seed.tools],
    installedVersion,
    updateAvailable,
    updateNeedsApproval: updateAvailable && installedRecord !== undefined && asksForMoreThan(seed.permissions, installedRecord.permissions),
  }
}

function readCatalog(): PluginCatalog {
  return { plugins: samplePluginSeeds.map(toCatalogEntry), generatedAt: '2026-11-01T00:00:00Z', fromCache: false }
}

const installStages: PluginInstallStage[] = ['downloading', 'verifying', 'extracting', 'loading', 'done']

function emitInstallProgress(seed: SamplePluginSeed): void {
  for (const stage of installStages) {
    const receivedBytes = stage === 'downloading' ? Math.round(seed.sizeBytes / 2) : seed.sizeBytes
    emitPluginEvent({ type: 'install_progress', name: seed.name, stage, receivedBytes, totalBytes: seed.sizeBytes, message: null })
  }
}

/** @throws BackendError - `invalid_input` when already installed, `not_found` for an unknown plugin */
function installSamplePlugin(name: string): InstalledPlugin {
  const seed = findSeed(name)
  if (pluginsState.installedByName.has(name)) throw new BackendError('invalid_input', `${name} is already installed`)
  emitInstallProgress(seed)
  const installedRecord: SampleInstalledRecord = {
    name,
    version: seed.version,
    trusted: false,
    configuredVariables: new Set<string>(),
    permissions: copyPermissions(seed.permissions),
  }
  pluginsState.installedByName.set(name, installedRecord)
  emitPluginEvent({ type: 'plugins_changed' })
  return toInstalledPlugin(installedRecord)
}

/** @throws BackendError - `invalid_input` when already on the catalog version */
function updateSamplePlugin(name: string): InstalledPlugin {
  const installedRecord = findInstalledRecord(name)
  const seed = findSeed(name)
  if (installedRecord.version === seed.version) throw new BackendError('invalid_input', `${name} is already up to date`)
  emitInstallProgress(seed)
  if (asksForMoreThan(seed.permissions, installedRecord.permissions)) installedRecord.trusted = false
  installedRecord.version = seed.version
  installedRecord.permissions = copyPermissions(seed.permissions)
  emitPluginEvent({ type: 'plugins_changed' })
  return toInstalledPlugin(installedRecord)
}

/** "Update all": every pending update asking for nothing more, like `update_all_plugins`. */
function updateAllSamplePlugins(): PluginBulkUpdateSummary {
  const summary: PluginBulkUpdateSummary = { updated: [], needsApproval: [], failed: [] }
  for (const entry of readCatalog().plugins.filter((catalogEntry) => catalogEntry.updateAvailable)) {
    if (entry.updateNeedsApproval) {
      summary.needsApproval.push(entry.name)
      continue
    }
    const installedRecord = findInstalledRecord(entry.name)
    installedRecord.version = entry.version
    summary.updated.push({ name: entry.name, fromVersion: entry.installedVersion ?? '', toVersion: entry.version })
  }
  if (summary.updated.length > 0) emitPluginEvent({ type: 'plugins_changed' })
  return summary
}

function removeSamplePlugin(name: string): void {
  findInstalledRecord(name)
  pluginsState.installedByName.delete(name)
  if (name === 'whatsapp-web') pluginsState.isWhatsAppWebLoggedIn = false
  emitPluginEvent({ type: 'plugins_changed' })
}

function setSamplePluginTrusted(name: string, trusted: boolean): InstalledPlugin {
  const installedRecord = findInstalledRecord(name)
  installedRecord.trusted = trusted
  return toInstalledPlugin(installedRecord)
}

/** @throws BackendError - `invalid_input` for a setting the plugin does not request */
function requireRequestedVariable(name: string, variable: string): SampleInstalledRecord {
  const installedRecord = findInstalledRecord(name)
  if (!findSeed(name).permissions.env.includes(variable)) throw new BackendError('invalid_input', `${name} does not use the setting ${variable}`)
  return installedRecord
}

function setSamplePluginConfig(name: string, variable: string, value: string): InstalledPlugin {
  const installedRecord = requireRequestedVariable(name, variable)
  requireText(value, `enter a value for ${variable}`)
  installedRecord.configuredVariables.add(variable)
  return toInstalledPlugin(installedRecord)
}

function deleteSamplePluginConfig(name: string, variable: string): InstalledPlugin {
  const installedRecord = requireRequestedVariable(name, variable)
  installedRecord.configuredVariables.delete(variable)
  return toInstalledPlugin(installedRecord)
}

function installSampleBrowserRuntime(): void {
  pluginsState.browserRuntimeStatus = 'installing'
  browserRuntimeListeners.forEach((listener) => listener({ message: 'Downloading Chromium', percent: 50 }))
  pluginsState.browserRuntimeStatus = 'installed'
  browserRuntimeListeners.forEach((listener) => listener({ message: 'Chromium is ready', percent: 100 }))
}

/** @throws BackendError - `invalid_input` when not installed, not trusted, or the kind is not declared */
function requireRunnablePlugin(name: string, kind: string): SampleInstalledRecord {
  const installedRecord = pluginsState.installedByName.get(name)
  if (!installedRecord) throw new BackendError('invalid_input', `Install ${name} before running it`)
  if (!installedRecord.trusted) throw new BackendError('invalid_input', `Trust ${name} before running it`)
  if (!findSeed(name).nodes.some((node) => node.kind === kind)) throw new BackendError('invalid_input', `${name} has no step ${kind}`)
  return installedRecord
}

function requireBrowserRuntime(): void {
  if (pluginsState.browserRuntimeStatus !== 'installed') throw new BackendError('workflow', 'Install the browser runtime first')
}

/** @throws BackendError - `workflow` when the access token or phone number id is missing */
function readSampleBusinessProfile(installedRecord: SampleInstalledRecord): PluginActionResult {
  const missingVariables = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((variable) => !installedRecord.configuredVariables.has(variable))
  if (missingVariables.length > 0) throw new BackendError('workflow', `WhatsApp Cloud API rejected the request: ${missingVariables.join(' and ')} not set`)
  return { outputs: { data: { verified_name: '[BUSINESS NAME]', display_phone_number: '[PHONE NUMBER]' } } }
}

function readSampleWhatsAppWebStatus(): PluginActionResult {
  const status = pluginsState.isWhatsAppWebLoggedIn ? 'logged_in' : 'needs_login'
  return { outputs: { data: { status, sends_today: 0 } } }
}

function linkSampleWhatsAppWeb(): PluginActionResult {
  pluginsState.isWhatsAppWebLoggedIn = true
  return { outputs: { data: { status: 'logged_in' } } }
}

/** Plugins that need a linked account session, like `plugins::session` in the backend. */
const sampleSessionPluginNames = ['whatsapp-web']

/** @throws BackendError - `invalid_input` for a plugin without a session; like `runPluginAction` otherwise */
function checkSamplePluginSession(name: string): PluginSessionState {
  if (!sampleSessionPluginNames.includes(name)) throw new BackendError('invalid_input', `plugin ${name} has no account session to check`)
  const statusData = runSamplePluginAction(name, 'whatsapp-web.get_status').outputs.data as { status: string }
  return statusData.status === 'logged_in' ? 'linked' : 'not_linked'
}

function runSamplePluginAction(name: string, kind: string): PluginActionResult {
  const installedRecord = requireRunnablePlugin(name, kind)
  if (findSeed(name).needsBrowser) requireBrowserRuntime()
  if (kind === 'whatsapp-api.get_business_profile') return readSampleBusinessProfile(installedRecord)
  if (kind === 'whatsapp-web.get_status') return readSampleWhatsAppWebStatus()
  if (kind === 'whatsapp-web.login') return linkSampleWhatsAppWeb()
  return { outputs: { data: {} } }
}

/** Plugin name per step: `<plugin>.<kind>` node types, plus the agent's seeded needs. */
function collectStepTitlesByPlugin(agentId: string, steps: FlowStep[]): Map<string, string[]> {
  const stepTitlesByPlugin = new Map<string, string[]>()
  const addStep = (pluginName: string, stepTitle: string) => stepTitlesByPlugin.set(pluginName, [...(stepTitlesByPlugin.get(pluginName) ?? []), stepTitle])
  for (const flowStep of steps) {
    const separatorIndex = flowStep.nodeType.indexOf('.')
    if (separatorIndex > 0) addStep(flowStep.nodeType.slice(0, separatorIndex), flowStep.title)
  }
  for (const need of pluginsState.pluginNeedsByAgentId[agentId] ?? []) {
    const neededStep = steps.find((flowStep) => flowStep.id === need.stepId)
    if (neededStep && !stepTitlesByPlugin.get(need.pluginName)?.includes(neededStep.title)) addStep(need.pluginName, neededStep.title)
  }
  return stepTitlesByPlugin
}

function toPluginRequirement(seed: SamplePluginSeed, usedBySteps: string[]): PluginRequirement {
  const installedRecord = pluginsState.installedByName.get(seed.name)
  const trustNotNeeded = !seed.permissions.secrets
  const requiredSettings = sampleRequiredPluginSettings[seed.name] ?? []
  const missingConfig = requiredSettings.filter((variable) => !installedRecord?.configuredVariables.has(variable))
  const browserReady = !seed.needsBrowser || pluginsState.browserRuntimeStatus === 'installed'
  const installed = installedRecord !== undefined
  const trusted = installedRecord?.trusted ?? false
  const needsSession = sampleSessionPluginNames.includes(seed.name)
  const sessionLinked = !needsSession || pluginsState.isWhatsAppWebLoggedIn
  return {
    name: seed.name,
    displayName: seed.displayName,
    description: seed.description,
    usedBySteps,
    permissions: { ...seed.permissions, env: [...seed.permissions.env] },
    needsBrowser: seed.needsBrowser,
    warning: seed.warning,
    installed,
    trusted,
    trustNotNeeded,
    missingConfig,
    browserReady,
    needsSession,
    sessionLinked,
    ready: installed && (trusted || trustNotNeeded) && missingConfig.length === 0 && browserReady && sessionLinked,
  }
}

/** @throws BackendError - `not_found` for an unknown agent */
function listSampleAgentPluginRequirements(agentId: string): PluginRequirement[] {
  const stepTitlesByPlugin = collectStepTitlesByPlugin(agentId, readCurrentSteps(agentId))
  return [...stepTitlesByPlugin].flatMap(([pluginName, usedBySteps]) => {
    const seed = samplePluginSeeds.find((candidate) => candidate.name === pluginName)
    return seed ? [toPluginRequirement(seed, usedBySteps)] : []
  })
}

/** @throws BackendError - `not_found` for an unknown plugin or one without a README link */
function openSamplePluginReadme(name: string): void {
  const { readmeUrl } = findSeed(name)
  if (!readmeUrl) throw new BackendError('not_found', `${name} has no README link`)
  window.open(readmeUrl, '_blank', 'noopener,noreferrer')
}

export const samplePluginsBackend = {
  listAgentPluginRequirements: (agentId: string): Promise<PluginRequirement[]> => respondWith(() => listSampleAgentPluginRequirements(agentId)),
  listPluginCatalog: (_refresh: boolean): Promise<PluginCatalog> => respondWith(readCatalog),
  listInstalledPlugins: (): Promise<InstalledPlugin[]> => respondWith(() => [...pluginsState.installedByName.values()].map(toInstalledPlugin)),
  installPlugin: (name: string): Promise<InstalledPlugin> => respondWith(() => installSamplePlugin(name)),
  updatePlugin: (name: string): Promise<InstalledPlugin> => respondWith(() => updateSamplePlugin(name)),
  updateAllPlugins: (): Promise<PluginBulkUpdateSummary> => respondWith(updateAllSamplePlugins),
  listPluginAutoUpdates: (): Promise<PluginAutoUpdate[]> => respondWith(() => pluginsState.autoUpdates.map((autoUpdate) => ({ ...autoUpdate }))),
  removePlugin: (name: string): Promise<void> => respondWith(() => removeSamplePlugin(name)),
  setPluginTrusted: (name: string, trusted: boolean): Promise<InstalledPlugin> => respondWith(() => setSamplePluginTrusted(name, trusted)),
  setPluginConfig: (name: string, variable: string, value: string): Promise<InstalledPlugin> => respondWith(() => setSamplePluginConfig(name, variable, value)),
  deletePluginConfig: (name: string, variable: string): Promise<InstalledPlugin> => respondWith(() => deleteSamplePluginConfig(name, variable)),
  getBrowserRuntimeStatus: (): Promise<BrowserRuntimeStatus> => respondWith(() => pluginsState.browserRuntimeStatus),
  installBrowserRuntime: (): Promise<void> => respondWith(installSampleBrowserRuntime),
  runPluginAction: (name: string, kind: string, _config: Record<string, unknown>): Promise<PluginActionResult> =>
    respondWith(() => runSamplePluginAction(name, kind)),
  checkPluginSession: (name: string): Promise<PluginSessionState> => respondWith(() => checkSamplePluginSession(name)),
  openPluginReadme: (name: string): Promise<void> => respondWith(() => openSamplePluginReadme(name)),
  /** The preview has no downloaded icons: every plugin shows its monogram. */
  getPluginIcon: (_name: string): Promise<string | null> => respondWith(() => null),
}

/** Subscribes to sample `plugin-event` payloads. Returns the unsubscribe function. */
export function subscribeToSamplePluginEvents(onEvent: (pluginEvent: PluginEvent) => void): () => void {
  pluginEventListeners.add(onEvent)
  return () => pluginEventListeners.delete(onEvent)
}

/** Subscribes to sample `node-runtime-event` payloads. Returns the unsubscribe function. */
export function subscribeToSampleBrowserRuntimeEvents(onEvent: (runtimeEvent: BrowserRuntimeEvent) => void): () => void {
  browserRuntimeListeners.add(onEvent)
  return () => browserRuntimeListeners.delete(onEvent)
}

/** Sends a sample `plugin-event` to every subscriber (tests that show progress mid-install). */
export function emitSamplePluginEvent(pluginEvent: PluginEvent): void {
  emitPluginEvent(pluginEvent)
}

/** Sets the sample browser runtime status (tests that start with it installed). */
export function setSampleBrowserRuntimeStatus(status: BrowserRuntimeStatus): void {
  pluginsState.browserRuntimeStatus = status
}

/**
 * Sets which plugins a sample agent uses besides `<plugin>.<kind>` steps (tests that need
 * an agent without plugins, or with other ones). Undone by {@link resetSamplePlugins}.
 */
export function setSampleAgentPluginNeeds(agentId: string, needs: SamplePluginNeed[]): void {
  pluginsState.pluginNeedsByAgentId[agentId] = needs
}

/**
 * Installs (or replaces) a sample plugin at `version`, asking for `permissions` (the
 * catalog's by default): tests of pending updates, with or without new permissions.
 */
export function setSampleInstalledPlugin(name: string, version: string, permissions?: PluginPermissions): void {
  const seed = findSeed(name)
  const previous = pluginsState.installedByName.get(name)
  pluginsState.installedByName.set(name, {
    name,
    version,
    trusted: previous?.trusted ?? false,
    configuredVariables: previous?.configuredVariables ?? new Set<string>(),
    permissions: copyPermissions(permissions ?? seed.permissions),
  })
}

/** Sets the updates the sample says it installed by itself (newest first). */
export function setSampleAutoUpdates(autoUpdates: PluginAutoUpdate[]): void {
  pluginsState.autoUpdates = autoUpdates.map((autoUpdate) => ({ ...autoUpdate }))
}

/** Restores the two installed sample plugins and clears trust, settings and sessions (use in test `beforeEach`). */
export function resetSamplePlugins(): void {
  pluginsState = createInitialState()
}

/** Sends a sample `node-runtime-event` to every subscriber (tests that show browser download progress). */
export function emitSampleBrowserRuntimeEvent(runtimeEvent: BrowserRuntimeEvent): void {
  browserRuntimeListeners.forEach((listener) => listener(runtimeEvent))
}
