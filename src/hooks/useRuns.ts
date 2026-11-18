import { listRunEvents, listRuns } from '@/api/runs'
import type { Run, RunEventRecord, RunFilter } from '@/api/types'
import { useLoadedData, useRunEventSubscription, type LoadedData } from './useRunData'

/** Event types that change a run's row in a list. */
const listRefreshEventTypes = new Set(['status_changed', 'run_started'])

/**
 * Runs matching `filter`, newest first, reloaded whenever a run starts or changes status.
 *
 * @param filter - Agent, status and limit (RunFilter)
 * @returns The runs and load state (LoadedData<Run[]>)
 */
export function useRuns(filter: RunFilter = {}): LoadedData<Run[]> {
  const { agentId, status, limit } = filter
  const loadedRuns = useLoadedData(() => listRuns({ agentId, status, limit }), [agentId, status, limit])
  useRunEventSubscription((payload) => {
    if (listRefreshEventTypes.has(payload.event.type)) loadedRuns.reload()
  })
  return loadedRuns
}

/**
 * The stored event log of one run (for detail panels), reloaded on new events of that run.
 *
 * @param runId - Run to read, or null for none (string | null)
 */
export function useRunEvents(runId: string | null): LoadedData<RunEventRecord[]> {
  const loadedEvents = useLoadedData(() => (runId ? listRunEvents(runId) : Promise.resolve([])), [runId])
  useRunEventSubscription((payload) => {
    if (payload.runId === runId) loadedEvents.reload()
  })
  return loadedEvents
}
