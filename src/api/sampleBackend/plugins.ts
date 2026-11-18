import { BackendError } from '../client'
import type {
  BrowserRuntimeEvent,
  BrowserRuntimeStatus,
  InstalledPlugin,
  PluginActionResult,
  PluginCatalog,
  PluginCatalogEntry,
  PluginEvent,
  PluginInstallStage,
} from '../pluginTypes'
import { requireText, respondWith } from './sampleResponse'
import { initiallyInstalledSamplePlugins, samplePluginSeeds, type SamplePluginSeed } from './samplePluginSeeds'

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
}

interface SamplePluginsState {
  installedByName: Map<string, SampleInstalledRecord>
  browserRuntimeStatus: BrowserRuntimeStatus
  /** Whether the sample personal WhatsApp session is linked (after `whatsapp-web.login`). */
  isWhatsAppWebLoggedIn: boolean
}

function createInitialState(): SamplePluginsState {
  const installedByName = new Map<string, SampleInstalledRecord>()
  for (const installedPlugin of initiallyInstalledSamplePlugins) {
    installedByName.set(installedPlugin.name, { ...installedPlugin, configuredVariables: new Set<string>() })
  }
  return { installedByName, browserRuntimeStatus: 'not_installed', isWhatsAppWebLoggedIn: false }
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
    version: installedRecord.version,
    description: seed.description,
    permissions: { ...seed.permissions, env: [...seed.permissions.env] },
    trusted: installedRecord.trusted,
    needsBrowser: seed.needsBrowser,
    nodes: seed.nodes.map((node) => ({ ...node })),
    tools: [...seed.tools],
    config: seed.permissions.env.map((variable) => ({ name: variable, configured: installedRecord.configuredVariables.has(variable) })),
    loadError: null,
    warnings: listWarnings(seed, installedRecord),
    readmeUrl: seed.readmeUrl,
  }
}

function toCatalogEntry(seed: SamplePluginSeed): PluginCatalogEntry {
  const installedVersion = pluginsState.installedByName.get(seed.name)?.version ?? null
  return {
    ...seed,
    permissions: { ...seed.permissions, env: [...seed.permissions.env] },
    nodes: seed.nodes.map((node) => ({ ...node })),
    tools: [...seed.tools],
    installedVersion,
    updateAvailable: installedVersion !== null && installedVersion !== seed.version,
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
  const installedRecord: SampleInstalledRecord = { name, version: seed.version, trusted: false, configuredVariables: new Set<string>() }
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
  installedRecord.version = seed.version
  emitPluginEvent({ type: 'plugins_changed' })
  return toInstalledPlugin(installedRecord)
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

function runSamplePluginAction(name: string, kind: string): PluginActionResult {
  const installedRecord = requireRunnablePlugin(name, kind)
  if (findSeed(name).needsBrowser) requireBrowserRuntime()
  if (kind === 'whatsapp-api.get_business_profile') return readSampleBusinessProfile(installedRecord)
  if (kind === 'whatsapp-web.get_status') return readSampleWhatsAppWebStatus()
  if (kind === 'whatsapp-web.login') return linkSampleWhatsAppWeb()
  return { outputs: { data: {} } }
}

export const samplePluginsBackend = {
  listPluginCatalog: (_refresh: boolean): Promise<PluginCatalog> => respondWith(readCatalog),
  listInstalledPlugins: (): Promise<InstalledPlugin[]> => respondWith(() => [...pluginsState.installedByName.values()].map(toInstalledPlugin)),
  installPlugin: (name: string): Promise<InstalledPlugin> => respondWith(() => installSamplePlugin(name)),
  updatePlugin: (name: string): Promise<InstalledPlugin> => respondWith(() => updateSamplePlugin(name)),
  removePlugin: (name: string): Promise<void> => respondWith(() => removeSamplePlugin(name)),
  setPluginTrusted: (name: string, trusted: boolean): Promise<InstalledPlugin> => respondWith(() => setSamplePluginTrusted(name, trusted)),
  setPluginConfig: (name: string, variable: string, value: string): Promise<InstalledPlugin> => respondWith(() => setSamplePluginConfig(name, variable, value)),
  deletePluginConfig: (name: string, variable: string): Promise<InstalledPlugin> => respondWith(() => deleteSamplePluginConfig(name, variable)),
  getBrowserRuntimeStatus: (): Promise<BrowserRuntimeStatus> => respondWith(() => pluginsState.browserRuntimeStatus),
  installBrowserRuntime: (): Promise<void> => respondWith(installSampleBrowserRuntime),
  runPluginAction: (name: string, kind: string, _config: Record<string, unknown>): Promise<PluginActionResult> =>
    respondWith(() => runSamplePluginAction(name, kind)),
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

/** Restores the two installed sample plugins and clears trust, settings and sessions (use in test `beforeEach`). */
export function resetSamplePlugins(): void {
  pluginsState = createInitialState()
}
