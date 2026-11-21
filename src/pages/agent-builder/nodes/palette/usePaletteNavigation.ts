import { useCallback, useEffect, useState } from 'react'
import type { PaletteAction } from './paletteCatalog'
import { paletteOptionId } from './PaletteOptionRow'

export interface PaletteNavigation {
  activeKind: string | null
  setActiveKind: (kind: string | null) => void
  /** ↑ (-1) / ↓ (+1), wrapping around. */
  moveActive: (step: number) => void
  activeAction: PaletteAction | null
}

/**
 * The highlighted option of the palette (↑ ↓ move it, Enter adds it). Falls back to the
 * first visible option when the highlighted one disappears (new search, collapsed group).
 *
 * @param visibleOptions - Options on screen, in order (PaletteAction[])
 * @returns The highlighted kind and how to move it (PaletteNavigation)
 */
export function usePaletteNavigation(visibleOptions: PaletteAction[]): PaletteNavigation {
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const activeAction = visibleOptions.find((action) => action.kind === activeKind) ?? visibleOptions[0] ?? null

  useEffect(() => {
    if (!activeAction) return
    document.getElementById(paletteOptionId(activeAction.kind))?.scrollIntoView?.({ block: 'nearest' })
  }, [activeAction])

  const moveActive = useCallback(
    (step: number) => {
      if (visibleOptions.length === 0) return
      const currentIndex = activeAction ? visibleOptions.indexOf(activeAction) : -1
      const nextIndex = (currentIndex + step + visibleOptions.length) % visibleOptions.length
      setActiveKind(visibleOptions[nextIndex].kind)
    },
    [visibleOptions, activeAction],
  )

  return { activeKind: activeAction?.kind ?? null, setActiveKind, moveActive, activeAction }
}
