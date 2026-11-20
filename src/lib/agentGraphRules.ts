import type { GraphEdge, GraphNode, NodeConfig, NodePort, NodePorts, OnErrorStrategy } from '@/api/agentGraphTypes'

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
  return words ? words[0].toUpperCase() + words.slice(1) : 'Step'
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
    if (cases.length === 0 && 'conditions' in config) cases.push(port('true', 'If', 'branch'))
    return [...cases, port(ELSE_HANDLE, 'Else', 'else')]
  }
  if (kind === 'human-input') {
    const actions = listPorts(config, 'actions', 'id', ['title'])
    return actions.length > 0 ? actions : [port('submit', 'Submit', 'branch')]
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
  if (onErrorStrategy === 'fail-branch') outputs.push(port(FAIL_BRANCH_HANDLE, 'On error', 'fail-branch'))
  return { inputs, outputs }
}

/** True when `edge` leaves `source` through an exit the node does not have (kept, never taken). */
export function isEdgeUnused(edge: Pick<GraphEdge, 'sourceHandle'>, source: Pick<GraphNode, 'ports'> | undefined): boolean {
  if (!source) return false
  return !source.ports.outputs.some((outputPort) => outputPort.id === edge.sourceHandle)
}
