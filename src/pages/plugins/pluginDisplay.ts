import type { BadgeTone } from '@/components/ui'
import type { InstalledPlugin, McpServerSummary, NewerAppNeeded, PluginCatalog, PluginMaturity, PluginNodeInfo, PluginPermissions, PluginSource, PluginTosRisk } from '@/api/pluginTypes'
import type { PluginInstallProgress } from '@/hooks/usePlugins'
import { pluginDisplayName } from '@/lib/pluginDisplayName'
import { categorizePlugin, type PluginCategory } from './pluginCategories'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** One plugin on the Plugins page: catalog data merged with the installed copy. */
export interface PluginListItem {
  /** Technical name: the identifier for install calls, routes and icons. */
  name: string
  /** What people see, e.g. "WhatsApp Cloud API". */
  displayName: string
  description: string
  /** Catalog version, or the installed one when the catalog does not list the plugin. */
  version: string
  permissions: PluginPermissions
  needsBrowser: boolean
  nodes: PluginNodeInfo[]
  installed: InstalledPlugin | null
  updateAvailable: boolean
  /** The update asks for more permissions: never automatic, and it needs the plugin trusted again. */
  updateNeedsApproval: boolean
  category: PluginCategory
  readmeUrl: string | null
  /** The catalog's icon link (or the installed copy's), or null when the plugin has none. */
  iconUrl: string | null
  /** Terms-of-service / ban warning from the catalog, or null. */
  warning: string | null
  maturity: PluginMaturity | null
  tosRisk: PluginTosRisk | null
  /** `official`, `community` (reviewed by the graphrt maintainers) or `local` (not reviewed). */
  source: PluginSource
  /** Who maintains it, when known. */
  publisher: string | null
  repositoryUrl: string | null
  /** For a `local` plugin: the folder or archive it was installed from. */
  localPath: string | null
  /** An MCP preset plugin: the server it adds to Connections > MCP servers. */
  mcpServer?: McpServerSummary | null
  /** The catalog's version needs a newer app: no install, and no update to that version, until the app is updated. */
  needsNewerApp?: NewerAppNeeded | null
}

function fromInstalledPlugin(installedPlugin: InstalledPlugin): PluginListItem {
  const { name, description, version, permissions, needsBrowser, nodes, readmeUrl, iconUrl, source, publisher, repositoryUrl, localPath } = installedPlugin
  return {
    name,
    displayName: pluginDisplayName(installedPlugin),
    description,
    version,
    permissions,
    needsBrowser,
    nodes,
    installed: installedPlugin,
    updateAvailable: false,
    updateNeedsApproval: false,
    category: categorizePlugin(name, description),
    readmeUrl,
    iconUrl,
    warning: null,
    maturity: null,
    tosRisk: null,
    source,
    publisher,
    repositoryUrl,
    localPath,
    mcpServer: installedPlugin.mcpServer ?? null,
  }
}

/**
 * Merges the catalog with installed plugins: installed ones first, then the rest of the
 * catalog. Installed plugins the catalog does not list (offline, removed from it) still show.
 * A plugin installed from this computer (`local`) replaces a catalog entry of the same name:
 * it is a different plugin, never updated from the catalog.
 *
 * @param catalog - From `listPluginCatalog`, or null when it could not be loaded (PluginCatalog | null)
 * @param installedPlugins - From `listInstalledPlugins` (InstalledPlugin[])
 * @returns Cards in display order (PluginListItem[])
 */
export function buildPluginListItems(catalog: PluginCatalog | null, installedPlugins: InstalledPlugin[]): PluginListItem[] {
  const installedByName = new Map(installedPlugins.map((installedPlugin) => [installedPlugin.name, installedPlugin]))
  const localNames = new Set(installedPlugins.filter((installedPlugin) => installedPlugin.source === 'local').map((installedPlugin) => installedPlugin.name))
  const catalogEntries = (catalog?.plugins ?? []).filter((entry) => !localNames.has(entry.name))
  const catalogItems: PluginListItem[] = catalogEntries.map((entry) => ({
    name: entry.name,
    displayName: pluginDisplayName(entry),
    description: entry.description,
    version: entry.version,
    permissions: entry.permissions,
    needsBrowser: entry.needsBrowser,
    nodes: entry.nodes,
    installed: installedByName.get(entry.name) ?? null,
    updateAvailable: entry.updateAvailable,
    updateNeedsApproval: entry.updateNeedsApproval,
    category: categorizePlugin(entry.name, entry.description),
    readmeUrl: entry.readmeUrl ?? installedByName.get(entry.name)?.readmeUrl ?? null,
    iconUrl: entry.iconUrl ?? installedByName.get(entry.name)?.iconUrl ?? null,
    warning: entry.warning?.trim() ? entry.warning : null,
    maturity: entry.status ?? null,
    tosRisk: entry.tosRisk ?? null,
    source: entry.source ?? 'official',
    publisher: entry.publisher ?? installedByName.get(entry.name)?.publisher ?? null,
    repositoryUrl: entry.repositoryUrl ?? installedByName.get(entry.name)?.repositoryUrl ?? null,
    localPath: null,
    mcpServer: entry.mcpServer ?? installedByName.get(entry.name)?.mcpServer ?? null,
    needsNewerApp: entry.needsNewerApp ?? null,
  }))
  const catalogNames = new Set(catalogItems.map((item) => item.name))
  const installedOnlyItems = installedPlugins.filter((installedPlugin) => !catalogNames.has(installedPlugin.name)).map(fromInstalledPlugin)
  const allItems = [...catalogItems, ...installedOnlyItems]
  return [...allItems.filter((item) => item.installed), ...allItems.filter((item) => !item.installed)]
}

/** Plain-language lines for what a plugin asks for, shown before it is installed. */
export function describePluginPermissions(permissions: PluginPermissions, needsBrowser: boolean): string[] {
  const t = messages().plugins
  const lines = [permissions.network ? t.connectsInternet : t.worksOffline]
  if (permissions.secrets) lines.push(t.receivesSecrets)
  if (permissions.env.length > 0) lines.push(t.readsSettingsList(permissions.env.join(', ')))
  if (needsBrowser) lines.push(t.needsBrowser)
  return lines
}

/**
 * Short chip labels for a plugin row, e.g. ["Internet", "Secrets", "2 settings", "Browser"].
 * The full plain-language list lives in the plugin's details.
 */
export function describePermissionChips(permissions: PluginPermissions, needsBrowser: boolean): string[] {
  const t = messages().plugins
  const chips: string[] = []
  if (permissions.network) chips.push(t.chipInternet)
  if (permissions.secrets) chips.push(t.chipSecrets)
  if (permissions.env.length > 0) chips.push(t.chipSettings(permissions.env.length))
  if (needsBrowser) chips.push(t.chipBrowser)
  return chips
}

/** e.g. "Adds 1 step", "Adds 14 steps". */
export function describeStepCount(stepCount: number): string {
  return messages().plugins.addsSteps(stepCount)
}

/**
 * Keeps plugins whose display name, technical name, description or step titles contain the search text (case-insensitive).
 *
 * @param items - Plugins in display order (PluginListItem[])
 * @param searchText - What the person typed; blank keeps everything (string)
 * @returns The matching plugins, order unchanged (PluginListItem[])
 */
export function filterPluginListItems(items: PluginListItem[], searchText: string): PluginListItem[] {
  const needle = searchText.trim().toLowerCase()
  if (needle === '') return items
  return items.filter((item) => [item.displayName, item.name, item.description, ...item.nodes.map((node) => node.title)].some((text) => text.toLowerCase().includes(needle)))
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
  const t = messages().plugins
  if (!installed) return { label: t.statusNotInstalled, tone: 'neutral' }
  if (installed.loadError) return { label: t.statusFailedToLoad, tone: 'danger' }
  if (item.updateAvailable) return { label: t.statusUpdateAvailable, tone: 'brand' }
  if (pluginNeedsAttention(installed)) return { label: t.statusNeedsSetup, tone: 'amber' }
  return { label: t.statusInstalled(installed.version), tone: 'ok' }
}

/**
 * The source badge of a plugin: nothing for official plugins (the default needs no label),
 * "Community" for third-party plugins the maintainers reviewed, "Local · not reviewed" for
 * plugins installed from this computer.
 *
 * @param source - Where the plugin comes from (PluginSource)
 * @returns The badge label and tone, or null for none ({ label: string; tone: BadgeTone } | null)
 */
export function describePluginSource(source: PluginSource): { label: string; tone: BadgeTone } | null {
  if (source === 'community') return { label: messages().plugins.badgeCommunity, tone: 'brand' }
  if (source === 'local') return { label: messages().plugins.badgeLocal, tone: 'amber' }
  return null
}

/** Shown wherever a plugin can be installed: installing runs third-party code on this computer. */
export function pluginInstallTrustNote(): string {
  return messages().plugins.installTrustNote
}

/**
 * The sentence the install confirmation adds for a community plugin, or null for others.
 * e.g. "Reviewed by the graphrt maintainers, but maintained by Acme Inc."
 */
export function describeCommunityInstallNote(item: Pick<PluginListItem, 'source' | 'publisher'>): string | null {
  if (item.source !== 'community') return null
  return messages().plugins.communityNote(item.publisher ?? messages().plugins.aThirdParty)
}

const maturityLabels: Readonly<Record<PluginMaturity, string>> = localizedRecord(() => messages().plugins.maturityLabels)

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

const installStageLabels: Readonly<Record<PluginInstallProgress['stage'], string>> = localizedRecord(() => messages().plugins.installStages)

/** e.g. "Downloading · 40%" or the backend's message. */
export function describeInstallProgress(progress: PluginInstallProgress): string {
  const stageLabel = installStageLabels[progress.stage]
  if (progress.message) return `${stageLabel} · ${progress.message}`
  if (progress.stage === 'downloading' && progress.percent !== null) return `${stageLabel} · ${progress.percent}%`
  return `${stageLabel}…`
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
