import type { AgentGraph, GraphNode, NodeLayout } from '@/api/agentGraphTypes'
import type { AddNodeAnchor, NodePlacement } from '../contracts'
import { stepNodeSize } from '../flow/autoLayout'
import { addGraphNode, createGraphNode, insertGraphNodeAfter, insertGraphNodeAfterNode, insertGraphNodeOnEdge, uniqueNodeId } from '../graphEdits'
import type { AgentGraphActions } from '../useAgentGraph'
import type { PaletteAction } from './paletteCatalog'

/**
 * Where a palette node goes: the graph edit for its anchor (after a node, on an arrow, at a
 * position) and a position beside its neighbours when they have one. Placement helper the
 * canvas may reuse (spec "Add node after", "+" on an arrow, drop "Insert here").
 */

/** Gap between a node and the one added after it (auto-layout runs left to right). */
const placementGap = 72

/** The new node for an action: readable unique id from its name, empty config. */
export function createPaletteNode(graph: AgentGraph, action: Pick<PaletteAction, 'kind' | 'displayName'>): GraphNode {
  const nodeId = uniqueNodeId(graph, action.displayName || action.kind)
  return createGraphNode({ id: nodeId, kind: action.kind }, action.displayName)
}

/**
 * Applies the anchor's edit to the graph (one function so undo is one step).
 *
 * @param graph - Working copy (AgentGraph)
 * @param node - The new node (GraphNode)
 * @param anchor - Where it goes; null adds it unconnected (AddNodeAnchor | null)
 * @returns The edited graph (AgentGraph)
 */
export function placeNodeInGraph(graph: AgentGraph, node: GraphNode, anchor: AddNodeAnchor | null): AgentGraph {
  if (!anchor) return addGraphNode(graph, node)
  if (anchor.type === 'after-node') return insertGraphNodeAfterNode(graph, node, anchor.nodeId)
  if (anchor.type === 'after-exit') {
    const parent = graph.nodes.find((candidate) => candidate.id === anchor.source)?.parent ?? null
    const placedNode = { ...node, parent }
    if (placedNode.ports.inputs.length === 0) return addGraphNode(graph, placedNode)
    return insertGraphNodeAfter(graph, placedNode, { source: anchor.source, sourceHandle: anchor.sourceHandle })
  }
  if (anchor.type === 'on-edge') return insertGraphNodeOnEdge(graph, node, anchor.edgeId)
  const parentExists = anchor.parentId ? graph.nodes.some((candidate) => candidate.id === anchor.parentId) : false
  return addGraphNode(graph, { ...node, parent: parentExists ? (anchor.parentId ?? null) : null })
}

function layoutBesides(nodeId: string, position: { x: number; y: number }): NodeLayout {
  return { nodeId, x: Math.round(position.x), y: Math.round(position.y), width: null, height: null }
}

/**
 * A position for the new node from its anchor's saved position; null when the anchor has
 * none (auto-layout then places it).
 */
export function layoutForAnchor(graph: AgentGraph, nodeId: string, anchor: AddNodeAnchor | null, positions: Record<string, NodeLayout>): NodeLayout | null {
  if (!anchor) return null
  if (anchor.type === 'at-position') return layoutBesides(nodeId, anchor)
  if (anchor.type === 'after-node' || anchor.type === 'after-exit') {
    const anchorLayout = positions[anchor.type === 'after-node' ? anchor.nodeId : anchor.source]
    if (!anchorLayout) return null
    return layoutBesides(nodeId, { x: anchorLayout.x + (anchorLayout.width ?? stepNodeSize.width) + placementGap, y: anchorLayout.y })
  }
  const edge = graph.edges.find((candidate) => candidate.id === anchor.edgeId)
  const sourceLayout = edge ? positions[edge.source] : undefined
  const targetLayout = edge ? positions[edge.target] : undefined
  if (!sourceLayout || !targetLayout) return null
  return layoutBesides(nodeId, { x: (sourceLayout.x + targetLayout.x) / 2, y: (sourceLayout.y + targetLayout.y) / 2 + stepNodeSize.height })
}

function titleOf(graph: AgentGraph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.displayTitle ?? nodeId
}

/** "after Ask a model", "between Ask a model and Send", "on the canvas". */
export function describeAnchor(graph: AgentGraph, anchor: AddNodeAnchor | null): string {
  if (!anchor) return 'on the canvas'
  if (anchor.type === 'after-node') return `after ${titleOf(graph, anchor.nodeId)}`
  if (anchor.type === 'after-exit') return `after ${titleOf(graph, anchor.source)}`
  if (anchor.type === 'at-position') return anchor.parentId ? `inside ${titleOf(graph, anchor.parentId)}` : 'where you dropped it'
  const edge = graph.edges.find((candidate) => candidate.id === anchor.edgeId)
  return edge ? `between ${titleOf(graph, edge.source)} and ${titleOf(graph, edge.target)}` : 'on the canvas'
}

/** Drops an anchor that points at a node or arrow that no longer exists. */
export function validAnchor(graph: AgentGraph, anchor: AddNodeAnchor | null): AddNodeAnchor | null {
  if (!anchor) return null
  if (anchor.type === 'after-node') return graph.nodes.some((node) => node.id === anchor.nodeId) ? anchor : null
  if (anchor.type === 'after-exit') return graph.nodes.some((node) => node.id === anchor.source) ? anchor : null
  if (anchor.type === 'on-edge') return graph.edges.some((edge) => edge.id === anchor.edgeId) ? anchor : null
  return anchor
}

/**
 * Everything needed to add an action at an anchor.
 *
 * @param graph - Working copy (AgentGraph)
 * @param action - What to add (PaletteAction)
 * @param anchor - Where (AddNodeAnchor | null)
 * @param positions - Saved positions by node id
 * @returns The node, anchor, position and description (NodePlacement)
 */
export function buildNodePlacement(graph: AgentGraph, action: Pick<PaletteAction, 'kind' | 'displayName'>, anchor: AddNodeAnchor | null, positions: Record<string, NodeLayout> = {}): NodePlacement {
  const checkedAnchor = validAnchor(graph, anchor)
  const node = createPaletteNode(graph, action)
  const where = checkedAnchor ? ` ${describeAnchor(graph, checkedAnchor)}` : ''
  return { node, anchor: checkedAnchor, layout: layoutForAnchor(graph, node.id, checkedAnchor, positions), description: `added ${action.displayName}${where}` }
}

/**
 * Applies a placement through the graph controller: node and arrows as one undo step, then
 * its position (positions add no version).
 */
export function applyNodePlacement(controller: Pick<AgentGraphActions, 'applyEdit' | 'moveNodes'>, placement: NodePlacement): void {
  controller.applyEdit((graph) => placeNodeInGraph(graph, placement.node, placement.anchor), placement.description)
  if (placement.layout) controller.moveNodes([placement.layout])
}
