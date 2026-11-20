import type { BadgeTone } from '@/components/ui'
import type { InstalledPlugin, PluginCatalog, PluginMaturity, PluginNodeInfo, PluginPermissions, PluginTosRisk } from '@/api/pluginTypes'
import type { PluginInstallProgress } from '@/hooks/usePlugins'
import { categorizePlugin, type PluginCategory } from './pluginCategories'

/** One plugin on the Plugins page: catalog data merged with the installed copy. */
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
  category: PluginCategory
  readmeUrl: string | null
  /** The catalog's icon link (or the installed copy's), or null when the plugin has none. */
  iconUrl: string | null
  /** Terms-of-service / ban warning from the catalog, or null. */
  warning: string | null
  maturity: PluginMaturity | null
  tosRisk: PluginTosRisk | null
}

function fromInstalledPlugin(installedPlugin: InstalledPlugin): PluginListItem {
  const { name, description, version, permissions, needsBrowser, nodes, readmeUrl, iconUrl } = installedPlugin
  return {
    name,
    description,
    version,
    permissions,
    needsBrowser,
    nodes,
    installed: installedPlugin,
    updateAvailable: false,
    category: categorizePlugin(name, description),
    readmeUrl,
    iconUrl,
    warning: null,
    maturity: null,
    tosRisk: null,
  }
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
    category: categorizePlugin(entry.name, entry.description),
    readmeUrl: entry.readmeUrl ?? installedByName.get(entry.name)?.readmeUrl ?? null,
    iconUrl: entry.iconUrl ?? installedByName.get(entry.name)?.iconUrl ?? null,
    warning: entry.warning?.trim() ? entry.warning : null,
    maturity: entry.status ?? null,
    tosRisk: entry.tosRisk ?? null,
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
 * Keeps plugins whose name, description or step titles contain the search text (case-insensitive).
 *
 * @param items - Plugins in display order (PluginListItem[])
 * @param searchText - What the person typed; blank keeps everything (string)
 * @returns The matching plugins, order unchanged (PluginListItem[])
 */
export function filterPluginListItems(items: PluginListItem[], searchText: string): PluginListItem[] {
  const needle = searchText.trim().toLowerCase()
  if (needle === '') return items
  return items.filter((item) => [item.name, item.description, ...item.nodes.map((node) => node.title)].some((text) => text.toLowerCase().includes(needle)))
}

/** The tabs above the catalog. */
export type PluginFilter = 'all' | 'installed' | 'updates' | 'attention'

/** Whether an installed plugin should be looked at: it needs attention or failed to load. */
export function itemNeedsAttention(item: PluginListItem): boolean {
  return item.installed !== null && pluginNeedsAttention(item.installed)
}

const filterPredicates: Record<PluginFilter, (item: PluginListItem) => boolean> = {
  all: () => true,
  installed: (item) => item.installed !== null,
  updates: (item) => item.updateAvailable,
  attention: itemNeedsAttention,
}

/** Keeps the plugins of one tab, order unchanged. */
export function filterPluginsByTab(items: PluginListItem[], filter: PluginFilter): PluginListItem[] {
  return filter === 'all' ? items : items.filter(filterPredicates[filter])
}

/** How many plugins each tab holds. */
export function countPluginsByTab(items: PluginListItem[]): Record<PluginFilter, number> {
  return {
    all: items.length,
    installed: items.filter(filterPredicates.installed).length,
    updates: items.filter(filterPredicates.updates).length,
    attention: items.filter(filterPredicates.attention).length,
  }
}

/** The one status badge of a plugin card: what matters most first. */
export function describePluginStatus(item: PluginListItem): { label: string; tone: BadgeTone } {
  const { installed } = item
  if (!installed) return { label: 'Not installed', tone: 'neutral' }
  if (installed.loadError) return { label: 'Failed to load', tone: 'danger' }
  if (item.updateAvailable) return { label: 'Update available', tone: 'brand' }
  if (pluginNeedsAttention(installed)) return { label: 'Needs setup', tone: 'amber' }
  return { label: `Installed v${installed.version}`, tone: 'ok' }
}

const maturityLabels: Record<PluginMaturity, string> = { stable: 'Stable', beta: 'Beta', experimental: 'Experimental' }

/** e.g. "Beta", or null for stable or unlabelled plugins (nothing worth pointing out). */
export function describeMaturity(maturity: PluginMaturity | null): string | null {
  return maturity && maturity !== 'stable' ? maturityLabels[maturity] : null
}

/** Two-letter monogram for a plugin tile, e.g. "google-maps-scraper" → "GM", "stripe" → "ST". */
export function pluginMonogram(name: string): string {
  const words = name.split(/[-_\s]+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
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
 * Whether an installed plugin needs a look: it failed to load,
 * still needs trusting before its steps can run, has a required setting with no value,
 * or has warnings to read.
 */
export function pluginNeedsAttention(installedPlugin: InstalledPlugin): boolean {
  const isRequiredSettingMissing = installedPlugin.config.some((setting) => !setting.optional && !setting.configured)
  return !isPluginReady(installedPlugin) || isRequiredSettingMissing || installedPlugin.warnings.length > 0
}
