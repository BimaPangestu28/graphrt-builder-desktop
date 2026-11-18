import { useCallback, useEffect, useRef, useState } from 'react'
import { getRun, listRunEvents, subscribeToRunEvents } from '@/api/runs'
import type { Run, RunEventPayload, RunEventRecord } from '@/api/types'
import { toError } from './useRunData'

/** A run kept up to date with its live events. */
export interface LiveRun {
  run: Run | null
  /** Every event so far, ordered by `seq`, without duplicates. */
  events: RunEventRecord[]
  error: Error | null
  isLoading: boolean
}

/** Event types after which the stored run (pause reasons, outputs, error) is read again. */
const runRefreshEventTypes = new Set(['status_changed', 'run_paused', 'run_succeeded', 'run_failed', 'run_aborted'])

/**
 * Merges two event lists by `seq`, dropping duplicates (a live event can also be in the loaded list).
 *
 * @example
 * mergeRunEvents([{ seq: 1 }, { seq: 2 }], [{ seq: 2 }, { seq: 3 }]) // seq 1, 2, 3
 */
export function mergeRunEvents(currentEvents: RunEventRecord[], incomingEvents: RunEventRecord[]): RunEventRecord[] {
  const eventsBySeq = new Map<number, RunEventRecord>()
  for (const event of [...currentEvents, ...incomingEvents]) eventsBySeq.set(event.seq, event)
  return [...eventsBySeq.values()].sort((first, second) => first.seq - second.seq)
}

function toEventRecord(payload: RunEventPayload): RunEventRecord {
  return { runId: payload.runId, seq: payload.seq, event: payload.event, createdAt: new Date().toISOString() }
}

/**
 * Follows one run: loads it with {@link getRun} and {@link listRunEvents}, then applies live
 * `run-event`s for that run. The subscription starts before the first load so no event is missed,
 * and ends on unmount or when `runId` changes. Status changes reload the run for pause reasons
 * and outputs.
 *
 * @param runId - Run to follow, or null to follow nothing (string | null)
 * @returns The run, its events and the load state (LiveRun)
 *
 * @example
 * const { run, events } = useRunLive(searchParams.get('runId'))
 */
export function useRunLive(runId: string | null): LiveRun {
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<RunEventRecord[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(runId !== null)
  const latestRunIdRef = useRef(runId)
  latestRunIdRef.current = runId

  const refreshRun = useCallback((runIdToRefresh: string) => {
    getRun(runIdToRefresh)
      .then((loadedRun) => {
        if (latestRunIdRef.current === runIdToRefresh) setRun(loadedRun)
      })
      .catch((refreshError: unknown) => {
        if (latestRunIdRef.current === runIdToRefresh) setError(toError(refreshError))
      })
  }, [])

  useEffect(() => {
    setRun(null)
    setEvents([])
    setError(null)
    if (!runId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    let isCurrent = true
    let unsubscribe: (() => void) | null = null

    const handleRunEvent = (payload: RunEventPayload) => {
      if (!isCurrent || payload.runId !== runId) return
      setEvents((currentEvents) => mergeRunEvents(currentEvents, [toEventRecord(payload)]))
      setRun((currentRun) => (currentRun ? { ...currentRun, status: payload.status } : currentRun))
      if (runRefreshEventTypes.has(payload.event.type)) refreshRun(runId)
    }

    subscribeToRunEvents(handleRunEvent)
      .then((unsubscribeFromRuns) => {
        if (isCurrent) unsubscribe = unsubscribeFromRuns
        else unsubscribeFromRuns()
      })
      .catch((subscribeError: unknown) => {
        if (isCurrent) setError(toError(subscribeError))
      })

    Promise.all([getRun(runId), listRunEvents(runId)])
      .then(([loadedRun, loadedEvents]) => {
        if (!isCurrent) return
        setRun(loadedRun)
        setEvents((liveEvents) => mergeRunEvents(loadedEvents, liveEvents))
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(toError(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
      unsubscribe?.()
    }
  }, [runId, refreshRun])

  return { run, events, error, isLoading }
}
