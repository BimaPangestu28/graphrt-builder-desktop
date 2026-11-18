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
