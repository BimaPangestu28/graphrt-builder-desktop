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
  type PluginPermissions,
  type PluginRuntimeInfo,
} from './pluginTypes'
import type { PluginRequirement, PluginSessionState } from './pluginRequirementTypes'
import { samplePluginsBackend, subscribeToSampleBrowserRuntimeEvents, subscribeToSamplePluginEvents } from './sampleBackend/plugins'
import { messages } from '@/i18n'

/**
 * graphrt plugins: the online catalog, installed plugins with their trust and settings,
 * the plugin runtime (Node.js) every plugin runs on and the browser runtime some plugins
 * need, and one-off plugin actions (e.g. linking
 * WhatsApp). Outside the desktop app every call goes to the sample plugins backend.
 */

/**
 * The plugin catalog merged with this computer's install state.
 *
 * @param refresh - Fetch the catalog again instead of using the saved copy (boolean)
 */
export function listPluginCatalog(refresh = false): Promise<PluginCatalog> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.listPluginCatalog(refresh)
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.listPluginCatalogSteps(name)
  return callBackend('list_plugin_catalog_steps', { name })
}

export function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.listInstalledPlugins()
  return callBackend('list_installed_plugins')
}

/**
 * Downloads, verifies and loads a catalog plugin. Progress arrives as `install_progress`
 * events (see {@link listenToPluginEvents}). New plugins start untrusted.
 *
 * @param name - Plugin name, e.g. "whatsapp-api" (string)
 * @param approvedPermissions - What the screen showed next to the Install button and the user
 *   approved; a downloaded plugin asking for more is refused and nothing is installed (PluginPermissions)
 * @throws BackendError - e.g. `not_found` for an unknown plugin, `invalid_input` when installed
 *   already or when the plugin asks for more than `approvedPermissions`
 */
export function installPlugin(name: string, approvedPermissions: PluginPermissions): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.installPlugin(name, approvedPermissions)
  return callBackend('install_plugin', { name, permissions: approvedPermissions })
}

/** What to pick for {@link pickLocalPluginPath}: a plugin folder or a `.tar.gz` archive. */
export type LocalPluginPickKind = 'folder' | 'archive'

/**
 * Opens the system picker for a plugin folder or `.tar.gz` archive (Developer mode). The
 * browser preview has no picker and answers with a sample path.
 *
 * @param kind - Pick a folder or an archive (LocalPluginPickKind)
 * @returns The absolute path, or null when the picker was closed (string | null)
 */
export async function pickLocalPluginPath(kind: LocalPluginPickKind): Promise<string | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.pickLocalPluginPath(kind)
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked =
    kind === 'folder'
      ? await open({ title: messages().lib.chooseAPluginFolder, directory: true, multiple: false })
      : await open({ title: messages().lib.chooseAPluginArchive, multiple: false, filters: [{ name: messages().lib.pluginArchiveFilter, extensions: ['gz', 'tgz'] }] })
  return typeof picked === 'string' ? picked : null
}

/**
 * Installs a plugin from a folder or `.tar.gz` on this computer (Developer mode only). It is
 * checked like a catalog plugin, starts untrusted, is labelled "Local · not reviewed" and is
 * never updated from the catalog.
 *
 * @param path - Absolute path from {@link pickLocalPluginPath} (string)
 * @param replace - The user agreed to replace a plugin of the same name installed from the catalog (boolean)
 * @returns The installed plugin (InstalledPlugin)
 * @throws BackendError - `conflict` when a catalog plugin of that name is installed and `replace` is false;
 *   `invalid_input` for unsafe or invalid plugins or while Developer mode is off
 *
 * @example
 * const installedPlugin = await installLocalPlugin('/Users/me/code/my-plugin')
 */
export function installLocalPlugin(path: string, replace = false): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.installLocalPlugin(path, replace)
  return callBackend('install_local_plugin', { path, replace })
}

/** Installs the catalog version over the installed one (when `updateAvailable`). */
export function updatePlugin(name: string): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.updatePlugin(name)
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.updateAllPlugins()
  return callBackend('update_all_plugins')
}

/** Plugins graphrt updated by itself, newest first (at most 20). */
export function listPluginAutoUpdates(): Promise<PluginAutoUpdate[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.listPluginAutoUpdates()
  return callBackend('list_plugin_auto_updates')
}

export function removePlugin(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.removePlugin(name)
  return callBackend('remove_plugin', { name })
}

/**
 * Trusted plugins receive their settings and plaintext secrets and may run actions.
 *
 * @param name - Plugin name (string)
 * @param trusted - Trust (true) or stop trusting (false) (boolean)
 * @param approvedPermissions - What the screen showed next to the trust control; required to
 *   trust, ignored when untrusting (PluginPermissions | null)
 * @throws BackendError - `invalid_input` when trusting without `approvedPermissions` or when the
 *   installed plugin asks for more than them (it stays untrusted)
 */
export function setPluginTrusted(name: string, trusted: boolean, approvedPermissions: PluginPermissions | null): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.setPluginTrusted(name, trusted, approvedPermissions ?? undefined)
  return callBackend('set_plugin_trusted', { name, trusted, permissions: approvedPermissions })
}

/**
 * Saves a setting the plugin requests (e.g. `WHATSAPP_ACCESS_TOKEN`) in the OS keychain.
 * The value is never read back; the returned plugin only says it is `configured`.
 */
export function setPluginConfig(name: string, variable: string, value: string): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.setPluginConfig(name, variable, value)
  return callBackend('set_plugin_config', { name, variable, value })
}

export function deletePluginConfig(name: string, variable: string): Promise<InstalledPlugin> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.deletePluginConfig(name, variable)
  return callBackend('delete_plugin_config', { name, variable })
}

export function getBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.getBrowserRuntimeStatus()
  return callBackend('browser_runtime_status')
}

/** Installs Chromium for browser plugins. Progress arrives through {@link listenToBrowserRuntimeEvents}. */
export function installBrowserRuntime(): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.installBrowserRuntime()
  return callBackend('install_browser_runtime')
}

/** The plugin runtime (Node.js) and browser runtime status, version and location. */
export function getPluginRuntimeInfo(): Promise<PluginRuntimeInfo> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.getPluginRuntimeInfo()
  return callBackend('node_runtime_info')
}

/**
 * Downloads the plugin runtime (the pinned Node.js release, about 30 MB) from nodejs.org,
 * checks it against the checksum built into the app and installs it. Call it only for an
 * explicit user action (an Install button, or installing a plugin with the download shown).
 * Progress arrives through {@link listenToBrowserRuntimeEvents} (`node_install_*` events).
 *
 * @throws BackendError - `internal` when offline or the download fails; `invalid_input` for a checksum mismatch
 */
export function installPluginRuntime(): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.installPluginRuntime()
  return callBackend('install_node_runtime')
}

/**
 * Removes the downloaded plugin runtime. Plugins stop working until it is installed again.
 *
 * @returns Whether anything was removed (boolean)
 */
export function removePluginRuntime(): Promise<boolean> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.removePluginRuntime()
  return callBackend('remove_node_runtime')
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.runPluginAction(name, kind, config)
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.checkPluginSession(name)
  return callBackend('check_plugin_session', { name })
}

/**
 * Opens a plugin's README in the default browser. The desktop app looks the link up
 * itself (installed copy or catalog), so only catalog links can be opened.
 *
 * @throws BackendError - `not_found` when the plugin has no README link
 */
export function openPluginReadme(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.openPluginReadme(name)
  return callBackend('open_plugin_readme', { name })
}

/**
 * Opens a plugin's source repository in the default browser (the link comes from the
 * catalog, kept at install time).
 *
 * @throws BackendError - `not_found` when the plugin has no repository link
 */
export function openPluginRepository(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.openPluginRepository(name)
  return callBackend('open_plugin_repository', { name })
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.getPluginIcon(name)
  return callBackend('get_plugin_icon', { name })
}

/** Subscribes to `plugin-event` (install progress, load errors, list changes). Resolves to the unsubscribe function. */
export function listenToPluginEvents(onEvent: (pluginEvent: PluginEvent) => void): Promise<() => void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return Promise.resolve(subscribeToSamplePluginEvents(onEvent))
  return listenToBackend<PluginEvent>(PLUGIN_EVENT_NAME, onEvent)
}

/** Subscribes to plugin and browser runtime install progress (`node-runtime-event`). Resolves to the unsubscribe function. */
export function listenToBrowserRuntimeEvents(onEvent: (runtimeEvent: BrowserRuntimeEvent) => void): Promise<() => void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return Promise.resolve(subscribeToSampleBrowserRuntimeEvents(onEvent))
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePluginsBackend.listAgentPluginRequirements(agentId)
  return callBackend('list_agent_plugin_requirements', { agentId })
}
