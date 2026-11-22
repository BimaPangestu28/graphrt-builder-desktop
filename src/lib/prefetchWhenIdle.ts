/**
 * Loads lazy chunks in the background once the window is idle, one per idle slot, so the
 * first visit to a common screen does not flash its loading state. WKWebView has no
 * `requestIdleCallback`; there a short timeout stands in for it.
 */

/** A dynamic import of a lazily loaded module. */
export type ChunkLoader = () => Promise<unknown>

/** How long to wait for an idle slot where `requestIdleCallback` is missing (ms). */
const fallbackDelayMs = 200

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const idleHandle = window.requestIdleCallback(callback, { timeout: 2000 })
    return () => window.cancelIdleCallback(idleHandle)
  }
  const timeoutHandle = window.setTimeout(callback, fallbackDelayMs)
  return () => window.clearTimeout(timeoutHandle)
}

/**
 * Runs `loaders` one after another, each in its own idle slot.
 *
 * @param loaders - Dynamic imports to warm up, most useful first (ChunkLoader[])
 * @returns A function that stops loading the ones not started yet (() => void)
 *
 * @example
 * useEffect(() => prefetchWhenIdle([() => import('./pages/HomePage')]), [])
 */
export function prefetchWhenIdle(loaders: readonly ChunkLoader[]): () => void {
  let isCancelled = false
  let cancelScheduled = () => {}

  function loadFrom(loaderIndex: number) {
    if (isCancelled || loaderIndex >= loaders.length) return
    cancelScheduled = scheduleIdle(() => {
      loaders[loaderIndex]()
        .catch((loadError: unknown) => {
          // Not fatal: the screen loads its chunk again when it is opened
          console.warn('prefetching a screen failed', loadError)
        })
        .finally(() => loadFrom(loaderIndex + 1))
    })
  }

  loadFrom(0)
  return () => {
    isCancelled = true
    cancelScheduled()
  }
}
