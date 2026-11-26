import type { AgentGraph, GraphEdge, GraphNode } from '@/api/agentGraphTypes'
import { isEdgeUnused } from '@/lib/agentGraphRules'
import { messages } from '@/i18n'

/**
 * Three-way merge of the Nodes view's local edits onto a version the builder saved meanwhile
 * (spec S1: "queued edits re-apply if they touch other steps; same step → Keep mine / Keep the
 * builder's"). Works per node on the editable fields (kind, title, parent, config, on_error,
 * retry, timeout) and per arrow (source, exit, target):
 *
 * - a node only one side changed (or added, or removed) takes that side's version;
 * - a node both sides changed the same way is kept once;
 * - a node both sides changed differently (or one changed and the other removed) is a
 *   {@link NodeMergeConflict}; until it is resolved the builder's version stands;
 * - arrows: mine added are added, mine removed are removed, the builder's changes are kept;
 *   arrows to nodes that no longer exist are dropped.
 */

export interface NodeMergeConflict {
  nodeId: string
  /** Title to show ("Ask a model"), mine when I still have the node. */
  title: string
  /** My version, null when I removed the node. */
  mine: GraphNode | null
  /** The builder's version, null when the builder removed it. */
  theirs: GraphNode | null
}

export interface GraphMergeResult {
  /** The builder's graph with my non-conflicting edits on top (conflicts as the builder's). */
  merged: AgentGraph
  conflicts: NodeMergeConflict[]
  /** Nodes whose edits of mine were re-applied. */
  reappliedNodeIds: string[]
}

/** Per conflicting node: keep my version or the builder's. */
export type ConflictChoice = 'keep-mine' | 'keep-theirs'

function nodeSignature(node: GraphNode | undefined): string | null {
  if (!node) return null
  return JSON.stringify([node.kind, node.title, node.parent, node.config, node.onError, node.retry, node.timeoutMs])
}

function edgeKey(edge: Pick<GraphEdge, 'source' | 'sourceHandle' | 'target'>): string {
  return JSON.stringify([edge.source, edge.sourceHandle, edge.target])
}

function byId(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

type NodePick = { kind: 'take'; node: GraphNode | null; fromMine: boolean } | { kind: 'conflict'; conflict: NodeMergeConflict }

function pickNode(nodeId: string, base: GraphNode | undefined, mine: GraphNode | undefined, theirs: GraphNode | undefined): NodePick {
  const [baseSignature, mineSignature, theirSignature] = [nodeSignature(base), nodeSignature(mine), nodeSignature(theirs)]
  if (mineSignature === baseSignature) return { kind: 'take', node: theirs ?? null, fromMine: false }
  if (theirSignature === baseSignature || theirSignature === mineSignature) return { kind: 'take', node: mine ?? null, fromMine: theirSignature !== mineSignature }
  const title = base?.displayTitle ?? theirs?.displayTitle ?? mine?.displayTitle ?? nodeId
  return { kind: 'conflict', conflict: { nodeId, title, mine: mine ?? null, theirs: theirs ?? null } }
}

/** Builder's node order, then the nodes only I added, in my order. */
function orderNodes(theirs: AgentGraph, mine: AgentGraph, chosen: Map<string, GraphNode | null>): GraphNode[] {
  const ordered: GraphNode[] = []
  const placed = new Set<string>()
  for (const node of [...theirs.nodes, ...mine.nodes]) {
    if (placed.has(node.id)) continue
    placed.add(node.id)
    const picked = chosen.get(node.id)
    if (picked) ordered.push(picked)
  }
  return ordered
}

function mergeEdges(base: AgentGraph, mine: AgentGraph, theirs: AgentGraph, nodes: GraphNode[]): GraphEdge[] {
  const baseKeys = new Set(base.edges.map(edgeKey))
  const mineKeys = new Set(mine.edges.map(edgeKey))
  const removedByMe = new Set([...baseKeys].filter((key) => !mineKeys.has(key)))
  const nodesById = byId(nodes)
  const edges = theirs.edges.filter((edge) => !removedByMe.has(edgeKey(edge)))
  const keys = new Set(edges.map(edgeKey))
  const takenIds = new Set(edges.map((edge) => edge.id))
  for (const edge of mine.edges) {
    const key = edgeKey(edge)
    if (baseKeys.has(key) || keys.has(key)) continue
    let id = edge.id
    for (let suffix = 2; takenIds.has(id); suffix += 1) id = `${edge.id}-${suffix}`
    takenIds.add(id)
    keys.add(key)
    edges.push({ ...edge, id })
  }
  return edges
    .filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map((edge) => ({ ...edge, unused: isEdgeUnused(edge, nodesById.get(edge.source)) }))
}

/** Their env plus the secrets my waiting edits declared (an HTTP sign-in picked meanwhile). */
function mergeEnv(base: AgentGraph, mine: AgentGraph, theirs: AgentGraph): AgentGraph['env'] {
  const isNew = (variable: AgentGraph['env'][number], graph: AgentGraph) => !graph.env.some((other) => other.name === variable.name)
  return [...theirs.env, ...mine.env.filter((variable) => isNew(variable, base) && isNew(variable, theirs))]
}

function buildGraph(versions: { base: AgentGraph; mine: AgentGraph; theirs: AgentGraph }, nodes: GraphNode[], edges: GraphEdge[]): AgentGraph {
  return { ...versions.theirs, env: mergeEnv(versions.base, versions.mine, versions.theirs), nodes, edges }
}

/**
 * Merges my edits (`mine`, made on `base`) onto the builder's newer graph (`theirs`).
 *
 * @param base - The version my edits started from (AgentGraph)
 * @param mine - My working copy (AgentGraph)
 * @param theirs - The newer version (AgentGraph)
 * @param choices - Decisions for conflicting nodes already made (Record<string, ConflictChoice>)
 * @returns The merged graph, the conflicts still open and the nodes re-applied (GraphMergeResult)
 *
 * @example
 * const { merged, conflicts } = mergeGraphEdits(savedGraph, workingGraph, latestGraph)
 * if (conflicts.length === 0) save(merged)
 */
export function mergeGraphEdits(base: AgentGraph, mine: AgentGraph, theirs: AgentGraph, choices: Record<string, ConflictChoice> = {}): GraphMergeResult {
  const [baseNodes, mineNodes, theirNodes] = [byId(base.nodes), byId(mine.nodes), byId(theirs.nodes)]
  const nodeIds = new Set([...baseNodes.keys(), ...mineNodes.keys(), ...theirNodes.keys()])
  const chosen = new Map<string, GraphNode | null>()
  const conflicts: NodeMergeConflict[] = []
  const reappliedNodeIds: string[] = []
  for (const nodeId of nodeIds) {
    const pick = pickNode(nodeId, baseNodes.get(nodeId), mineNodes.get(nodeId), theirNodes.get(nodeId))
    if (pick.kind === 'take') {
      chosen.set(nodeId, pick.node)
      if (pick.fromMine) reappliedNodeIds.push(nodeId)
      continue
    }
    const choice = choices[nodeId]
    if (!choice) conflicts.push(pick.conflict)
    chosen.set(nodeId, choice === 'keep-mine' ? pick.conflict.mine : pick.conflict.theirs)
    if (choice === 'keep-mine') reappliedNodeIds.push(nodeId)
  }
  const nodes = orderNodes(theirs, mine, chosen)
  return { merged: buildGraph({ base, mine, theirs }, nodes, mergeEdges(base, mine, theirs, nodes)), conflicts, reappliedNodeIds }
}

/** Plain words for my waiting edits: "title of Ask a model", "Send WhatsApp message (new)". */
export function describeQueuedEdits(base: AgentGraph, mine: AgentGraph): string[] {
  const baseNodes = byId(base.nodes)
  const mineNodes = byId(mine.nodes)
  const descriptions: string[] = []
  for (const node of mine.nodes) {
    if (node.hidden) continue
    const before = baseNodes.get(node.id)
    if (!before) descriptions.push(`${node.displayTitle} (new)`)
    else if (nodeSignature(before) !== nodeSignature(node)) descriptions.push(`${describeChangedFields(before, node)} of ${before.displayTitle}`)
  }
  for (const node of base.nodes) if (!node.hidden && !mineNodes.has(node.id)) descriptions.push(`${node.displayTitle} (removed)`)
  const baseEdgeKeys = base.edges.map(edgeKey).sort().join('|')
  if (baseEdgeKeys !== mine.edges.map(edgeKey).sort().join('|')) descriptions.push(messages().nodes.theArrows)
  return descriptions
}

function describeChangedFields(before: GraphNode, after: GraphNode): string {
  const fields: string[] = []
  if (before.title !== after.title) fields.push('title')
  if (before.kind !== after.kind) fields.push('action')
  if (JSON.stringify(before.config) !== JSON.stringify(after.config)) fields.push('settings')
  if (JSON.stringify(before.onError) !== JSON.stringify(after.onError)) fields.push(messages().nodes.errorHandling)
  if (JSON.stringify(before.retry) !== JSON.stringify(after.retry)) fields.push('retries')
  if (before.timeoutMs !== after.timeoutMs) fields.push(messages().nodes.timeLimit2)
  if (before.parent !== after.parent) fields.push('place')
  return fields.join(' and ') || 'settings'
}
