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
  PluginNodeInfo,
  PluginPermissions,
  PluginRuntimeInfo,
  PluginSource,
} from '../pluginTypes'
import type { FlowStep } from '../types'
import { readCurrentSteps } from './sampleAgentStore'
import { requireText, respondWith } from './sampleResponse'
import { sampleAppSettingsBackend } from './appSettings'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import type { LocalPluginPickKind } from '../plugins'
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
  /** Set for a plugin "installed from this computer" (Developer mode): the picked path. */
  localPath?: string
}

/** Catalog labels tests give a seed (official, by graphrt, without a repository by default). */
type SampleCatalogLabels = Pick<PluginCatalogEntry, 'source' | 'publisher' | 'repositoryUrl'>

interface SamplePluginsState {
  installedByName: Map<string, SampleInstalledRecord>
  browserRuntimeStatus: BrowserRuntimeStatus
  /** The plugin runtime (Node.js); installed unless a test removes it. */
  pluginRuntimeStatus: BrowserRuntimeStatus
  /** Whether the sample personal WhatsApp session is linked (after `whatsapp-web.login`). */
  isWhatsAppWebLoggedIn: boolean
  /** Plugins each agent uses besides `<plugin>.<kind>` steps (tests may change them). */
  pluginNeedsByAgentId: Record<string, SamplePluginNeed[]>
  /** Updates "installed automatically", newest first (tests set them). */
  autoUpdates: PluginAutoUpdate[]
  /** When the sample catalog was last "fetched" (ms since epoch), or null before the first fetch. */
  catalogFetchedAtMs: number | null
  /** Source / publisher / repository per seed, when a test changes them. */
  catalogLabelsByName: Map<string, SampleCatalogLabels>
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
    pluginRuntimeStatus: 'installed',
    isWhatsAppWebLoggedIn: false,
    pluginNeedsByAgentId: { ...samplePluginNeedsByAgentId },
    autoUpdates: [],
    catalogFetchedAtMs: null,
    catalogLabelsByName: new Map(),
  }
}

/** The catalog labels of a seed: a test's, else the seed's, else official by graphrt. */
function readCatalogLabels(seed: SamplePluginSeed): SampleCatalogLabels {
  const seedLabels: SampleCatalogLabels = { source: seed.source ?? 'official', publisher: seed.publisher ?? 'graphrt', repositoryUrl: seed.repositoryUrl ?? null }
  return pluginsState.catalogLabelsByName.get(seed.name) ?? seedLabels
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

/** A plugin "installed from this computer": the seed's steps when one has its name, else none. */
function toLocalInstalledPlugin(installedRecord: SampleInstalledRecord, localPath: string): InstalledPlugin {
  const seed = samplePluginSeeds.find((candidate) => candidate.name === installedRecord.name)
  return {
    name: installedRecord.name,
    displayName: humanizePluginName(installedRecord.name),
    version: installedRecord.version,
    description: seed?.description ?? 'A plugin installed from this computer',
    permissions: copyPermissions(installedRecord.permissions),
    trusted: installedRecord.trusted,
    needsBrowser: false,
    needsNodeRuntime: true,
    nodes: seed?.nodes.map((node) => ({ ...node })) ?? [],
    tools: seed ? [...seed.tools] : [],
    config: installedRecord.permissions.env.map((variable) => ({ name: variable, configured: installedRecord.configuredVariables.has(variable), optional: isOptionalSampleSetting(variable) })),
    loadError: null,
    warnings: [],
    readmeUrl: null,
    iconUrl: null,
    source: 'local',
    publisher: null,
    repositoryUrl: null,
    localPath,
  }
}

function toInstalledPlugin(installedRecord: SampleInstalledRecord): InstalledPlugin {
  if (installedRecord.localPath !== undefined) return toLocalInstalledPlugin(installedRecord, installedRecord.localPath)
  const seed = findSeed(installedRecord.name)
  const labels = readCatalogLabels(seed)
  return {
    name: seed.name,
    displayName: seed.displayName,
    version: installedRecord.version,
    description: seed.description,
    permissions: copyPermissions(installedRecord.permissions),
    trusted: installedRecord.trusted,
    needsBrowser: seed.needsBrowser,
    needsNodeRuntime: true,
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
    source: labels.source,
    publisher: labels.publisher,
    repositoryUrl: labels.repositoryUrl,
    localPath: null,
  }
}

function toCatalogEntry(seed: SamplePluginSeed): PluginCatalogEntry {
  const record = pluginsState.installedByName.get(seed.name)
  // Like the backend: a plugin installed from this computer is never matched with the catalog.
  const installedRecord = record?.localPath === undefined ? record : undefined
  const installedVersion = installedRecord?.version ?? null
  const updateAvailable = installedVersion !== null && installedVersion !== seed.version
  return {
    ...seed,
    ...readCatalogLabels(seed),
    permissions: { ...seed.permissions, env: [...seed.permissions.env] },
    nodes: seed.nodes.map((node) => ({ ...node })),
    tools: [...seed.tools],
    installedVersion,
    updateAvailable,
    updateNeedsApproval: updateAvailable && installedRecord !== undefined && asksForMoreThan(seed.permissions, installedRecord.permissions),
  }
}

/** Like the backend: the in-memory catalog is reused unless `refresh`, and remembers when it was fetched. */
function readCatalog(refresh: boolean): PluginCatalog {
  if (refresh || pluginsState.catalogFetchedAtMs === null) pluginsState.catalogFetchedAtMs = Date.now()
  const fetchedAt = new Date(pluginsState.catalogFetchedAtMs).toISOString()
  return { plugins: samplePluginSeeds.map(toCatalogEntry), generatedAt: '2026-11-01T00:00:00Z', fromCache: false, fetchedAt, fetchError: null }
}

function listSampleCatalogSteps(name: string): PluginNodeInfo[] {
  const seed = samplePluginSeeds.find((candidate) => candidate.name === name)
  if (!seed) throw new BackendError('not_found', `plugin ${name} in the catalog`)
  return seed.nodes.map((node) => ({ ...node }))
}

const installStages: PluginInstallStage[] = ['downloading', 'verifying', 'extracting', 'loading', 'done']

function emitInstallProgress(seed: SamplePluginSeed): void {
  for (const stage of installStages) {
    const receivedBytes = stage === 'downloading' ? Math.round(seed.sizeBytes / 2) : seed.sizeBytes
    emitPluginEvent({ type: 'install_progress', name: seed.name, stage, receivedBytes, totalBytes: seed.sizeBytes, message: null })
  }
}

/**
 * Like `install_plugin`: refuses a plugin asking for more than `approvedPermissions` (what the
 * screen showed). Tests that only set up state may leave it out; the app always passes it.
 *
 * @throws BackendError - `invalid_input` when already installed or asking for more than approved, `not_found` for an unknown plugin
 */
function installSamplePlugin(name: string, approvedPermissions?: PluginPermissions): InstalledPlugin {
  const seed = findSeed(name)
  if (pluginsState.installedByName.has(name)) throw new BackendError('invalid_input', `${name} is already installed`)
  if (approvedPermissions && asksForMoreThan(seed.permissions, approvedPermissions)) {
    throw new BackendError('invalid_input', `plugin ${name} ${seed.version} asks for more than you approved; nothing was installed`)
  }
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
  for (const entry of readCatalog(false).plugins.filter((catalogEntry) => catalogEntry.updateAvailable)) {
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

/**
 * Like `set_plugin_trusted`: trusting with `approvedPermissions` refuses a plugin asking for more.
 * Tests that only set up state may leave them out; the app always passes them to trust.
 *
 * @throws BackendError - `invalid_input` when the installed plugin asks for more than approved
 */
function setSamplePluginTrusted(name: string, trusted: boolean, approvedPermissions?: PluginPermissions): InstalledPlugin {
  const installedRecord = findInstalledRecord(name)
  if (trusted && approvedPermissions && asksForMoreThan(installedRecord.permissions, approvedPermissions)) {
    throw new BackendError('invalid_input', `plugin ${name} asks for more than you approved; it was not trusted`)
  }
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

const samplePluginRuntimeVersion = '22.23.5'

function readSamplePluginRuntimeInfo(): PluginRuntimeInfo {
  const isInstalled = pluginsState.pluginRuntimeStatus === 'installed'
  return {
    status: pluginsState.pluginRuntimeStatus,
    version: isInstalled ? `v${samplePluginRuntimeVersion}` : null,
    pinnedVersion: samplePluginRuntimeVersion,
    path: isInstalled ? `[APP DATA]/runtime/node-${samplePluginRuntimeVersion}/node` : null,
    source: isInstalled ? 'downloaded' : 'missing',
    removable: isInstalled,
    downloadable: true,
    browserStatus: pluginsState.browserRuntimeStatus,
    browsersPath: '[HOME]/Library/Caches/ms-playwright',
  }
}

function installSamplePluginRuntime(): void {
  pluginsState.pluginRuntimeStatus = 'installing'
  browserRuntimeListeners.forEach((listener) => listener({ type: 'node_install_started', version: samplePluginRuntimeVersion }))
  browserRuntimeListeners.forEach((listener) => listener({ type: 'node_install_progress', message: 'Downloading Node.js', percent: 50 }))
  pluginsState.pluginRuntimeStatus = 'installed'
  browserRuntimeListeners.forEach((listener) => listener({ type: 'node_install_finished', alreadyInstalled: false }))
}

function removeSamplePluginRuntime(): boolean {
  const wasInstalled = pluginsState.pluginRuntimeStatus === 'installed'
  pluginsState.pluginRuntimeStatus = 'not_installed'
  emitPluginEvent({ type: 'plugins_changed' })
  return wasInstalled
}

function requireSamplePluginRuntime(): void {
  if (pluginsState.pluginRuntimeStatus !== 'installed') throw new BackendError('invalid_input', 'the plugin runtime (Node.js) is not installed; install it from Plugins or Settings')
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
  requireSamplePluginRuntime()
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
  const nodeRuntimeReady = pluginsState.pluginRuntimeStatus === 'installed'
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
    needsNodeRuntime: true,
    nodeRuntimeReady,
    needsSession,
    sessionLinked,
    ready: installed && (trusted || trustNotNeeded) && missingConfig.length === 0 && browserReady && nodeRuntimeReady && sessionLinked,
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

/** @throws BackendError - `not_found` for an unknown plugin or one without a repository link */
function openSamplePluginRepository(name: string): void {
  const installedRecord = pluginsState.installedByName.get(name)
  const repositoryUrl = installedRecord?.localPath === undefined ? readCatalogLabels(findSeed(name)).repositoryUrl : null
  if (!repositoryUrl) throw new BackendError('not_found', `${name} has no repository link`)
  window.open(repositoryUrl, '_blank', 'noopener,noreferrer')
}

/** Sample paths the preview "picks" (it has no file picker). */
const samplePickedPaths: Record<LocalPluginPickKind, string> = {
  folder: '/Users/you/code/my-local-plugin',
  archive: '/Users/you/Downloads/my-local-plugin-0.1.0.tar.gz',
}

/** The plugin name a sample path stands for: the folder name, or the archive name before its version. */
function nameFromPickedPath(path: string): string {
  const baseName = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return baseName.replace(/\.(tar\.gz|tgz)$/, '').replace(/-\d+(\.\d+)*$/, '')
}

/**
 * Like `install_local_plugin`: refuses a name installed from the catalog unless `replace`,
 * and installs the plugin untrusted, labelled local.
 *
 * @throws BackendError - `invalid_input` while Developer mode is off; `conflict` for a catalog name
 */
async function installSampleLocalPlugin(path: string, replace: boolean): Promise<InstalledPlugin> {
  const { developerMode } = await sampleAppSettingsBackend.getAppSettings()
  if (!developerMode) throw new BackendError('invalid_input', 'turn on Developer mode to install plugins from this computer')
  const trimmedPath = requireText(path, 'choose a plugin folder or archive')
  const name = nameFromPickedPath(trimmedPath)
  const existing = pluginsState.installedByName.get(name)
  if (existing && existing.localPath === undefined && !replace) {
    throw new BackendError('conflict', `plugin ${name} is already installed from the catalog; confirm to replace it with the copy from this computer`)
  }
  const seed = samplePluginSeeds.find((candidate) => candidate.name === name)
  const installedRecord: SampleInstalledRecord = {
    name,
    version: '0.1.0',
    trusted: false,
    configuredVariables: new Set<string>(),
    permissions: copyPermissions(seed?.permissions ?? { network: true, secrets: false, env: [] }),
    localPath: trimmedPath,
  }
  pluginsState.installedByName.set(name, installedRecord)
  emitPluginEvent({ type: 'plugins_changed' })
  return toInstalledPlugin(installedRecord)
}

export const samplePluginsBackend = {
  listAgentPluginRequirements: (agentId: string): Promise<PluginRequirement[]> => respondWith(() => listSampleAgentPluginRequirements(agentId)),
  listPluginCatalog: (refresh: boolean): Promise<PluginCatalog> => respondWith(() => readCatalog(refresh)),
  listPluginCatalogSteps: (name: string): Promise<PluginNodeInfo[]> => respondWith(() => listSampleCatalogSteps(name)),
  listInstalledPlugins: (): Promise<InstalledPlugin[]> => respondWith(() => [...pluginsState.installedByName.values()].map(toInstalledPlugin)),
  installPlugin: (name: string, approvedPermissions?: PluginPermissions): Promise<InstalledPlugin> => respondWith(() => installSamplePlugin(name, approvedPermissions)),
  updatePlugin: (name: string): Promise<InstalledPlugin> => respondWith(() => updateSamplePlugin(name)),
  updateAllPlugins: (): Promise<PluginBulkUpdateSummary> => respondWith(updateAllSamplePlugins),
  listPluginAutoUpdates: (): Promise<PluginAutoUpdate[]> => respondWith(() => pluginsState.autoUpdates.map((autoUpdate) => ({ ...autoUpdate }))),
  removePlugin: (name: string): Promise<void> => respondWith(() => removeSamplePlugin(name)),
  setPluginTrusted: (name: string, trusted: boolean, approvedPermissions?: PluginPermissions): Promise<InstalledPlugin> =>
    respondWith(() => setSamplePluginTrusted(name, trusted, approvedPermissions)),
  setPluginConfig: (name: string, variable: string, value: string): Promise<InstalledPlugin> => respondWith(() => setSamplePluginConfig(name, variable, value)),
  deletePluginConfig: (name: string, variable: string): Promise<InstalledPlugin> => respondWith(() => deleteSamplePluginConfig(name, variable)),
  getBrowserRuntimeStatus: (): Promise<BrowserRuntimeStatus> => respondWith(() => pluginsState.browserRuntimeStatus),
  installBrowserRuntime: (): Promise<void> => respondWith(installSampleBrowserRuntime),
  getPluginRuntimeInfo: (): Promise<PluginRuntimeInfo> => respondWith(readSamplePluginRuntimeInfo),
  installPluginRuntime: (): Promise<void> => respondWith(installSamplePluginRuntime),
  removePluginRuntime: (): Promise<boolean> => respondWith(removeSamplePluginRuntime),
  runPluginAction: (name: string, kind: string, _config: Record<string, unknown>): Promise<PluginActionResult> =>
    respondWith(() => runSamplePluginAction(name, kind)),
  checkPluginSession: (name: string): Promise<PluginSessionState> => respondWith(() => checkSamplePluginSession(name)),
  openPluginReadme: (name: string): Promise<void> => respondWith(() => openSamplePluginReadme(name)),
  openPluginRepository: (name: string): Promise<void> => respondWith(() => openSamplePluginRepository(name)),
  pickLocalPluginPath: (kind: LocalPluginPickKind): Promise<string | null> => respondWith(() => samplePickedPaths[kind]),
  installLocalPlugin: (path: string, replace: boolean): Promise<InstalledPlugin> => installSampleLocalPlugin(path, replace),
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

/** Sets the sample plugin runtime (Node.js) status (tests of the missing-runtime flows). */
export function setSamplePluginRuntimeStatus(status: BrowserRuntimeStatus): void {
  pluginsState.pluginRuntimeStatus = status
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

/** Gives a catalog seed a source, publisher and repository (tests of the community labels). */
export function setSampleCatalogLabels(name: string, labels: { source: PluginSource; publisher: string | null; repositoryUrl: string | null }): void {
  findSeed(name)
  pluginsState.catalogLabelsByName.set(name, { ...labels })
}

/** Sets the updates the sample says it installed by itself (newest first). */
export function setSampleAutoUpdates(autoUpdates: PluginAutoUpdate[]): void {
  pluginsState.autoUpdates = autoUpdates.map((autoUpdate) => ({ ...autoUpdate }))
}

/** Restores the two installed sample plugins and clears trust, settings and sessions (use in test `beforeEach`). */
/** Pretends the sample catalog was fetched at `fetchedAtMs` (tests of the stale refetch). */
export function setSampleCatalogFetchedAt(fetchedAtMs: number | null): void {
  pluginsState.catalogFetchedAtMs = fetchedAtMs
}

export function resetSamplePlugins(): void {
  pluginsState = createInitialState()
}

/** Sends a sample `node-runtime-event` to every subscriber (tests that show browser download progress). */
export function emitSampleBrowserRuntimeEvent(runtimeEvent: BrowserRuntimeEvent): void {
  browserRuntimeListeners.forEach((listener) => listener(runtimeEvent))
}
