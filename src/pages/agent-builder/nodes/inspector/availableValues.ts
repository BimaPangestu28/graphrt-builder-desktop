import type { AgentGraph, GraphNode, NodeKindInfo } from '@/api/agentGraphTypes'
import { FAIL_BRANCH_HANDLE } from '@/lib/agentGraphRules'
import { readConfigList, readConfigValue, isJsonObject } from './configPaths'
import { describeReference, ENV_NAMESPACE, readSelector, SYSTEM_NAMESPACE } from './references'
import { messages } from '@/i18n'

/**
 * What the variable picker offers a step (spec board B6 "Variables"): Start inputs,
 * earlier steps in this scope or an enclosing one with their outputs, the loop's item
 * and index inside a loop, error_message / error_type after an "On error" port,
 * workflow env names (never values) and the run id. Steps inside another loop are not
 * offered: their values resolve to empty here.
 */

/** One value a step can insert. */
export interface ValueOption {
  /** Selector path, e.g. `['search_maps', 'results']`. */
  path: string[]
  /** What the row shows, e.g. `results`, `item › name`. */
  label: string
  /** Type hint in plain words: text, number, list, object, yes/no, secret… */
  typeHint: string
}

/** A heading of the picker with its values. */
export interface ValueGroup {
  id: string
  title: string
  /** Shown under the heading ("Only in steps after an “On error” port"). */
  note?: string
  options: ValueOption[]
}

/** Plain words for a graphrt value type (`array[object]` → list of objects). */
export function describeValueType(valueType: string | undefined): string {
  const type = (valueType ?? 'any').trim()
  if (type.startsWith('array[')) {
    const itemType = describeValueType(type.slice(6, -1))
    if (itemType === 'any') return 'list'
    return `list of ${itemType === 'yes/no' ? 'yes/no' : `${itemType}s`}`
  }
  const names: Record<string, string> = {
    string: 'text',
    'text-input': 'text',
    paragraph: 'paragraph',
    select: 'select',
    number: 'number',
    integer: 'number',
    float: 'number',
    boolean: 'yes/no',
    bool: 'yes/no',
    checkbox: 'yes/no',
    object: 'object',
    json: 'object',
    file: 'file',
    'file-list': messages().nodes.listOfFiles,
    array: 'list',
    secret: 'secret',
    any: 'any',
  }
  return names[type] ?? type
}

function option(path: string[], label: string, valueType: string | undefined): ValueOption {
  return { path, label, typeHint: describeValueType(valueType) }
}

/** The outputs one node exposes to later steps, from its kind and its config. */
export function listNodeOutputs(node: GraphNode, kindInfo: NodeKindInfo | undefined): ValueOption[] {
  const outputs = (kindInfo?.outputs ?? []).map((output) => option([node.id, output.name], output.name, output.valueType))
  const config = node.config
  const named = (items: unknown[], nameKeys: string[], typeKey: string | null) =>
    items.flatMap((item) => {
      if (!isJsonObject(item)) return []
      const name = nameKeys.map((key) => item[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '')
      const valueType = typeKey && typeof item[typeKey] === 'string' ? (item[typeKey] as string) : 'any'
      return name ? [option([node.id, name], name, valueType)] : []
    })
  switch (node.kind) {
    case 'start':
      return named(readConfigList(config, ['variables']), ['variable'], 'type')
    case 'parameter-extractor':
      return [...named(readConfigList(config, ['parameters']), ['name'], 'type'), ...outputs, option([node.id, '__reason'], '__reason', 'string')].filter(uniqueByPath())
    case 'loop':
      return [...outputs, ...named(readConfigList(config, ['loop_variables']), ['label'], 'var_type')]
    case 'human-input': {
      const fields = readConfigList(config, ['form', 'fields']).length > 0 ? readConfigList(config, ['form', 'fields']) : readConfigList(config, ['inputs'])
      return [...outputs, ...named(fields, ['name', 'variable'], 'type')]
    }
    case 'variable-aggregator':
    case 'variable-assigner': {
      if (readConfigValue(config, ['advanced_settings', 'group_enabled']) === true) {
        const groups = readConfigList(config, ['advanced_settings', 'groups'])
        return groups.flatMap((group) => (isJsonObject(group) && typeof group.group_name === 'string' && group.group_name ? [option([node.id, group.group_name, 'output'], messages().nodes.groupNameOutput(group.group_name), 'any')] : []))
      }
      return outputs.length > 0 ? outputs : [option([node.id, 'output'], 'output', 'any')]
    }
    case 'llm': {
      const properties = readConfigValue(config, ['structured_output', 'schema', 'properties'])
      const structuredFields = isJsonObject(properties)
        ? Object.entries(properties).map(([name, schema]) => option([node.id, 'structured_output', name], messages().nodes.structuredOutputName(name), isJsonObject(schema) && typeof schema.type === 'string' ? schema.type : 'any'))
        : []
      return [...outputs, ...structuredFields]
    }
    default:
      return outputs
  }
}

function uniqueByPath() {
  const seen = new Set<string>()
  return (valueOption: ValueOption) => {
    const key = valueOption.path.join('.')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

/** Ids of the steps before `nodeId` in its own scope (every step with an arrow path to it). */
export function listEarlierNodeIds(graph: AgentGraph, nodeId: string): string[] {
  const earlier: string[] = []
  const seen = new Set([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of graph.edges) {
      if (edge.target !== current || seen.has(edge.source)) continue
      seen.add(edge.source)
      earlier.push(edge.source)
      queue.push(edge.source)
    }
  }
  return earlier
}

/** Steps reached from `node`'s error exit (directly or later), within its scope. */
function errorPathSources(graph: AgentGraph, reachableIds: Set<string>): GraphNode[] {
  const sources = graph.edges.filter((edge) => edge.sourceHandle === FAIL_BRANCH_HANDLE && reachableIds.has(edge.target)).map((edge) => edge.source)
  return graph.nodes.filter((node) => sources.includes(node.id) && node.onError.strategy === 'fail-branch')
}

function iterationItemType(graph: AgentGraph, container: GraphNode, kindsByKind: Record<string, NodeKindInfo>): string {
  const source = readSelector(readConfigValue(container.config, ['iterator_selector']))
  if (!source) return 'any'
  const sourceNode = graph.nodes.find((node) => node.id === source[0])
  const output = sourceNode ? kindsByKind[sourceNode.kind]?.outputs.find((candidate) => candidate.name === source[1]) : undefined
  const valueType = output?.valueType ?? 'any'
  return valueType.startsWith('array[') ? valueType.slice(6, -1) : 'any'
}

function containerGroup(graph: AgentGraph, container: GraphNode, kindsByKind: Record<string, NodeKindInfo>): ValueGroup | null {
  if (container.kind === 'iteration') {
    return {
      id: `loop:${container.id}`,
      title: messages().nodes.displaytitleItem(container.displayTitle),
      options: [option([container.id, 'item'], 'item', iterationItemType(graph, container, kindsByKind)), option([container.id, 'index'], 'index', 'number')],
    }
  }
  if (container.kind === 'loop') {
    const variables = listNodeOutputs(container, kindsByKind[container.kind]).filter((valueOption) => valueOption.path[1] !== 'loop_round')
    return variables.length > 0 ? { id: `loop:${container.id}`, title: messages().nodes.displaytitleValuesKeptBetweenRounds(container.displayTitle), options: variables } : null
  }
  return null
}

function nodeGroups(graph: AgentGraph, earlierIds: string[], kindsByKind: Record<string, NodeKindInfo>): ValueGroup[] {
  return graph.nodes
    .filter((node) => earlierIds.includes(node.id) && !node.hidden)
    .map((node) => ({ id: node.id, title: node.kind === 'start' ? messages().nodes.start : node.displayTitle, options: listNodeOutputs(node, kindsByKind[node.kind]) }))
    .filter((group) => group.options.length > 0)
}

/**
 * Every value `nodeId` may reference, grouped as the picker shows them (innermost loop
 * first, then earlier steps, Start, error path, secrets, this run).
 *
 * @param graph - The working copy (AgentGraph)
 * @param nodeId - The step being edited (string)
 * @param kindsByKind - The node library by kind (Record<string, NodeKindInfo>)
 * @returns Picker groups (ValueGroup[])
 */
export function listAvailableValues(graph: AgentGraph, nodeId: string, kindsByKind: Record<string, NodeKindInfo>): ValueGroup[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const loopGroups: ValueGroup[] = []
  const stepGroups: ValueGroup[] = []
  const errorGroups: ValueGroup[] = []
  let scopeNodeId: string | null = nodeId
  while (scopeNodeId) {
    const earlierIds = listEarlierNodeIds(graph, scopeNodeId)
    stepGroups.push(...nodeGroups(graph, earlierIds, kindsByKind))
    for (const source of errorPathSources(graph, new Set([scopeNodeId, ...earlierIds]))) {
      errorGroups.push({
        id: `error:${source.id}`,
        title: messages().nodes.onAnErrorPathDisplaytitle(source.displayTitle),
        note: messages().nodes.onlyInStepsAfterAnOn,
        options: [option([source.id, 'error_message'], 'error_message', 'string'), option([source.id, 'error_type'], 'error_type', 'string')],
      })
    }
    const parentId: string | null = nodesById.get(scopeNodeId)?.parent ?? null
    const container = parentId ? nodesById.get(parentId) : undefined
    if (container) {
      const group = containerGroup(graph, container, kindsByKind)
      if (group) loopGroups.push(group)
    }
    scopeNodeId = parentId
  }
  const startGroups = stepGroups.filter((group) => nodesById.get(group.id)?.kind === 'start')
  const otherStepGroups = stepGroups.filter((group) => nodesById.get(group.id)?.kind !== 'start')
  const secretGroup: ValueGroup[] =
    graph.env.length > 0
      ? [{ id: 'env', title: messages().nodes.secrets, note: messages().nodes.namesOnlyValuesStayInKeychain, options: graph.env.map((envVar) => ({ path: [ENV_NAMESPACE, envVar.name], label: envVar.name, typeHint: envVar.isSecret ? messages().nodes.secretValueNeverShown : 'setting' })) }]
      : []
  const runGroup: ValueGroup = { id: 'sys', title: messages().nodes.thisRun, options: [option([SYSTEM_NAMESPACE, 'run_id'], messages().nodes.runId, 'string')] }
  return [...loopGroups, ...otherStepGroups, ...startGroups, ...errorGroups, ...secretGroup, runGroup]
}

/** How a reference stands for the step that uses it. */
export interface ReferenceCheck {
  status: 'ok' | 'unknown-step' | 'out-of-scope'
  /** Plain words for a problem, e.g. "no step called draft_message". */
  message: string | null
}

/**
 * Checks one reference the way graphrt compiles it: an unknown step is an error that
 * blocks Test; a step that is not before this one (or sits inside another loop) is a
 * warning because its value resolves to empty.
 *
 * @example
 * checkReference(['draft_message', 'text'], graph, groups) // { status: 'unknown-step', message: 'no step called draft_message…' }
 */
export function checkReference(path: string[], graph: AgentGraph, groups: ValueGroup[]): ReferenceCheck {
  const [namespace] = path
  if (namespace === SYSTEM_NAMESPACE || namespace === ENV_NAMESPACE) return { status: 'ok', message: null }
  if (!graph.nodes.some((node) => node.id === namespace)) {
    return { status: 'unknown-step', message: messages().nodes.noStepCalledNamespaceItMay(namespace) }
  }
  const offeredRoots = new Set(groups.flatMap((group) => group.options.map((valueOption) => valueOption.path[0])))
  if (offeredRoots.has(namespace)) return { status: 'ok', message: null }
  return { status: 'out-of-scope', message: messages().nodes.referenceIsNotBeforeThisStep(describeReference(path, graph)) }
}

/**
 * The outputs of the steps inside a container (For each › "Collect from each item"
 * reads one of them for every item).
 */
export function listBodyValues(graph: AgentGraph, containerId: string, kindsByKind: Record<string, NodeKindInfo>): ValueGroup[] {
  return graph.nodes
    .filter((node) => node.parent === containerId && !node.hidden)
    .map((node) => ({ id: node.id, title: node.displayTitle, options: listNodeOutputs(node, kindsByKind[node.kind]) }))
    .filter((group) => group.options.length > 0)
}
