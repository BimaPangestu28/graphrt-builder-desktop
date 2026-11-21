import type { AgentGraph, GraphEdge, GraphNode, JsonValue, NodeConfig, NodeLayout } from '@/api/agentGraphTypes'
import { addGraphEdge, addGraphNode, uniqueNodeId } from '../graphEdits'

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
