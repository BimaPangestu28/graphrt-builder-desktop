import { callBackend, isDesktopApp, listenToBackend } from './client'
import {
  BROWSER_RUNTIME_EVENT_NAME,
  PLUGIN_EVENT_NAME,
  type BrowserRuntimeEvent,
  type BrowserRuntimeStatus,
  type InstalledPlugin,
  type PluginActionResult,
  type PluginAutoUpdate,
  type PluginBulkUpdateSummary,
  type PluginCatalog,
  type PluginEvent,
  type PluginNodeInfo,
} from './pluginTypes'
import type { PluginRequirement, PluginSessionState } from './pluginRequirementTypes'
import { samplePluginsBackend, subscribeToSampleBrowserRuntimeEvents, subscribeToSamplePluginEvents } from './sampleBackend/plugins'

/**
 * graphrt plugins: the online catalog, installed plugins with their trust and settings,
 * the browser runtime some plugins need, and one-off plugin actions (e.g. linking
 * WhatsApp). Outside the desktop app every call goes to the sample plugins backend.
 */

/**
 * The plugin catalog merged with this computer's install state.
 *
 * @param refresh - Fetch the catalog again instead of using the saved copy (boolean)
 */
export function listPluginCatalog(refresh = false): Promise<PluginCatalog> {
  if (!isDesktopApp()) return samplePluginsBackend.listPluginCatalog(refresh)
  return callBackend('list_plugin_catalog', { refresh })
}

/**
 * The steps a catalog plugin adds, with descriptions, for its plugin page. Newer catalogs
 * keep them in a per-version detail file the app fetches on demand (and caches); offline
 * it may return only kinds and titles.
 *
 * @param name - Plugin name, e.g. "whatsapp-api" (string)
 * @returns The plugin's steps (PluginNodeInfo[])
 * @throws BackendError - `not_found` when the catalog does not list the plugin
 */
export function listPluginCatalogSteps(name: string): Promise<PluginNodeInfo[]> {
  if (!isDesktopApp()) return samplePluginsBackend.listPluginCatalogSteps(name)
  return callBackend('list_plugin_catalog_steps', { name })
}

export function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  if (!isDesktopApp()) return samplePluginsBackend.listInstalledPlugins()
  return callBackend('list_installed_plugins')
}

/**
 * Downloads, verifies and loads a catalog plugin. Progress arrives as `install_progress`
 * events (see {@link listenToPluginEvents}). New plugins start untrusted.
 *
 * @throws BackendError - e.g. `not_found` for an unknown plugin, `invalid_input` when installed already
 */
export function installPlugin(name: string): Promise<InstalledPlugin> {
  if (!isDesktopApp()) return samplePluginsBackend.installPlugin(name)
  return callBackend('install_plugin', { name })
}

/** Installs the catalog version over the installed one (when `updateAvailable`). */
export function updatePlugin(name: string): Promise<InstalledPlugin> {
  if (!isDesktopApp()) return samplePluginsBackend.updatePlugin(name)
  return callBackend('update_plugin', { name })
}

/**
 * "Update all": installs every pending update that asks for no new permissions. Updates
 * that ask for more are left for the user and listed in `needsApproval`.
 *
 * @returns What was updated, left alone or failed (PluginBulkUpdateSummary)
 * @throws BackendError - when there is no catalog (offline and never fetched)
 */
export function updateAllPlugins(): Promise<PluginBulkUpdateSummary> {
  if (!isDesktopApp()) return samplePluginsBackend.updateAllPlugins()
  return callBackend('update_all_plugins')
}

/** Plugins graphrt updated by itself, newest first (at most 20). */
export function listPluginAutoUpdates(): Promise<PluginAutoUpdate[]> {
  if (!isDesktopApp()) return samplePluginsBackend.listPluginAutoUpdates()
  return callBackend('list_plugin_auto_updates')
}

export function removePlugin(name: string): Promise<void> {
  if (!isDesktopApp()) return samplePluginsBackend.removePlugin(name)
  return callBackend('remove_plugin', { name })
}

/** Trusted plugins receive their settings and plaintext secrets and may run actions. */
export function setPluginTrusted(name: string, trusted: boolean): Promise<InstalledPlugin> {
  if (!isDesktopApp()) return samplePluginsBackend.setPluginTrusted(name, trusted)
  return callBackend('set_plugin_trusted', { name, trusted })
}

/**
 * Saves a setting the plugin requests (e.g. `WHATSAPP_ACCESS_TOKEN`) in the OS keychain.
 * The value is never read back; the returned plugin only says it is `configured`.
 */
export function setPluginConfig(name: string, variable: string, value: string): Promise<InstalledPlugin> {
  if (!isDesktopApp()) return samplePluginsBackend.setPluginConfig(name, variable, value)
  return callBackend('set_plugin_config', { name, variable, value })
}

export function deletePluginConfig(name: string, variable: string): Promise<InstalledPlugin> {
  if (!isDesktopApp()) return samplePluginsBackend.deletePluginConfig(name, variable)
  return callBackend('delete_plugin_config', { name, variable })
}

export function getBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  if (!isDesktopApp()) return samplePluginsBackend.getBrowserRuntimeStatus()
  return callBackend('browser_runtime_status')
}

/** Installs Chromium for browser plugins. Progress arrives through {@link listenToBrowserRuntimeEvents}. */
export function installBrowserRuntime(): Promise<void> {
  if (!isDesktopApp()) return samplePluginsBackend.installBrowserRuntime()
  return callBackend('install_browser_runtime')
}

/**
 * Runs one node kind a trusted plugin declares and returns its outputs.
 *
 * @param name - Plugin name, e.g. "whatsapp-web" (string)
 * @param kind - Full node kind, e.g. "whatsapp-web.login" (string)
 * @param config - The node's config, e.g. `{ timeout_seconds: 180 }` (Record<string, unknown>)
 * @returns The node outputs; graphrt-plugins nodes put their result in `outputs.data` (PluginActionResult)
 * @throws BackendError - when the plugin is not installed or trusted, or the action fails
 *
 * @example
 * const result = await runPluginAction('whatsapp-web', 'whatsapp-web.get_status', {})
 */
export function runPluginAction(name: string, kind: string, config: Record<string, unknown> = {}): Promise<PluginActionResult> {
  if (!isDesktopApp()) return samplePluginsBackend.runPluginAction(name, kind, config)
  return callBackend('run_plugin_action', { name, kind, config })
}

/**
 * Asks a session plugin (whatsapp-web) whether its account is linked. The backend stores
 * the answer, so the requirements' `sessionLinked` follows it on the next load.
 *
 * @param name - Plugin name, e.g. "whatsapp-web" (string)
 * @returns The session state (PluginSessionState)
 * @throws BackendError - `invalid_input` for a plugin without a session; the action's errors otherwise
 *
 * @example
 * const sessionState = await checkPluginSession('whatsapp-web') // "linked"
 */
export function checkPluginSession(name: string): Promise<PluginSessionState> {
  if (!isDesktopApp()) return samplePluginsBackend.checkPluginSession(name)
  return callBackend('check_plugin_session', { name })
}

/**
 * Opens a plugin's README in the default browser. The desktop app looks the link up
 * itself (installed copy or catalog), so only catalog links can be opened.
 *
 * @throws BackendError - `not_found` when the plugin has no README link
 */
export function openPluginReadme(name: string): Promise<void> {
  if (!isDesktopApp()) return samplePluginsBackend.openPluginReadme(name)
  return callBackend('open_plugin_readme', { name })
}

/**
 * A plugin's icon as a `data:image/svg+xml;base64,...` URL, downloaded once by the desktop
 * app and cached on disk (works offline afterwards). Render it only with `<img>`, where
 * SVG scripts never run.
 *
 * @param name - Plugin name, e.g. "whatsapp-web" (string)
 * @returns The data URL, or null when the plugin has no icon or it could not be fetched (string | null)
 * @throws BackendError - `invalid_input` for an invalid plugin name
 *
 * @example
 * const iconDataUrl = await getPluginIcon('whatsapp-web')
 */
export function getPluginIcon(name: string): Promise<string | null> {
  if (!isDesktopApp()) return samplePluginsBackend.getPluginIcon(name)
  return callBackend('get_plugin_icon', { name })
}

/** Subscribes to `plugin-event` (install progress, load errors, list changes). Resolves to the unsubscribe function. */
export function listenToPluginEvents(onEvent: (pluginEvent: PluginEvent) => void): Promise<() => void> {
  if (!isDesktopApp()) return Promise.resolve(subscribeToSamplePluginEvents(onEvent))
  return listenToBackend<PluginEvent>(PLUGIN_EVENT_NAME, onEvent)
}

/** Subscribes to browser runtime install progress (`node-runtime-event`). Resolves to the unsubscribe function. */
export function listenToBrowserRuntimeEvents(onEvent: (runtimeEvent: BrowserRuntimeEvent) => void): Promise<() => void> {
  if (!isDesktopApp()) return Promise.resolve(subscribeToSampleBrowserRuntimeEvents(onEvent))
  return listenToBackend<BrowserRuntimeEvent>(BROWSER_RUNTIME_EVENT_NAME, onEvent)
}

/** Reads `outputs.data` of a plugin action, or an empty object when the node returned none. */
export function readPluginActionData(result: PluginActionResult): Record<string, unknown> {
  const actionData = result.outputs.data
  return actionData && typeof actionData === 'object' ? (actionData as Record<string, unknown>) : {}
}

/**
 * The plugins an agent's current workflow uses, with what is still missing (install, trust,
 * settings, browser). Empty when the workflow uses no plugin steps.
 */
export function listAgentPluginRequirements(agentId: string): Promise<PluginRequirement[]> {
  if (!isDesktopApp()) return samplePluginsBackend.listAgentPluginRequirements(agentId)
  return callBackend('list_agent_plugin_requirements', { agentId })
}
