import type { InstalledPlugin, PluginCatalog, PluginNodeInfo, PluginPermissions } from '@/api/pluginTypes'
import type { PluginInstallProgress } from '@/hooks/usePlugins'

/** One plugin card on Connections → Plugins: catalog data merged with the installed copy. */
export interface PluginListItem {
  name: string
  description: string
  /** Catalog version, or the installed one when the catalog does not list the plugin. */
  version: string
  permissions: PluginPermissions
  needsBrowser: boolean
  nodes: PluginNodeInfo[]
  installed: InstalledPlugin | null
  updateAvailable: boolean
}

function fromInstalledPlugin(installedPlugin: InstalledPlugin): PluginListItem {
  const { name, description, version, permissions, needsBrowser, nodes } = installedPlugin
  return { name, description, version, permissions, needsBrowser, nodes, installed: installedPlugin, updateAvailable: false }
}

/**
 * Merges the catalog with installed plugins: installed ones first, then the rest of the
 * catalog. Installed plugins the catalog does not list (offline, removed from it) still show.
 *
 * @param catalog - From `listPluginCatalog`, or null when it could not be loaded (PluginCatalog | null)
 * @param installedPlugins - From `listInstalledPlugins` (InstalledPlugin[])
 * @returns Cards in display order (PluginListItem[])
 */
export function buildPluginListItems(catalog: PluginCatalog | null, installedPlugins: InstalledPlugin[]): PluginListItem[] {
  const installedByName = new Map(installedPlugins.map((installedPlugin) => [installedPlugin.name, installedPlugin]))
  const catalogItems: PluginListItem[] = (catalog?.plugins ?? []).map((entry) => ({
    name: entry.name,
    description: entry.description,
    version: entry.version,
    permissions: entry.permissions,
    needsBrowser: entry.needsBrowser,
    nodes: entry.nodes,
    installed: installedByName.get(entry.name) ?? null,
    updateAvailable: entry.updateAvailable,
  }))
  const catalogNames = new Set(catalogItems.map((item) => item.name))
  const installedOnlyItems = installedPlugins.filter((installedPlugin) => !catalogNames.has(installedPlugin.name)).map(fromInstalledPlugin)
  const allItems = [...catalogItems, ...installedOnlyItems]
  return [...allItems.filter((item) => item.installed), ...allItems.filter((item) => !item.installed)]
}

/** Plain-language lines for what a plugin asks for, shown before it is installed. */
export function describePluginPermissions(permissions: PluginPermissions, needsBrowser: boolean): string[] {
  const lines = [permissions.network ? 'Connects to the internet' : 'Works without the internet']
  if (permissions.secrets) lines.push('Receives secret values in plain text (only once you trust it)')
  if (permissions.env.length > 0) lines.push(`Reads these settings: ${permissions.env.join(', ')}`)
  if (needsBrowser) lines.push('Needs the browser runtime (Chromium) on this computer')
  return lines
}

/**
 * Short chip labels for a plugin row, e.g. ["Internet", "Secrets", "2 settings", "Browser"].
 * The full plain-language list lives in the plugin's details.
 */
export function describePermissionChips(permissions: PluginPermissions, needsBrowser: boolean): string[] {
  const chips: string[] = []
  if (permissions.network) chips.push('Internet')
  if (permissions.secrets) chips.push('Secrets')
  if (permissions.env.length > 0) chips.push(permissions.env.length === 1 ? '1 setting' : `${permissions.env.length} settings`)
  if (needsBrowser) chips.push('Browser')
  return chips
}

/** e.g. "Adds 1 step", "Adds 14 steps". */
export function describeStepCount(stepCount: number): string {
  return stepCount === 1 ? 'Adds 1 step' : `Adds ${stepCount} steps`
}

/**
 * Keeps plugins whose name or description contains the search text (case-insensitive).
 *
 * @param items - Plugins in display order (PluginListItem[])
 * @param searchText - What the person typed; blank keeps everything (string)
 * @returns The matching plugins, order unchanged (PluginListItem[])
 */
export function filterPluginListItems(items: PluginListItem[], searchText: string): PluginListItem[] {
  const needle = searchText.trim().toLowerCase()
  if (needle === '') return items
  return items.filter((item) => item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle))
}

const installStageLabels: Record<PluginInstallProgress['stage'], string> = {
  downloading: 'Downloading',
  verifying: 'Checking the download',
  extracting: 'Unpacking',
  loading: 'Loading',
  done: 'Installed',
  failed: 'Install failed',
}

/** e.g. "Downloading · 40%" or the backend's message. */
export function describeInstallProgress(progress: PluginInstallProgress): string {
  const stageLabel = installStageLabels[progress.stage]
  if (progress.message) return `${stageLabel} · ${progress.message}`
  if (progress.stage === 'downloading' && progress.percent !== null) return `${stageLabel} · ${progress.percent}%`
  return `${stageLabel}…`
}

/** Settings the plugin requests that have no value yet. */
export function listMissingSettings(installedPlugin: InstalledPlugin): string[] {
  return installedPlugin.config.filter((setting) => !setting.configured).map((setting) => setting.name)
}

/**
 * Whether a plugin's steps can run: it loaded, and it is trusted when it asks for
 * settings or secrets (untrusted plugins never receive them). Manifests do not say
 * which settings are required (many are optional, e.g. `WHATSAPP_GRAPH_VERSION`), so
 * unset settings are shown as a hint but do not block.
 */
export function isPluginReady(installedPlugin: InstalledPlugin): boolean {
  if (installedPlugin.loadError !== null) return false
  const needsGrants = installedPlugin.permissions.secrets || installedPlugin.permissions.env.length > 0
  return installedPlugin.trusted || !needsGrants
}

/**
 * Whether an installed plugin's details should open on their own: it failed to load,
 * still needs trusting before its steps can run, has a required setting with no value,
 * or has warnings to read.
 */
export function pluginNeedsAttention(installedPlugin: InstalledPlugin): boolean {
  const isRequiredSettingMissing = installedPlugin.config.some((setting) => !setting.optional && !setting.configured)
  return !isPluginReady(installedPlugin) || isRequiredSettingMissing || installedPlugin.warnings.length > 0
}
