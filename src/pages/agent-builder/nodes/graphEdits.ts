import type { AgentGraph, EdgeEdit, GraphEdge, GraphEdit, GraphNode, NodeEdit, NodeLayout } from '@/api/agentGraphTypes'
import { deriveNodePorts, isEdgeUnused, nodeKindTitle, pluginOfKind, SOURCE_HANDLE } from '@/lib/agentGraphRules'

/**
 * Pure edit operations on an {@link AgentGraph} working copy. `useAgentGraph` runs
 * them for its actions; phase-2 components may call them directly inside
 * `applyEdit` for compound edits. Every function returns a new graph and keeps
 * ports, names and "unused" arrows consistent with the backend rules.
 */

/** Fields of a node an edit may change (the id is fixed: references `{{#id.field#}}` point at it). */
export type NodeChanges = Partial<Omit<NodeEdit, 'id'>>

/** A node as the editor stores it before the backend has seen it. */
export function createGraphNode(nodeEdit: NodeEdit, kindDisplayName?: string): GraphNode {
  const config = nodeEdit.config ?? {}
  const onError = nodeEdit.onError ?? { strategy: 'fail', values: {} }
  const title = nodeEdit.title ?? null
  return {
    id: nodeEdit.id,
    kind: nodeEdit.kind,
    title,
    displayTitle: title?.trim() || kindDisplayName || nodeKindTitle(nodeEdit.kind),
    detail: '',
    parent: nodeEdit.parent ?? null,
    config,
    onError,
    retry: nodeEdit.retry ?? { maxRetries: 0, intervalMs: 0, backoff: 1 },
    timeoutMs: nodeEdit.timeoutMs ?? null,
    ports: deriveNodePorts(nodeEdit.kind, config, onError.strategy),
    container: nodeEdit.kind === 'iteration' || nodeEdit.kind === 'loop',
    hidden: nodeEdit.kind === 'iteration-start' || nodeEdit.kind === 'loop-start',
    needsApproval: nodeEdit.kind === 'human-input',
    sendsData: false,
    plugin: pluginOfKind(nodeEdit.kind),
  }
}

function withUnusedFlags(graph: AgentGraph): AgentGraph {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  return { ...graph, edges: graph.edges.map((edge) => ({ ...edge, unused: isEdgeUnused(edge, nodesById.get(edge.source)) })) }
}

function changeNode(node: GraphNode, changes: NodeChanges): GraphNode {
  const next: GraphNode = {
    ...node,
    kind: changes.kind ?? node.kind,
    title: changes.title === undefined ? node.title : changes.title,
    parent: changes.parent === undefined ? node.parent : changes.parent,
    config: changes.config ?? node.config,
    onError: changes.onError ?? node.onError,
    retry: changes.retry ?? node.retry,
    timeoutMs: changes.timeoutMs === undefined ? node.timeoutMs : changes.timeoutMs,
  }
  const portsChanged = next.kind !== node.kind || next.config !== node.config || next.onError.strategy !== node.onError.strategy
  // The backend's ports stay until something they derive from changes (it also knows fixed plugin handles).
  if (portsChanged) next.ports = deriveNodePorts(next.kind, next.config, next.onError.strategy)
  if (next.title !== node.title || next.kind !== node.kind) {
    const fallbackTitle = next.kind === node.kind && !node.title ? node.displayTitle : nodeKindTitle(next.kind)
    next.displayTitle = next.title?.trim() || fallbackTitle
  }
  if (next.kind !== node.kind) next.plugin = pluginOfKind(next.kind)
  return next
}

/** Applies `changes` to one node. Unknown ids leave the graph unchanged. */
export function updateGraphNode(graph: AgentGraph, nodeId: string, changes: NodeChanges): AgentGraph {
  if (!graph.nodes.some((node) => node.id === nodeId)) return graph
  return withUnusedFlags({ ...graph, nodes: graph.nodes.map((node) => (node.id === nodeId ? changeNode(node, changes) : node)) })
}

/** Adds a node (after its container's last child when it has a parent, else at the end). */
export function addGraphNode(graph: AgentGraph, node: GraphNode): AgentGraph {
  if (graph.nodes.some((existing) => existing.id === node.id)) throw new Error(`a node called ${node.id} already exists`)
  return { ...graph, nodes: [...graph.nodes, node] }
}

/** Removes nodes, their descendants (container bodies) and every arrow touching them. */
export function removeGraphNodes(graph: AgentGraph, nodeIds: string[]): AgentGraph {
  const removed = new Set(nodeIds)
  let grew = true
  while (grew) {
    grew = false
    for (const node of graph.nodes) {
      if (node.parent && removed.has(node.parent) && !removed.has(node.id)) {
        removed.add(node.id)
        grew = true
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removed.has(node.id)),
    edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
  }
}

/** Adds an arrow; an identical one (same source, exit and target) is not added twice. */
export function addGraphEdge(graph: AgentGraph, edgeEdit: EdgeEdit): AgentGraph {
  const sourceHandle = edgeEdit.sourceHandle || SOURCE_HANDLE
  if (graph.edges.some((edge) => edge.source === edgeEdit.source && edge.sourceHandle === sourceHandle && edge.target === edgeEdit.target)) return graph
  const takenIds = new Set(graph.edges.map((edge) => edge.id))
  let index = graph.edges.length
  while (takenIds.has(`${edgeEdit.source}-${edgeEdit.target}-${index}`)) index += 1
  const edge: GraphEdge = {
    id: `${edgeEdit.source}-${edgeEdit.target}-${index}`,
    documentId: edgeEdit.documentId ?? null,
    source: edgeEdit.source,
    sourceHandle,
    target: edgeEdit.target,
    unused: false,
  }
  return withUnusedFlags({ ...graph, edges: [...graph.edges, edge] })
}

/** Removes arrows by their UI id. */
export function removeGraphEdges(graph: AgentGraph, edgeIds: string[]): AgentGraph {
  const removed = new Set(edgeIds)
  return { ...graph, edges: graph.edges.filter((edge) => !removed.has(edge.id)) }
}

/** Removes every arrow into or out of `nodeIds` (context menu Disconnect). */
export function disconnectGraphNodes(graph: AgentGraph, nodeIds: string[]): AgentGraph {
  const disconnected = new Set(nodeIds)
  const edges = graph.edges.filter((edge) => !disconnected.has(edge.source) && !disconnected.has(edge.target))
  return edges.length === graph.edges.length ? graph : { ...graph, edges }
}

/**
 * Moves one end of an arrow (drag an arrow end to another port). Keeps the arrow's
 * document id when the source stays the same.
 */
export function reconnectGraphEdge(graph: AgentGraph, edgeId: string, edgeEdit: EdgeEdit): AgentGraph {
  const existing = graph.edges.find((edge) => edge.id === edgeId)
  if (!existing) return graph
  const documentId = existing.source === edgeEdit.source ? existing.documentId : null
  return addGraphEdge(removeGraphEdges(graph, [edgeId]), { ...edgeEdit, documentId })
}

/**
 * Adds `node` after `from` (spec I1 "Add node after"): an arrow from `from`'s exit to
 * the node, and when that exit already led somewhere, the node is put in between
 * (the old arrows now leave from the node's default exit).
 *
 * @param graph - Working graph (AgentGraph)
 * @param node - The new node (GraphNode)
 * @param from - The step and exit to add it after (EdgeEdit without target)
 * @returns The graph with the node wired in (AgentGraph)
 */
export function insertGraphNodeAfter(graph: AgentGraph, node: GraphNode, from: { source: string; sourceHandle?: string | null }): AgentGraph {
  const sourceHandle = from.sourceHandle || SOURCE_HANDLE
  const withNode = addGraphNode(graph, node)
  const followingEdges = graph.edges.filter((edge) => edge.source === from.source && edge.sourceHandle === sourceHandle)
  const canContinue = node.ports.outputs.some((outputPort) => outputPort.id === SOURCE_HANDLE)
  let nextGraph = addGraphEdge(canContinue ? removeGraphEdges(withNode, followingEdges.map((edge) => edge.id)) : withNode, { source: from.source, sourceHandle, target: node.id })
  if (!canContinue) return nextGraph
  for (const edge of followingEdges) nextGraph = addGraphEdge(nextGraph, { source: node.id, sourceHandle: SOURCE_HANDLE, target: edge.target })
  return nextGraph
}

/** A node id not used yet, from a readable base (`write_message`, `write_message_2`…). */
export function uniqueNodeId(graph: AgentGraph, base: string): string {
  const cleanBase = base.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'step'
  const taken = new Set(graph.nodes.map((node) => node.id))
  if (!taken.has(cleanBase)) return cleanBase
  let suffix = 2
  while (taken.has(`${cleanBase}_${suffix}`)) suffix += 1
  return `${cleanBase}_${suffix}`
}

/** The working copy as the edit `save_agent_graph` takes. */
export function toGraphEdit(graph: AgentGraph, options: { description?: string | null; layout?: NodeLayout[] | null } = {}): GraphEdit {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      parent: node.parent,
      config: node.config,
      onError: node.onError,
      retry: node.retry,
      timeoutMs: node.timeoutMs,
    })),
    edges: graph.edges.map((edge) => ({ documentId: edge.documentId, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target })),
    description: options.description ?? null,
    layout: options.layout ?? null,
  }
}

/** Ids of nodes whose editable fields differ between two graphs (added ones included). */
export function changedNodeIds(before: AgentGraph, after: AgentGraph): string[] {
  const editable = (node: GraphNode) => JSON.stringify([node.kind, node.title, node.parent, node.config, node.onError, node.retry, node.timeoutMs])
  const beforeById = new Map(before.nodes.map((node) => [node.id, editable(node)]))
  return after.nodes.filter((node) => beforeById.get(node.id) !== editable(node)).map((node) => node.id)
}

/** True when the two graphs would save the same document. */
export function isSameGraph(first: AgentGraph, second: AgentGraph): boolean {
  return JSON.stringify(toGraphEdit(first)) === JSON.stringify(toGraphEdit(second))
}
