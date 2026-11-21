import { useCallback, useState } from 'react'
import type { MinimapPreference } from './useCanvasViewportFit'

/**
 * The person's minimap choice in the Nodes canvas: shown, hidden, or "auto" (shown when
 * the canvas is big enough). Remembered per viewer in localStorage; storage can be
 * missing or blocked, so every access is guarded and the canvas works without it.
 */

/** localStorage key ("shown" / "hidden"; absent means auto). */
export const minimapStorageKey = 'graphrt.nodes.minimap'

/** The stored choice, or "auto". */
export function readMinimapPreference(): MinimapPreference {
  try {
    const stored = window.localStorage.getItem(minimapStorageKey)
    return stored === 'shown' || stored === 'hidden' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

/** Stores the choice; a blocked storage only means it is not remembered. */
export function writeMinimapPreference(preference: MinimapPreference): void {
  try {
    if (preference === 'auto') window.localStorage.removeItem(minimapStorageKey)
    else window.localStorage.setItem(minimapStorageKey, preference)
  } catch {
    // Private windows and blocked site data: the choice lasts for this page only.
  }
}

/**
 * The minimap choice with a setter that remembers it.
 *
 * @returns The current choice and a setter ([MinimapPreference, (next: MinimapPreference) => void])
 */
export function useMinimapPreference(): [MinimapPreference, (next: MinimapPreference) => void] {
  const [preference, setPreference] = useState<MinimapPreference>(readMinimapPreference)
  const update = useCallback((next: MinimapPreference) => {
    setPreference(next)
    writeMinimapPreference(next)
  }, [])
  return [preference, update]
}
