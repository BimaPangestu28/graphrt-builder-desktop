import type { AgentGraph, EdgeEdit, GraphEdge, GraphEdit, GraphNode, JsonValue, NodeEdit, NodeLayout } from '@/api/agentGraphTypes'
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

/**
 * The working copy as the edit `save_agent_graph` takes. Its secret `env` names go along
 * as `declareSecrets` (the backend adds the ones the document lacks, e.g. a secret just
 * picked for an HTTP sign-in, and ignores the rest).
 */
export function toGraphEdit(graph: AgentGraph, options: { description?: string | null; layout?: NodeLayout[] | null } = {}): GraphEdit {
  const declareSecrets = graph.env.filter((variable) => variable.isSecret).map((variable) => variable.name)
  return {
    ...(declareSecrets.length > 0 ? { declareSecrets } : {}),
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

/** The exit a freshly added node continues through: its default exit, else its first non-error one. */
function continuingHandle(node: GraphNode): string | null {
  const outputs = node.ports.outputs.filter((outputPort) => outputPort.role !== 'fail-branch')
  return (outputs.find((outputPort) => outputPort.id === SOURCE_HANDLE) ?? outputs[0])?.id ?? null
}

/**
 * Puts `node` on an arrow: `source → node → target`. The first half keeps the arrow's exit
 * (a branch stays a branch). A node without an exit (End, Stop repeating) only takes the
 * arrow in and the original arrow stays; a node without an input (Start) is only added. An
 * unknown arrow id just adds the node. The node joins the arrow's container (`parent`).
 *
 * @param graph - Working copy (AgentGraph)
 * @param node - The new node, built with `createGraphNode` (GraphNode)
 * @param edgeId - UI id of the arrow (string)
 * @returns The graph with the node and its arrows (AgentGraph)
 */
export function insertGraphNodeOnEdge(graph: AgentGraph, node: GraphNode, edgeId: string): AgentGraph {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId)
  if (!edge) return addGraphNode(graph, node)
  const parent = graph.nodes.find((candidate) => candidate.id === edge.source)?.parent ?? null
  const placedNode: GraphNode = { ...node, parent }
  let next = addGraphNode(graph, placedNode)
  if (placedNode.ports.inputs.length === 0) return next
  const exitHandle = continuingHandle(placedNode)
  if (exitHandle) next = removeGraphEdges(next, [edge.id])
  next = addGraphEdge(next, { source: edge.source, sourceHandle: edge.sourceHandle, target: placedNode.id })
  if (exitHandle) next = addGraphEdge(next, { source: placedNode.id, sourceHandle: exitHandle, target: edge.target })
  return next
}

/**
 * Adds `node` after `anchorNodeId` (spec: "Add node after inserts on the outgoing default
 * edge"): on the anchor's default arrow when it has one, else connected from its first exit,
 * else (End) only placed in the anchor's container.
 *
 * @param graph - Working copy (AgentGraph)
 * @param node - The new node (GraphNode)
 * @param anchorNodeId - The node to add after (string)
 * @returns The graph with the node and its arrows (AgentGraph)
 */
export function insertGraphNodeAfterNode(graph: AgentGraph, node: GraphNode, anchorNodeId: string): AgentGraph {
  const anchor = graph.nodes.find((candidate) => candidate.id === anchorNodeId)
  if (!anchor) return addGraphNode(graph, node)
  const defaultEdge = graph.edges.find((edge) => edge.source === anchor.id && edge.sourceHandle === SOURCE_HANDLE)
  if (defaultEdge) return insertGraphNodeOnEdge(graph, node, defaultEdge.id)
  const placedNode: GraphNode = { ...node, parent: anchor.parent }
  const next = addGraphNode(graph, placedNode)
  const anchorHandle = continuingHandle(anchor)
  if (!anchorHandle || placedNode.ports.inputs.length === 0) return next
  return addGraphEdge(next, { source: anchor.id, sourceHandle: anchorHandle, target: placedNode.id })
}

/** Ids of every node inside `containerId` (its body, nested bodies included). */
export function containerBodyIds(graph: AgentGraph, containerId: string): Set<string> {
  const body = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const node of graph.nodes) {
      if (node.parent && (node.parent === containerId || body.has(node.parent)) && !body.has(node.id)) {
        body.add(node.id)
        grew = true
      }
    }
  }
  return body
}

function collectReferencedIds(value: JsonValue, nodeIds: Set<string>, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{#([^.#}]+)\./g)) if (nodeIds.has(match[1])) found.add(match[1])
    return
  }
  if (Array.isArray(value)) {
    // A selector: `[node, field, …]` of plain strings.
    if (value.length >= 2 && value.every((segment) => typeof segment === 'string') && nodeIds.has(value[0] as string)) found.add(value[0] as string)
    for (const item of value) collectReferencedIds(item, nodeIds, found)
    return
  }
  if (value && typeof value === 'object') for (const item of Object.values(value)) collectReferencedIds(item, nodeIds, found)
}

/**
 * Ids of the nodes whose values `node` uses (`{{#id.field#}}` templates and `[id, field]`
 * selectors anywhere in its config).
 *
 * @param graph - Working copy, for the known node ids (AgentGraph)
 * @param node - The node to read (GraphNode)
 * @returns Referenced node ids, never the node itself (Set<string>)
 */
export function referencedNodeIds(graph: AgentGraph, node: GraphNode): Set<string> {
  const found = new Set<string>()
  collectReferencedIds(node.config as JsonValue, new Set(graph.nodes.map((candidate) => candidate.id)), found)
  found.delete(node.id)
  return found
}

/** Whether steps may move into a loop (or out to the top level), and why not. */
export interface ReparentCheck {
  allowed: boolean
  reason: string | null
}

function titleOfNode(graph: AgentGraph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.displayTitle ?? nodeId
}

function checkLeavingLoop(graph: AgentGraph, node: GraphNode, movedIds: Set<string>): string | null {
  const oldParent = node.parent as string
  const oldBody = containerBodyIds(graph, oldParent)
  const usesLoopValue = [...referencedNodeIds(graph, node)].some((referencedId) => referencedId === oldParent || (oldBody.has(referencedId) && !movedIds.has(referencedId)))
  if (usesLoopValue) return `${node.displayTitle} uses values from inside ${titleOfNode(graph, oldParent)}`
  const container = graph.nodes.find((candidate) => candidate.id === oldParent)
  if (container && referencedNodeIds(graph, container).has(node.id)) return `${container.displayTitle} collects its result from ${node.displayTitle}`
  return null
}

function checkEnteringLoop(graph: AgentGraph, node: GraphNode, newParent: string, movedIds: Set<string>): string | null {
  const newBody = containerBodyIds(graph, newParent)
  const outsideUser = graph.nodes.find(
    (candidate) => candidate.id !== newParent && !newBody.has(candidate.id) && !movedIds.has(candidate.id) && referencedNodeIds(graph, candidate).has(node.id),
  )
  return outsideUser ? `${outsideUser.displayTitle} uses its result outside ${titleOfNode(graph, newParent)}` : null
}

function checkOneReparent(graph: AgentGraph, node: GraphNode, newParent: string | null, movedIds: Set<string>): string | null {
  if (node.hidden) return "Can't move the start of a loop body"
  if (newParent && (node.kind === 'start' || node.kind === 'end')) return `${node.displayTitle} stays outside loops`
  if (newParent && node.container) return "A loop can't go inside another loop"
  if (node.parent && node.parent !== newParent) {
    const reason = checkLeavingLoop(graph, node, movedIds)
    if (reason) return reason
  }
  if (newParent && newParent !== node.parent) return checkEnteringLoop(graph, node, newParent, movedIds)
  return null
}

/**
 * Checks moving steps into the loop `newParent` (or out to the top level when null)
 * without breaking value references: a step that reads the loop's item stays in it, and a
 * step whose result is read outside a loop cannot go in.
 *
 * @param graph - Working copy (AgentGraph)
 * @param nodeIds - Steps to move (string[])
 * @param newParent - Target loop id, or null for the top level (string | null)
 * @returns Allowed, or the first reason it is not (ReparentCheck)
 *
 * @example
 * checkReparentNodes(graph, ['write_message'], null)
 * // { allowed: false, reason: 'Write a short message uses values from inside For each place' }
 */
export function checkReparentNodes(graph: AgentGraph, nodeIds: string[], newParent: string | null): ReparentCheck {
  if (newParent && !graph.nodes.some((node) => node.id === newParent && node.container)) return { allowed: false, reason: 'Steps can only go inside a loop' }
  const movedIds = new Set(nodeIds)
  for (const nodeId of nodeIds) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return { allowed: false, reason: `There is no step called ${nodeId}` }
    const reason = checkOneReparent(graph, node, newParent, movedIds)
    if (reason) return { allowed: false, reason }
  }
  return { allowed: true, reason: null }
}

/**
 * Moves steps into the loop `newParent` (or to the top level). Arrows never cross a loop's
 * edge, so arrows between a moved step and a step left behind are removed; arrows between
 * the moved steps stay. Run {@link checkReparentNodes} first.
 *
 * @param graph - Working copy (AgentGraph)
 * @param nodeIds - Steps to move (string[])
 * @param newParent - Target loop id, or null for the top level (string | null)
 * @returns The graph with the steps re-parented and crossing arrows removed (AgentGraph)
 */
export function reparentGraphNodes(graph: AgentGraph, nodeIds: string[], newParent: string | null): AgentGraph {
  const moved = new Set(nodeIds)
  const nodes = graph.nodes.map((node) => (moved.has(node.id) ? { ...node, parent: newParent } : node))
  const parentById = new Map(nodes.map((node) => [node.id, node.parent]))
  const edges = graph.edges.filter((edge) => {
    if (!moved.has(edge.source) && !moved.has(edge.target)) return true
    return parentById.get(edge.source) === parentById.get(edge.target)
  })
  return withUnusedFlags({ ...graph, nodes, edges })
}
