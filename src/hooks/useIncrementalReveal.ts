import { useCallback, useEffect, useState } from 'react'

/** How many items a long list shows at first, and how many more each time the reader nears its end. */
export const defaultRevealPageSize = 24

/** How far below the window the end of the list may still be when the next page is added (px). */
const revealAheadMarginPx = 600

/**
 * How many items to show after revealing one more page, never past the total.
 *
 * @example
 * nextRevealCount(24, 60, 24) // 48
 * nextRevealCount(48, 60, 24) // 60
 */
export function nextRevealCount(currentCount: number, totalCount: number, pageSize: number): number {
  return Math.min(totalCount, Math.max(currentCount, 0) + pageSize)
}

/**
 * How many items are shown right now: one page after the list (or its filters) changed,
 * else what was revealed so far, never past the total.
 *
 * @example
 * shownRevealCount({ resetKey: 'q=mail', count: 72 }, 'q=mail', 100, 24) // 72
 * shownRevealCount({ resetKey: 'q=mail', count: 72 }, 'q=maps', 100, 24) // 24
 */
export function shownRevealCount(revealed: RevealedCount, resetKey: string, totalCount: number, pageSize: number): number {
  const count = revealed.resetKey === resetKey ? revealed.count : pageSize
  return Math.min(totalCount, count)
}

export interface RevealedCount {
  /** The filters the count belongs to. */
  resetKey: string
  count: number
}

export interface IncrementalReveal {
  /** How many items to render from the start of the list. */
  visibleCount: number
  /** Whether items are still hidden below the last one shown. */
  hasMore: boolean
  /** Shows the next page now (the "Show more" fallback, and tests). */
  revealMore: () => void
  /** Put on an element after the last item: the next page is added as it nears the window. */
  sentinelRef: (element: HTMLElement | null) => void
}

/**
 * Renders a long list a page at a time: the first `pageSize` items, then the next page each
 * time the sentinel after the last item comes within reach of the window. Changing `resetKey`
 * (the filters) goes back to the first page. Where IntersectionObserver is missing nothing is
 * added on scroll, so the list should also offer `revealMore` as a button.
 *
 * @param totalCount - Items in the whole (already filtered) list (number)
 * @param resetKey - Changes whenever the list's filters change (string)
 * @param pageSize - Items per page (number)
 * @returns What to render and the sentinel ref (IncrementalReveal)
 */
export function useIncrementalReveal(totalCount: number, resetKey: string, pageSize: number = defaultRevealPageSize): IncrementalReveal {
  const [revealed, setRevealed] = useState<RevealedCount>({ resetKey, count: pageSize })
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  // New filters start from the first page. Storing that now (React's "adjust state while
  // rendering") keeps an old count from coming back when the filters return to earlier ones.
  if (revealed.resetKey !== resetKey) setRevealed({ resetKey, count: pageSize })
  const visibleCount = shownRevealCount(revealed, resetKey, totalCount, pageSize)
  const hasMore = visibleCount < totalCount

  const revealMore = useCallback(() => {
    setRevealed((current) => {
      const currentCount = shownRevealCount(current, resetKey, totalCount, pageSize)
      return { resetKey, count: nextRevealCount(currentCount, totalCount, pageSize) }
    })
  }, [resetKey, totalCount, pageSize])

  // A new observer after every page: its first callback says whether the sentinel is still
  // in reach (a tall window can show several pages), which a kept observer would not repeat.
  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealMore()
      },
      { rootMargin: `0px 0px ${revealAheadMarginPx}px 0px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, hasMore, visibleCount, revealMore])

  return { visibleCount, hasMore, revealMore, sentinelRef: setSentinel }
}
