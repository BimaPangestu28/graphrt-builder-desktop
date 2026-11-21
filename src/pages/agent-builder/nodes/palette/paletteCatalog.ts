import type { AgentGraph, NodeKindGroup, NodeKindInfo } from '@/api/agentGraphTypes'
import type { PluginCatalogEntry } from '@/api/pluginTypes'

/**
 * The palette's model of the node library: built-in kinds by group, installed plugins
 * (most used actions first) and catalog plugins that install after approval. Pure, so
 * grouping, ordering and exclusions are tested without rendering.
 */

/** Kinds graphrt has but the palette never offers, even if a library lists them as offered. */
export const excludedPaletteKinds: ReadonlySet<string> = new Set(['code', 'document-extractor', 'system-one', 'iteration-start', 'loop-start', 'variable-assigner'])

/** One thing the palette can add: a built-in kind or a plugin action. */
export interface PaletteAction {
  kind: string
  displayName: string
  description: string
  group: NodeKindGroup
  plugin: { name: string; displayName: string; installed: boolean } | null
  /** The library entry; null for a catalog action the library does not list yet (offline library). */
  kindInfo: NodeKindInfo | null
}

export interface PaletteBuiltinGroup {
  group: NodeKindGroup
  label: string
  actions: PaletteAction[]
}

export interface PalettePlugin {
  name: string
  displayName: string
  installed: boolean
  /** Catalog order, or most used first (installed plugins with usage). */
  actions: PaletteAction[]
  /** Uses across your agents' current versions, summed over its actions. */
  usageCount: number
}

export interface PaletteLibrary {
  builtinGroups: PaletteBuiltinGroup[]
  installedPlugins: PalettePlugin[]
  catalogPlugins: PalettePlugin[]
  /** Every offered action in palette order (built-in, installed, catalog). */
  allActions: PaletteAction[]
}

/** Library group labels (spec N1 / artboard 46) in library order, Start and finish last (rarely added). */
export const builtinGroupLabels: Array<[NodeKindGroup, string]> = [
  ['ai', 'AI'],
  ['connect', 'Connect'],
  ['decide-and-wait', 'Decide and wait'],
  ['repeat', 'Repeat'],
  ['data', 'Data'],
  ['start-and-finish', 'Start and finish'],
  ['other', 'Other'],
]

/** True when the palette may offer this kind in this graph. */
export function isOfferedKind(kindInfo: NodeKindInfo, graph: Pick<AgentGraph, 'nodes'>): boolean {
  if (!kindInfo.offered || kindInfo.group === 'hidden' || excludedPaletteKinds.has(kindInfo.kind)) return false
  // A run has one Start: once the agent has it, it is not offered again.
  if (kindInfo.kind === 'start' && graph.nodes.some((node) => node.kind === 'start')) return false
  return true
}

function toPaletteAction(kindInfo: NodeKindInfo): PaletteAction {
  return {
    kind: kindInfo.kind,
    displayName: kindInfo.displayName,
    description: kindInfo.description,
    group: kindInfo.group,
    plugin: kindInfo.plugin ? { name: kindInfo.plugin.name, displayName: kindInfo.plugin.displayName, installed: kindInfo.plugin.installed } : null,
    kindInfo,
  }
}

/** Catalog actions the library does not list (it may lag the catalog), as not-installed actions. */
function catalogOnlyActions(catalogEntries: PluginCatalogEntry[], knownKinds: Set<string>, installedNames: Set<string>): PaletteAction[] {
  return catalogEntries
    .filter((entry) => !installedNames.has(entry.name) && entry.installedVersion === null)
    .flatMap((entry) =>
      entry.nodes
        .filter((nodeInfo) => !knownKinds.has(nodeInfo.kind) && !excludedPaletteKinds.has(nodeInfo.kind))
        .map((nodeInfo) => ({
          kind: nodeInfo.kind,
          displayName: nodeInfo.title,
          description: nodeInfo.description,
          group: 'plugin' as const,
          plugin: { name: entry.name, displayName: entry.displayName, installed: false },
          kindInfo: null,
        })),
    )
}

function groupByPlugin(actions: PaletteAction[], usageByKind: Record<string, number>): PalettePlugin[] {
  const pluginsByName = new Map<string, PalettePlugin>()
  for (const action of actions) {
    if (!action.plugin) continue
    const existing = pluginsByName.get(action.plugin.name)
    const usage = usageByKind[action.kind] ?? 0
    if (existing) {
      existing.actions.push(action)
      existing.usageCount += usage
    } else {
      pluginsByName.set(action.plugin.name, { ...action.plugin, actions: [action], usageCount: usage })
    }
  }
  return [...pluginsByName.values()]
}

/** Most used first; ties keep catalog order (stable sort). */
function sortByUsage<Item>(items: Item[], usageOf: (item: Item) => number): Item[] {
  return [...items].sort((first, second) => usageOf(second) - usageOf(first))
}

/**
 * Builds the palette's sections from the node library.
 *
 * @param nodeKinds - `get_node_kinds` (NodeKindInfo[])
 * @param options.graph - The working copy (Start is not offered twice)
 * @param options.usageByKind - Uses of each kind across your agents (from {@link countKindUsage})
 * @param options.catalogEntries - Plugin catalog, for catalog actions the library lacks
 * @param options.installedPluginNames - Plugins installed since the library was loaded
 * @returns Built-in groups, installed and catalog plugins (PaletteLibrary)
 */
export function buildPaletteLibrary(
  nodeKinds: NodeKindInfo[],
  options: { graph: Pick<AgentGraph, 'nodes'>; usageByKind?: Record<string, number>; catalogEntries?: PluginCatalogEntry[]; installedPluginNames?: ReadonlySet<string> },
): PaletteLibrary {
  const usageByKind = options.usageByKind ?? {}
  const installedNames = new Set(options.installedPluginNames ?? [])
  const offered = nodeKinds.filter((kindInfo) => isOfferedKind(kindInfo, options.graph)).map(toPaletteAction)
  for (const action of offered) {
    if (action.plugin && installedNames.has(action.plugin.name)) action.plugin.installed = true
  }
  const knownKinds = new Set(nodeKinds.map((kindInfo) => kindInfo.kind))
  // The library is the truth for plugins it knows as installed: their unlisted kinds stay unlisted.
  const libraryInstalledNames = new Set(nodeKinds.flatMap((kindInfo) => (kindInfo.plugin?.installed ? [kindInfo.plugin.name] : [])))
  const pluginActions = [
    ...offered.filter((action) => action.plugin),
    ...catalogOnlyActions(options.catalogEntries ?? [], knownKinds, new Set([...installedNames, ...libraryInstalledNames])),
  ]

  const builtinGroups = builtinGroupLabels
    .map(([group, label]) => ({ group, label, actions: offered.filter((action) => !action.plugin && action.group === group) }))
    .filter((builtinGroup) => builtinGroup.actions.length > 0)
  const installedPlugins = sortByUsage(
    groupByPlugin(pluginActions.filter((action) => action.plugin?.installed), usageByKind).map((plugin) => ({
      ...plugin,
      actions: sortByUsage(plugin.actions, (action) => usageByKind[action.kind] ?? 0),
    })),
    (plugin) => plugin.usageCount,
  )
  const catalogPlugins = groupByPlugin(pluginActions.filter((action) => !action.plugin?.installed), usageByKind)
  return {
    builtinGroups,
    installedPlugins,
    catalogPlugins,
    allActions: [...builtinGroups.flatMap((builtinGroup) => builtinGroup.actions), ...installedPlugins.flatMap((plugin) => plugin.actions), ...catalogPlugins.flatMap((plugin) => plugin.actions)],
  }
}

/** `type: whatsapp-web.send_message` lines of a flow YAML (plugin kinds always have a dot). */
const pluginKindPattern = /^\s*-?\s*type:\s*["']?([a-z0-9_-]+\.[a-z0-9_.-]+)["']?\s*$/gim

/**
 * Counts plugin actions across agents' flow YAML, for "most used" ordering. Cheap: a line
 * scan, no YAML parse.
 *
 * @param flowYamls - Each agent's current version (string[])
 * @returns Uses per plugin kind (Record<string, number>)
 *
 * @example
 * countKindUsage(['nodes:\n  - id: send\n    type: whatsapp-web.send_message\n']) // { 'whatsapp-web.send_message': 1 }
 */
export function countKindUsage(flowYamls: string[]): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const flowYaml of flowYamls) {
    for (const match of flowYaml.matchAll(pluginKindPattern)) usage[match[1]] = (usage[match[1]] ?? 0) + 1
  }
  return usage
}
