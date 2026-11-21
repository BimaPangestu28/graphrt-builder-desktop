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
}

const noop = () => undefined

export const CanvasNodeActionsContext = createContext<CanvasNodeActions>({ openNodeMenu: noop, startKeyboardConnect: noop, resizeContainer: noop })

export function useCanvasNodeActions(): CanvasNodeActions {
  return useContext(CanvasNodeActionsContext)
}

/** At or below this zoom, cards show only their logo and title (spec I1 "Zoomed out"). */
export const compactZoomThreshold = 0.4
