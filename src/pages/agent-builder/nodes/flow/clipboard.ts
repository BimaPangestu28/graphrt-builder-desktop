import type { AgentGraph, GraphEdge, GraphNode, JsonValue, NodeConfig, NodeLayout } from '@/api/agentGraphTypes'
import { addGraphEdge, addGraphNode, createGraphNode, uniqueNodeId } from '../graphEdits'

/**
 * Copy, paste and duplicate on the canvas, as pure functions on the working graph.
 * Copies keep their arrows between each other (arrows to steps outside the copy are
 * dropped), container bodies come along, and value references between copied steps
 * (`{{#id.field#}}`, `[id, field]`) point at the new copies.
 */

/** What Copy holds: the copied steps (bodies included), their inner arrows and positions. */
export interface GraphClipboard {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Positions of the copied steps by id (relative to their container, like the canvas). */
  layouts: Record<string, NodeLayout>
}

export interface PasteResult {
  graph: AgentGraph
  /** Old id → new id for every pasted step. */
  idMap: Record<string, string>
  /** Positions for the pasted steps (offset from the originals). */
  layouts: NodeLayout[]
  /** Ids of the pasted top-level steps (the ones to select). */
  pastedRootIds: string[]
}

/** How far a paste lands from the copied steps, so the copy is visible. */
export const pasteOffset = { x: 40, y: 40 }

/** Marks graphrt steps on the system clipboard (`{"graphrt": "nodes", "version": 1, …}`). */
export const systemClipboardMarker = 'nodes'
const systemClipboardVersion = 1
/** Most steps one paste takes from the system clipboard. */
const maxPastedNodes = 200
const nodeIdPattern = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The clipboard as text for the system clipboard, so steps can be pasted in another
 * window or agent.
 *
 * @param clipboard - From {@link copyGraphNodes} (GraphClipboard)
 * @returns JSON with the graphrt marker (string)
 */
export function serializeGraphClipboard(clipboard: GraphClipboard): string {
  return JSON.stringify({ graphrt: systemClipboardMarker, version: systemClipboardVersion, ...clipboard })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readClipboardNode(value: unknown): GraphNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !nodeIdPattern.test(value.id) || typeof value.kind !== 'string' || !value.kind) return null
  if (!isRecord(value.config) || (value.parent !== null && typeof value.parent !== 'string')) return null
  const title = typeof value.title === 'string' ? value.title : null
  const onError = isRecord(value.onError) && typeof value.onError.strategy === 'string' ? (value.onError as unknown as GraphNode['onError']) : undefined
  const retry = isRecord(value.retry) && typeof value.retry.maxRetries === 'number' ? (value.retry as unknown as GraphNode['retry']) : undefined
  const timeoutMs = typeof value.timeoutMs === 'number' ? value.timeoutMs : null
  // Ports, flags and names are derived again here: only the editable fields are trusted.
  const node = createGraphNode({ id: value.id, kind: value.kind, title, parent: value.parent as string | null, config: value.config as NodeConfig, onError, retry, timeoutMs }, typeof value.displayTitle === 'string' ? value.displayTitle : undefined)
  return { ...node, detail: typeof value.detail === 'string' ? value.detail : '' }
}

function readClipboardLayouts(value: unknown, nodeIds: Set<string>): Record<string, NodeLayout> {
  if (!isRecord(value)) return {}
  const layouts: Record<string, NodeLayout> = {}
  for (const [nodeId, layout] of Object.entries(value)) {
    if (!nodeIds.has(nodeId) || !isRecord(layout) || !Number.isFinite(layout.x) || !Number.isFinite(layout.y)) continue
    const size = (dimension: unknown) => (typeof dimension === 'number' && Number.isFinite(dimension) ? dimension : null)
    layouts[nodeId] = { nodeId, x: layout.x as number, y: layout.y as number, width: size(layout.width), height: size(layout.height) }
  }
  return layouts
}

/**
 * Reads steps copied with {@link serializeGraphClipboard}. Anything else (plain text, other
 * JSON, malformed steps) gives null; arrows to steps outside the copy are dropped.
 *
 * @param text - System clipboard text (string)
 * @returns The clipboard, or null when it holds no graphrt steps (GraphClipboard | null)
 */
export function parseGraphClipboard(text: string): GraphClipboard | null {
  if (!text || text.length > 2_000_000 || !text.trimStart().startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.graphrt !== systemClipboardMarker || parsed.version !== systemClipboardVersion || !Array.isArray(parsed.nodes)) return null
  if (parsed.nodes.length === 0 || parsed.nodes.length > maxPastedNodes) return null
  const nodes = parsed.nodes.map(readClipboardNode)
  if (nodes.some((node) => node === null)) return null
  const validNodes = nodes as GraphNode[]
  const nodeIds = new Set(validNodes.map((node) => node.id))
  if (nodeIds.size !== validNodes.length) return null
  const edges: GraphEdge[] = (Array.isArray(parsed.edges) ? parsed.edges : []).flatMap((edge: unknown, edgeIndex: number) => {
    if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return []
    const sourceHandle = typeof edge.sourceHandle === 'string' && edge.sourceHandle ? edge.sourceHandle : 'source'
    return [{ id: `pasted-${edgeIndex}`, documentId: null, source: edge.source, sourceHandle, target: edge.target, unused: false }]
  })
  return { nodes: validNodes, edges, layouts: readClipboardLayouts(parsed.layouts, nodeIds) }
}

function collectWithDescendants(graph: AgentGraph, nodeIds: string[]): Set<string> {
  const collected = new Set(nodeIds.filter((nodeId) => graph.nodes.some((node) => node.id === nodeId && !node.hidden)))
  let grew = true
  while (grew) {
    grew = false
    for (const node of graph.nodes) {
      if (node.parent && collected.has(node.parent) && !collected.has(node.id)) {
        collected.add(node.id)
        grew = true
      }
    }
  }
  return collected
}

/**
 * The steps `nodeIds` (with their loop bodies) ready to paste. Hidden body markers
 * selected on their own are skipped: they only come with their container.
 *
 * @param graph - Working graph (AgentGraph)
 * @param nodeIds - Selected step ids (string[])
 * @param positions - Current positions by id (Record<string, NodeLayout>)
 * @returns The clipboard, empty when nothing copyable was selected (GraphClipboard)
 */
export function copyGraphNodes(graph: AgentGraph, nodeIds: string[], positions: Record<string, NodeLayout>): GraphClipboard {
  const copiedIds = collectWithDescendants(graph, nodeIds)
  const nodes = graph.nodes.filter((node) => copiedIds.has(node.id)).map((node) => structuredClone(node))
  const edges = graph.edges.filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target)).map((edge) => ({ ...edge }))
  const layouts = Object.fromEntries(nodes.flatMap((node) => (positions[node.id] ? [[node.id, { ...positions[node.id] }]] : [])))
  return { nodes, edges, layouts }
}

/** Rewrites `{{#old.…#}}` templates and `[old, …]` selectors to the new ids. */
export function remapReferences(value: JsonValue, idMap: Record<string, string>): JsonValue {
  if (typeof value === 'string') {
    return value.replace(/\{\{#([A-Za-z0-9_-]+)\./g, (match, referencedId: string) => (idMap[referencedId] ? `{{#${idMap[referencedId]}.` : match))
  }
  if (Array.isArray(value)) {
    const remapped = value.map((item) => remapReferences(item, idMap))
    if (typeof remapped[0] === 'string' && idMap[remapped[0]]) remapped[0] = idMap[remapped[0]]
    return remapped
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapReferences(item, idMap)]))
  return value
}

function newIdsFor(graph: AgentGraph, nodes: GraphNode[]): Record<string, string> {
  const idMap: Record<string, string> = {}
  let reserved: AgentGraph = graph
  for (const node of nodes) {
    const newId = uniqueNodeId(reserved, node.id.replace(/_\d+$/, ''))
    idMap[node.id] = newId
    // Reserve the id so the next copy of the same base gets the next suffix.
    reserved = { ...reserved, nodes: [...reserved.nodes, { ...node, id: newId }] }
  }
  return idMap
}

/**
 * Adds the clipboard's steps as new steps with fresh ids. A copied step whose
 * container was not copied lands in that same container when it still exists, else
 * at the top level.
 *
 * @param graph - Working graph (AgentGraph)
 * @param clipboard - From {@link copyGraphNodes} (GraphClipboard)
 * @param offset - Shift of the pasted positions (defaults to {@link pasteOffset})
 * @returns The graph with the copies, the id map and their positions (PasteResult)
 */
export function pasteGraphNodes(graph: AgentGraph, clipboard: GraphClipboard, offset: { x: number; y: number } = pasteOffset): PasteResult {
  const idMap = newIdsFor(graph, clipboard.nodes)
  const existingIds = new Set(graph.nodes.map((node) => node.id))
  let nextGraph = graph
  const layouts: NodeLayout[] = []
  const pastedRootIds: string[] = []
  for (const node of clipboard.nodes) {
    const parentCopied = node.parent !== null && idMap[node.parent] !== undefined
    const parent = parentCopied ? idMap[node.parent as string] : node.parent && existingIds.has(node.parent) ? node.parent : null
    const pasted: GraphNode = { ...structuredClone(node), id: idMap[node.id], parent, config: remapReferences(node.config, idMap) as NodeConfig }
    nextGraph = addGraphNode(nextGraph, pasted)
    if (!parentCopied) pastedRootIds.push(pasted.id)
    const layout = clipboard.layouts[node.id]
    if (layout) {
      const shift = parentCopied ? { x: 0, y: 0 } : offset
      layouts.push({ ...layout, nodeId: pasted.id, x: layout.x + shift.x, y: layout.y + shift.y })
    }
  }
  for (const edge of clipboard.edges) {
    nextGraph = addGraphEdge(nextGraph, { source: idMap[edge.source], sourceHandle: edge.sourceHandle, target: idMap[edge.target] })
  }
  return { graph: nextGraph, idMap, layouts, pastedRootIds }
}
