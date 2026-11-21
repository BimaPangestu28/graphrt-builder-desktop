import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentGraph, GraphNode, NodeLayout } from '@/api/agentGraphTypes'
import { computeAutoLayout, containerMinimumSize, flowDirectionOf, markerNodeSize, mergeLayouts, stepNodeSize } from './autoLayout'
import { placeNewNode, placementGap, type CanvasPoint, type CanvasRect } from './placement'
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

/**
 * Positions for the nodes of `graph` that `known` lacks, each right of the step it
 * follows and clear of its siblings; containers grow to fit new children.
 *
 * @returns Layouts for the newly placed nodes and the containers that grew (NodeLayout[])
 */
export function placeUnplacedNodes({ graph, known, measured, fallback }: PlacementInput): NodeLayout[] {
  const placed: Record<string, NodeLayout> = { ...known }
  const results: NodeLayout[] = []
  for (const node of graph.nodes) {
    if (placed[node.id]) continue
    const siblings = graph.nodes.filter((other) => other.id !== node.id && other.parent === node.parent && placed[other.id])
    const occupied = siblings.map((sibling) => rectOf(sibling, placed[sibling.id], measured))
    const incoming = graph.edges.find((edge) => edge.target === node.id && placed[edge.source] && graph.nodes.find((other) => other.id === edge.source)?.parent === node.parent)
    const anchorNode = incoming ? graph.nodes.find((other) => other.id === incoming.source) : undefined
    const anchor = anchorNode ? rectOf(anchorNode, placed[anchorNode.id], measured) : null
    const size = nominalSizeOf(node)
    const containerFallback = { x: placementGap, y: 72 }
    const point = placeNewNode(anchor, size, occupied, node.parent ? containerFallback : fallback, flowDirectionOf(node))
    const layout: NodeLayout = { nodeId: node.id, x: Math.round(point.x), y: Math.round(point.y), width: node.container ? size.width : null, height: node.container ? size.height : null }
    placed[node.id] = layout
    results.push(layout)
    if (node.parent && placed[node.parent]) {
      const container = placed[node.parent]
      const containerNode = graph.nodes.find((other) => other.id === node.parent) as GraphNode
      const containerSize = nominalSizeOf(containerNode, container)
      const neededWidth = layout.x + size.width + placementGap
      const neededHeight = layout.y + size.height + placementGap
      if (neededWidth > containerSize.width || neededHeight > containerSize.height) {
        const grown = { ...container, width: Math.max(containerSize.width, neededWidth), height: Math.max(containerSize.height, neededHeight) }
        placed[node.parent] = grown
        results.push(grown)
      }
    }
  }
  return results
}

/** ELK positions for one loaded version (recomputed when the version or agent changes). */
function useVersionAutoLayout(graph: AgentGraph): NodeLayout[] | null {
  const [autoLayout, setAutoLayout] = useState<{ key: string; layouts: NodeLayout[] } | null>(null)
  const versionKey = `${graph.agentId}@${graph.version}`
  const graphRef = useRef(graph)
  graphRef.current = graph
  useEffect(() => {
    let isCurrent = true
    const laidOutGraph = graphRef.current
    computeAutoLayout(laidOutGraph)
      .then((layouts) => isCurrent && setAutoLayout({ key: versionKey, layouts }))
      .catch((layoutError: unknown) => {
        console.warn('auto-layout failed, placing nodes in a row', layoutError)
        if (isCurrent) setAutoLayout({ key: versionKey, layouts: laidOutGraph.nodes.map((node, nodeIndex) => ({ nodeId: node.id, x: nodeIndex * 300, y: 0 })) })
      })
    return () => {
      isCurrent = false
    }
  }, [versionKey])
  return autoLayout && autoLayout.key === versionKey ? autoLayout.layouts : null
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
