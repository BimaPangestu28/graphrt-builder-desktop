import { createContext, useContext, type ReactNode } from 'react'
import { useNow } from '@/hooks/useNow'

/**
 * The ticking clock of the Nodes view, kept in its own context.
 *
 * While a run is active the clock changes every second. If it lived in `NodesView` state
 * or in the node decorations, every tick would re-render the view, the canvas and every
 * node card. Here only the components that show a live time (the elapsed time of a running
 * step, a question's deadline, the run bar) call {@link useCanvasNow}, so a tick re-renders
 * just those leaves.
 */

/** Null outside a provider: readers then use the time of their render. */
const CanvasClockContext = createContext<number | null>(null)

export interface CanvasClockProviderProps {
  /** Whether the clock advances (a run is active); it keeps the last value otherwise. */
  isTicking: boolean
  children: ReactNode
}

/** Owns the clock; its `children` element does not re-render when the time changes. */
export function CanvasClockProvider({ isTicking, children }: CanvasClockProviderProps) {
  const now = useNow(isTicking)
  return <CanvasClockContext.Provider value={now}>{children}</CanvasClockContext.Provider>
}

/** Current time in ms, as of the last tick of the surrounding {@link CanvasClockProvider}. */
export function useCanvasNow(): number {
  return useContext(CanvasClockContext) ?? Date.now()
}
