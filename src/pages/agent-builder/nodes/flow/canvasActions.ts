import { createContext, useContext } from 'react'
import type { NodeLayout } from '@/api/agentGraphTypes'

/**
 * What node renderers can ask the canvas to do, handed down through context so the
 * memoised node components do not re-render when a callback changes.
 */
export interface CanvasNodeActions {
  /** Opens the node's context menu at a screen point (right-click, Shift F10). */
  openNodeMenu: (nodeId: string, screenPoint: { x: number; y: number }) => void
  /** Starts drawing an arrow from a port with the keyboard (Enter on a port). */
  startKeyboardConnect: (nodeId: string, handleId: string) => void
  /** A container was resized (position may move when resized from the left or top). */
  resizeContainer: (layout: NodeLayout) => void
  /** The "+" on an arrow: opens the Add node palette to insert a step on it. Absent when read-only. */
  addNodeOnEdge?: (edgeId: string) => void
}

const noop = () => undefined

export const CanvasNodeActionsContext = createContext<CanvasNodeActions>({ openNodeMenu: noop, startKeyboardConnect: noop, resizeContainer: noop })

/**
 * The loop a dragged step would land in, while it is dragged over one: the container
 * highlights (brand when the move is allowed, red with the reason when not).
 */
export interface ContainerDropHint {
  containerId: string
  allowed: boolean
  /** Why the step cannot go in; null when it can. */
  reason: string | null
}

export const ContainerDropHintContext = createContext<ContainerDropHint | null>(null)

export function useContainerDropHint(containerId: string): ContainerDropHint | null {
  const hint = useContext(ContainerDropHintContext)
  return hint?.containerId === containerId ? hint : null
}

export function useCanvasNodeActions(): CanvasNodeActions {
  return useContext(CanvasNodeActionsContext)
}

/** Below this zoom, cards show only their logo and title (spec I1 "Zoomed out": below 60%). */
export const compactZoomThreshold = 0.6
