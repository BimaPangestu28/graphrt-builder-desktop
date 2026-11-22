import { useCallback, useState } from 'react'
import type { AgentGraph, CanvasViewport, NodeLayout, NodeLayoutSet } from '@/api/agentGraphTypes'

/**
 * Node positions and the viewport of the Nodes view. They are saved on their own (no new
 * version, not undoable), so they live apart from the graph history; `isLayoutDirty` tells
 * the view's layout autosave that something moved since the last save.
 */

export function positionsById(layouts: NodeLayout[]): Record<string, NodeLayout> {
  return Object.fromEntries(layouts.map((layout) => [layout.nodeId, layout]))
}

/** The positions of the nodes `graph` still has (removed steps drop out). */
export function layoutFor(graph: AgentGraph, positions: Record<string, NodeLayout>): NodeLayout[] {
  return graph.nodes.flatMap((node) => (positions[node.id] ? [positions[node.id]] : []))
}

export interface NodePositions {
  positions: Record<string, NodeLayout>
  viewport: CanvasViewport | null
  isLayoutDirty: boolean
  /** Records moved nodes locally. */
  moveNodes: (layouts: NodeLayout[]) => void
  setViewport: (viewport: CanvasViewport) => void
  /** Shows a loaded layout as it is saved. */
  showSavedLayout: (layout: NodeLayoutSet) => void
  /** Adds the positions of a newer version under mine: steps the builder added get its positions, mine stay. */
  addLatestPositions: (layouts: NodeLayout[]) => void
  /** Shows the positions as just saved. */
  markLayoutSaved: (layouts?: NodeLayout[]) => void
}

/** @returns Positions, viewport and their setters (NodePositions) */
export function useNodePositions(): NodePositions {
  const [positions, setPositions] = useState<Record<string, NodeLayout>>({})
  const [viewport, setViewportState] = useState<CanvasViewport | null>(null)
  const [isLayoutDirty, setIsLayoutDirty] = useState(false)

  const moveNodes = useCallback((layouts: NodeLayout[]) => {
    if (layouts.length === 0) return
    setPositions((current) => ({ ...current, ...positionsById(layouts) }))
    setIsLayoutDirty(true)
  }, [])

  const setViewport = useCallback((nextViewport: CanvasViewport) => {
    setViewportState(nextViewport)
    setIsLayoutDirty(true)
  }, [])

  const showSavedLayout = useCallback((layout: NodeLayoutSet) => {
    setPositions(positionsById(layout.nodes))
    setViewportState(layout.viewport)
    setIsLayoutDirty(false)
  }, [])

  const addLatestPositions = useCallback((layouts: NodeLayout[]) => setPositions((current) => ({ ...positionsById(layouts), ...current })), [])

  const markLayoutSaved = useCallback((layouts?: NodeLayout[]) => {
    if (layouts) setPositions(positionsById(layouts))
    setIsLayoutDirty(false)
  }, [])

  return { positions, viewport, isLayoutDirty, moveNodes, setViewport, showSavedLayout, addLatestPositions, markLayoutSaved }
}
