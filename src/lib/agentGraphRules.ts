import type { GraphEdge, GraphNode, NodeConfig, NodePort, NodePorts, OnErrorStrategy } from '@/api/agentGraphTypes'
import { messages } from '@/i18n'

/**
 * Graph rules the Nodes view applies locally, mirroring the backend
 * (`src-tauri/src/agent_graph/ports.rs` and `flow/summary.rs`), so an edit shows its
 * new ports and names before it is saved. The backend recomputes them on load and save.
 */

/** Handle of the default exit, and of edges that name none. */
export const SOURCE_HANDLE = 'source'
/** Handle of a node's input. */
export const TARGET_HANDLE = 'target'
/** Exit taken when a step set to "Go to the error path" fails. */
export const FAIL_BRANCH_HANDLE = 'fail-branch'
/** if-else exit when no case matches. */
export const ELSE_HANDLE = 'false'

const noInputKinds = new Set(['start', 'iteration-start', 'loop-start'])
const noOutputKinds = new Set(['end', 'loop-end'])
/** Container kind → its hidden body marker kind. */
export const bodyMarkerKinds: Record<string, string> = { iteration: 'iteration-start', loop: 'loop-start' }

const kindTitles: Record<string, string> = {
  start: 'Start',
  end: 'End',
  llm: 'Ask a model',
  agent: 'Run an agent',
  'question-classifier': 'Sort into categories',
  'parameter-extractor': 'Pull out details',
  'knowledge-retrieval': 'Knowledge retrieval',
  'http-request': 'HTTP request',
  'human-input': 'Ask me before continuing',
  iteration: 'For each item',
  loop: 'Repeat',
  'loop-end': 'Stop repeating',
  'if-else': 'Check a condition',
  'template-transform': 'Format text',
  'variable-aggregator': 'Combine results',
  assigner: 'Remember a value',
  'variable-assigner': 'Remember a value',
  'list-operator': 'Filter a list',
  answer: 'Reply',
  tool: 'Use a tool',
}

/** `some-node_kind` → `Some node kind`. */
function humanizeKind(kind: string): string {
  const words = kind.replace(/[-_]/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : messages().lib.step
}

/**
 * The app's name for a node kind ("Ask a model"); plugin kinds use their operation.
 *
 * @example
 * nodeKindTitle('human-input') // 'Ask me before continuing'
 * nodeKindTitle('whatsapp-web.send_message') // 'Send message'
 */
export function nodeKindTitle(kind: string): string {
  if (kindTitles[kind]) return kindTitles[kind]
  const operation = kind.includes('.') ? kind.slice(kind.indexOf('.') + 1) : kind
  return humanizeKind(operation)
}

/** Plugin name of a plugin kind (`whatsapp-web` for `whatsapp-web.send_message`), else null. */
export function pluginOfKind(kind: string): string | null {
  const dotIndex = kind.indexOf('.')
  return dotIndex > 0 ? kind.slice(0, dotIndex) : null
}

function port(id: string, label: string, role: NodePort['role']): NodePort {
  return { id, label, role }
}

function listPorts(config: NodeConfig, listKey: string, idKey: string, labelKeys: string[]): NodePort[] {
  const items = config[listKey]
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const id = item[idKey]
    if (typeof id !== 'string' || !id) return []
    const label = labelKeys.map((key) => item[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '')
    return [port(id, label?.trim() ?? id, 'branch')]
  })
}

function exitPorts(kind: string, config: NodeConfig): NodePort[] {
  if (noOutputKinds.has(kind)) return []
  if (kind === 'if-else') {
    const cases = listPorts(config, 'cases', 'case_id', [])
    if (cases.length === 0 && 'conditions' in config) cases.push(port('true', messages().lib.if, 'branch'))
    return [...cases, port(ELSE_HANDLE, messages().lib.else, 'else')]
  }
  if (kind === 'human-input') {
    const actions = listPorts(config, 'actions', 'id', ['title'])
    return actions.length > 0 ? actions : [port('submit', messages().lib.submit, 'branch')]
  }
  if (kind === 'question-classifier') return listPorts(config, 'classes', 'id', ['label', 'name'])
  return [port(SOURCE_HANDLE, '', 'default')]
}

/**
 * Ports of a node from its kind and config (same rules as the backend). Kinds whose
 * library entry lists fixed exits are not known here; the backend's ports win on load.
 */
export function deriveNodePorts(kind: string, config: NodeConfig, onErrorStrategy: OnErrorStrategy): NodePorts {
  const inputs = noInputKinds.has(kind) ? [] : [port(TARGET_HANDLE, '', 'input')]
  const outputs = exitPorts(kind, config)
  if (onErrorStrategy === 'fail-branch') outputs.push(port(FAIL_BRANCH_HANDLE, messages().lib.onError, 'fail-branch'))
  return { inputs, outputs }
}

/** True when `edge` leaves `source` through an exit the node does not have (kept, never taken). */
export function isEdgeUnused(edge: Pick<GraphEdge, 'sourceHandle'>, source: Pick<GraphNode, 'ports'> | undefined): boolean {
  if (!source) return false
  return !source.ports.outputs.some((outputPort) => outputPort.id === edge.sourceHandle)
}

/** Whether an arrow may be drawn, and why not (shown on the target while dragging). */
export type ConnectionCheck = { allowed: true } | { allowed: false; reason: string }

/** The two ends of an arrow being drawn. */
export interface ConnectionEnds {
  source: string
  /** Exit of the source; null or empty for the default exit. */
  sourceHandle?: string | null
  target: string
}

/** True when arrows lead from `from` to `to`, so an arrow `to` → `from` would close a circle. */
function leadsTo(edges: Pick<GraphEdge, 'source' | 'target'>[], from: string, to: string): boolean {
  const targetsBySource = new Map<string, string[]>()
  for (const edge of edges) targetsBySource.set(edge.source, [...(targetsBySource.get(edge.source) ?? []), edge.target])
  const visited = new Set<string>()
  const pending = [from]
  while (pending.length > 0) {
    const current = pending.pop() as string
    if (current === to) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(targetsBySource.get(current) ?? []))
  }
  return false
}

function describeCrossScope(nodesById: Map<string, GraphNode>, source: GraphNode, target: GraphNode): string {
  const titleOf = (nodeId: string) => nodesById.get(nodeId)?.displayTitle ?? nodeId
  if (source.parent) return messages().lib.cantConnectStepsInsideValueCant(titleOf(source.parent))
  return messages().lib.cantConnectStepsOutsideValueCant(titleOf(target.parent as string))
}

/**
 * The graphrt graph rules for a new arrow (spec I1): no arrow into Start or a body
 * entry, none across a loop boundary, no circles, none from a step to itself, no
 * duplicate, and only from an exit the source has.
 *
 * @param graph - The working graph (nodes and edges)
 * @param ends - Source, its exit and target of the arrow (ConnectionEnds)
 * @returns `{ allowed: true }`, or `{ allowed: false, reason }` in plain words (ConnectionCheck)
 *
 * @example
 * checkConnection(graph, { source: 'write_message', target: 'start' })
 * // { allowed: false, reason: "Can't connect: Start never has arrows coming in" }
 */
export function checkConnection(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, ends: ConnectionEnds): ConnectionCheck {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const source = nodesById.get(ends.source)
  const target = nodesById.get(ends.target)
  const sourceHandle = ends.sourceHandle || SOURCE_HANDLE
  if (!source || !target) return { allowed: false, reason: messages().lib.cantConnectThatStepNoLonger }
  if (source.id === target.id) return { allowed: false, reason: messages().lib.cantConnectAStepToItself }
  if (target.ports.inputs.length === 0) {
    return { allowed: false, reason: target.kind === 'start' ? messages().lib.cantConnectStartNeverHasArrows : messages().lib.cantConnectThisStepHasNo }
  }
  if (!source.ports.outputs.some((outputPort) => outputPort.id === sourceHandle)) return { allowed: false, reason: messages().lib.cantConnectDisplaytitleHasNoSuch(source.displayTitle) }
  if (source.parent !== target.parent) return { allowed: false, reason: describeCrossScope(nodesById, source, target) }
  if (graph.edges.some((edge) => edge.source === source.id && edge.sourceHandle === sourceHandle && edge.target === target.id)) {
    return { allowed: false, reason: messages().lib.alreadyConnected }
  }
  if (leadsTo(graph.edges, target.id, source.id)) return { allowed: false, reason: messages().lib.cantConnectThatWouldMakeA }
  return { allowed: true }
}
