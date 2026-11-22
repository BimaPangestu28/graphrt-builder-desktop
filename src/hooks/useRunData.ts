import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { subscribeToRunEvents } from '@/api/runs'
import type { RunEventPayload } from '@/api/types'
import { toError } from '@/lib/errors'

/** State of a backend read: the latest data, the last error, and whether a load is in flight. */
export interface LoadedData<Data> {
  data: Data | null
  error: Error | null
  isLoading: boolean
  /** Loads again, keeping the current data on screen meanwhile. */
  reload: () => void
  /** Replaces the data locally, e.g. after an optimistic update. */
  setData: (update: (current: Data | null) => Data | null) => void
}

/**
 * Loads data from the backend when `dependencies` change. Results of stale loads
 * (dependencies changed meanwhile, or the component unmounted) are ignored.
 *
 * @param loadData - Returns the promise to wait for (() => Promise<Data>)
 * @param dependencies - Reload whenever one of these changes (DependencyList)
 * @returns The data, error and loading state (LoadedData<Data>)
 *
 * @example
 * const { data: runs, error } = useLoadedData(() => listRuns({ agentId }), [agentId])
 */
export function useLoadedData<Data>(loadData: () => Promise<Data>, dependencies: DependencyList): LoadedData<Data> {
  const [data, setDataState] = useState<Data | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)
  const loadDataRef = useRef(loadData)
  loadDataRef.current = loadData

  useEffect(() => {
    let isCurrent = true
    setIsLoading(true)
    loadDataRef
      .current()
      .then((loadedData) => {
        if (!isCurrent) return
        setDataState(loadedData)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(toError(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => {
      isCurrent = false
    }
    // The caller lists what the load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadCount])

  const reload = useCallback(() => setReloadCount((count) => count + 1), [])
  const setData = useCallback((update: (current: Data | null) => Data | null) => setDataState(update), [])
  return { data, error, isLoading, reload, setData }
}

/**
 * Calls `onRunEvent` for every live run event while mounted; unsubscribes on unmount.
 * The latest callback is always used, so it may close over fresh state.
 */
export function useRunEventSubscription(onRunEvent: (payload: RunEventPayload) => void): void {
  const onRunEventRef = useRef(onRunEvent)
  onRunEventRef.current = onRunEvent

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let isMounted = true
    subscribeToRunEvents((payload) => onRunEventRef.current(payload))
      .then((unsubscribeFromRuns) => {
        if (isMounted) unsubscribe = unsubscribeFromRuns
        else unsubscribeFromRuns()
      })
      .catch((subscribeError: unknown) => console.error('Could not listen to run events', subscribeError))
    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [])
}
