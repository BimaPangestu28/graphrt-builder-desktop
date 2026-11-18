import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

/** What every data hook returns. `data` stays on screen while a reload is running. */
export interface AsyncDataState<Data> {
  data: Data | null
  error: Error | null
  isLoading: boolean
  /** Loads again; resolves once the new data (or error) is in state. */
  reload: () => Promise<void>
}

function toError(rawError: unknown): Error {
  if (rawError instanceof Error) return rawError
  return new Error(typeof rawError === 'string' ? rawError : 'Something went wrong')
}

/**
 * Loads data with `loadData` when the component mounts and whenever `dependencies`
 * change. Responses that arrive after a newer request started, or after unmount,
 * are ignored, so a slow answer never overwrites a fresher one.
 *
 * @param loadData - Async loader, e.g. `() => getAgent(agentId)` (() => Promise<Data>)
 * @param dependencies - Values the loader reads; a change triggers a new load (DependencyList)
 * @returns `{ data, error, isLoading, reload }` (AsyncDataState<Data>)
 *
 * @example
 * const { data: agent, error, isLoading } = useAsyncData(() => getAgent(agentId), [agentId])
 */
export function useAsyncData<Data>(loadData: () => Promise<Data>, dependencies: DependencyList): AsyncDataState<Data> {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const latestRequestIdRef = useRef(0)
  const isMountedRef = useRef(true)
  // The caller lists what the loader depends on, like useEffect.
  const stableLoadData = useCallback(loadData, dependencies)

  const reload = useCallback(async () => {
    latestRequestIdRef.current += 1
    const requestId = latestRequestIdRef.current
    const isLatestRequest = () => isMountedRef.current && requestId === latestRequestIdRef.current
    setIsLoading(true)
    try {
      const loadedData = await stableLoadData()
      if (!isLatestRequest()) return
      setData(loadedData)
      setError(null)
    } catch (rawError) {
      if (!isLatestRequest()) return
      setError(toError(rawError))
    } finally {
      if (isLatestRequest()) setIsLoading(false)
    }
  }, [stableLoadData])

  useEffect(() => {
    isMountedRef.current = true
    // New dependencies mean different data: never show the previous one meanwhile.
    setData(null)
    setError(null)
    void reload()
    return () => {
      isMountedRef.current = false
    }
  }, [reload])

  return { data, error, isLoading, reload }
}
