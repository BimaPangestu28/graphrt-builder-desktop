import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentGraph, GraphNode, NodeLayout } from '@/api/agentGraphTypes'
import { computeAutoLayout, containerMinimumSize, endNodeSize, flowDirectionOf, isEndPillNode, markerNodeSize, mergeLayouts, stepNodeSize } from './autoLayout'
import { findFreePosition, insertionShift, isPastSpot, placeNewNode, placementGap, rectsOverlap, spotAfter, type CanvasPoint, type CanvasRect } from './placement'
import { cardHeightFor } from './nodeGeometry'

/**
 * Where every node is drawn. ELK places the nodes without a saved position once per
 * loaded version (so a chat change gets a fresh layout); after that, a step added on
 * the canvas is placed next to the step it follows (or in the middle of the view),
 * nudged into free space, and its position is reported so it stays put. Nothing else
 * moves unless Auto-layout is run from the toolbar.
 */

/** Measured sizes by node id, from React Flow's dimension changes. */
export type MeasuredSizes = Map<string, { width: number; height: number }>

/** Nominal size of a node before React Flow has measured it. */
export function nominalSizeOf(node: GraphNode, layout?: NodeLayout): { width: number; height: number } {
  if (node.hidden) return markerNodeSize
  if (isEndPillNode(node)) return endNodeSize
  if (node.container) return { width: layout?.width ?? containerMinimumSize.width, height: layout?.height ?? containerMinimumSize.height }
  return { width: stepNodeSize.width, height: Math.max(stepNodeSize.height, cardHeightFor(node.ports.outputs.length)) }
}

function rectOf(node: GraphNode, layout: NodeLayout, measured: MeasuredSizes): CanvasRect {
  const size = node.container ? nominalSizeOf(node, layout) : (measured.get(node.id) ?? nominalSizeOf(node, layout))
  return { x: layout.x, y: layout.y, ...size }
}

export interface PlacementInput {
  graph: AgentGraph
  /** Positions known so far (saved, moved, auto-laid out). */
  known: Record<string, NodeLayout>
  measured: MeasuredSizes
  /** Where a step without an anchor goes (top-level: the middle of the view). */
  fallback: CanvasPoint
}

/** True when `node` was put between two steps: it has an arrow on to a placed sibling. */
function isInsertedBetween(graph: AgentGraph, node: GraphNode, placed: Record<string, NodeLayout>): boolean {
  return graph.edges.some((edge) => edge.source === node.id && placed[edge.target] && graph.nodes.find((other) => other.id === edge.target)?.parent === node.parent)
}

/**
 * Where a new step goes and which siblings move: a step inserted between two steps takes
 * the spot after the first and pushes the steps past it along (so the flow stays straight);
 * any other step goes after its anchor (or at the fallback), nudged into free space.
 */
function placeOneNode(graph: AgentGraph, node: GraphNode, placed: Record<string, NodeLayout>, measured: MeasuredSizes, fallback: CanvasPoint): { point: CanvasPoint; moved: NodeLayout[] } {
  const siblings = graph.nodes.filter((other) => other.id !== node.id && other.parent === node.parent && placed[other.id])
  const occupied = siblings.map((sibling) => rectOf(sibling, placed[sibling.id], measured))
  const incoming = graph.edges.find((edge) => edge.target === node.id && placed[edge.source] && graph.nodes.find((other) => other.id === edge.source)?.parent === node.parent)
  const anchorNode = incoming ? graph.nodes.find((other) => other.id === incoming.source) : undefined
  const anchor = anchorNode ? rectOf(anchorNode, placed[anchorNode.id], measured) : null
  const size = nominalSizeOf(node)
  const direction = flowDirectionOf(node)
  const containerFallback = { x: placementGap, y: 72 }
  if (!anchor || !anchorNode || !isInsertedBetween(graph, node, placed)) return { point: placeNewNode(anchor, size, occupied, node.parent ? containerFallback : fallback, direction), moved: [] }
  const spot = spotAfter(anchor, size, direction)
  if (!occupied.some((rect) => rectsOverlap({ ...spot, ...size }, rect, placementGap - 1))) return { point: spot, moved: [] }
  const shift = insertionShift(size, direction)
  const movedSiblings = siblings.filter((sibling) => sibling.id !== anchorNode.id && isPastSpot(rectOf(sibling, placed[sibling.id], measured), spot, direction))
  const moved = movedSiblings.map((sibling) => ({ ...placed[sibling.id], x: Math.round(placed[sibling.id].x + shift.x), y: Math.round(placed[sibling.id].y + shift.y) }))
  const movedIds = new Set(moved.map((layout) => layout.nodeId))
  const stillOccupied = [
    ...siblings.filter((sibling) => !movedIds.has(sibling.id)).map((sibling) => rectOf(sibling, placed[sibling.id], measured)),
    ...movedSiblings.map((sibling, siblingIndex) => rectOf(sibling, moved[siblingIndex], measured)),
  ]
  return { point: findFreePosition(spot, size, stillOccupied, direction), moved }
}

/** The container's layout grown to hold `children` (null when they fit). */
function grownContainer(graph: AgentGraph, containerId: string, placed: Record<string, NodeLayout>, children: NodeLayout[]): NodeLayout | null {
  const container = placed[containerId]
  const containerNode = graph.nodes.find((other) => other.id === containerId)
  if (!container || !containerNode) return null
  const containerSize = nominalSizeOf(containerNode, container)
  let neededWidth = containerSize.width
  let neededHeight = containerSize.height
  for (const child of children) {
    const childNode = graph.nodes.find((other) => other.id === child.nodeId)
    const childSize = childNode ? nominalSizeOf(childNode, child) : stepNodeSize
    neededWidth = Math.max(neededWidth, child.x + childSize.width + placementGap)
    neededHeight = Math.max(neededHeight, child.y + childSize.height + placementGap)
  }
  if (neededWidth === containerSize.width && neededHeight === containerSize.height) return null
  return { ...container, width: neededWidth, height: neededHeight }
}

/**
 * Positions for the nodes of `graph` that `known` lacks, each after the step it follows
 * and clear of its siblings (a step inserted between two pushes the later ones along);
 * containers grow to fit new children.
 *
 * @returns Layouts for the new nodes, the steps moved to make room and the grown containers (NodeLayout[])
 */
export function placeUnplacedNodes({ graph, known, measured, fallback }: PlacementInput): NodeLayout[] {
  const placed: Record<string, NodeLayout> = { ...known }
  const results = new Map<string, NodeLayout>()
  const record = (layout: NodeLayout) => {
    placed[layout.nodeId] = layout
    results.set(layout.nodeId, layout)
  }
  for (const node of graph.nodes) {
    if (placed[node.id]) continue
    const { point, moved } = placeOneNode(graph, node, placed, measured, fallback)
    const size = nominalSizeOf(node)
    const layout: NodeLayout = { nodeId: node.id, x: Math.round(point.x), y: Math.round(point.y), width: node.container ? size.width : null, height: node.container ? size.height : null }
    for (const movedLayout of moved) record(movedLayout)
    record(layout)
    if (!node.parent) continue
    const grown = grownContainer(graph, node.parent, placed, [layout, ...moved])
    if (grown) record(grown)
  }
  return [...results.values()]
}

/**
 * ELK positions for one loaded version (recomputed when the version or agent changes).
 * While a newer version of the same agent is laid out, the previous layout stays, so the
 * canvas never blanks (and React Flow never remounts) after a save.
 */
function useVersionAutoLayout(graph: AgentGraph): NodeLayout[] | null {
  const [autoLayout, setAutoLayout] = useState<{ key: string; agentId: string; layouts: NodeLayout[] } | null>(null)
  const versionKey = `${graph.agentId}@${graph.version}`
  const graphRef = useRef(graph)
  graphRef.current = graph
  useEffect(() => {
    let isCurrent = true
    const laidOutGraph = graphRef.current
    computeAutoLayout(laidOutGraph)
      .then((layouts) => isCurrent && setAutoLayout({ key: versionKey, agentId: laidOutGraph.agentId, layouts }))
      .catch((layoutError: unknown) => {
        console.warn('auto-layout failed, placing nodes in a row', layoutError)
        if (isCurrent) setAutoLayout({ key: versionKey, agentId: laidOutGraph.agentId, layouts: laidOutGraph.nodes.map((node, nodeIndex) => ({ nodeId: node.id, x: nodeIndex * 300, y: 0 })) })
      })
    return () => {
      isCurrent = false
    }
  }, [versionKey])
  return autoLayout && (autoLayout.key === versionKey || autoLayout.agentId === graph.agentId) ? autoLayout.layouts : null
}

export interface CanvasLayoutState {
  /** Every node's position (null until the first auto-layout ran). */
  mergedPositions: Record<string, NodeLayout> | null
}

/**
 * Merged positions for the canvas, reporting placements of new nodes through
 * `onPlaced` (they become ordinary moved positions).
 */
export function useCanvasLayout(options: {
  graph: AgentGraph
  positions: Record<string, NodeLayout>
  measured: MeasuredSizes
  getFallbackPoint: () => CanvasPoint
  onPlaced: (layouts: NodeLayout[]) => void
}): CanvasLayoutState {
  const { graph, positions, measured, getFallbackPoint, onPlaced } = options
  const autoLayouts = useVersionAutoLayout(graph)
  const known = useMemo(() => (autoLayouts ? mergeLayouts(autoLayouts, positions) : null), [autoLayouts, positions])
  const placements = useMemo(() => {
    if (!known) return []
    const nodeIds = new Set(graph.nodes.map((node) => node.id))
    const knownForGraph = Object.fromEntries(Object.entries(known).filter(([nodeId]) => nodeIds.has(nodeId)))
    // Saved positions of nodes ELK has not seen (added since this version loaded) count as known too.
    for (const node of graph.nodes) if (!knownForGraph[node.id] && positions[node.id]) knownForGraph[node.id] = positions[node.id]
    return placeUnplacedNodes({ graph, known: knownForGraph, measured, fallback: getFallbackPoint() })
    // `measured` and the fallback are read at placement time only; they do not trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, known, positions])
  const mergedPositions = useMemo(() => {
    if (!known) return null
    const merged = { ...known }
    for (const node of graph.nodes) if (!merged[node.id] && positions[node.id]) merged[node.id] = positions[node.id]
    for (const layout of placements) merged[layout.nodeId] = layout
    return merged
  }, [known, graph, positions, placements])

  const onPlacedRef = useRef(onPlaced)
  onPlacedRef.current = onPlaced
  useEffect(() => {
    if (placements.length > 0) onPlacedRef.current(placements)
  }, [placements])

  return { mergedPositions }
}
