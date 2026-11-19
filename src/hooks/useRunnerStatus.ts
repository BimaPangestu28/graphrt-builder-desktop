import { listTriggers } from '@/api/triggers'
import type { ModelChoice, Trigger } from '@/api/types'
import { readDefaultModelOrNull } from './useDefaultModel'
import { useLoadedData, useRunEventSubscription, type LoadedData } from './useRunData'

/** What the sidebar's runner card says about this computer. */
export interface RunnerStatusFacts {
  /** The model new agents use; null when no provider is connected. */
  defaultModel: ModelChoice | null
  /** Agents with at least one schedule switched on. */
  scheduledAgentCount: number
}

/**
 * Counts agents with at least one enabled trigger.
 *
 * @param triggers - Every trigger (Trigger[])
 * @returns Distinct agents with a schedule on (number)
 */
export function countScheduledAgents(triggers: Trigger[]): number {
  return new Set(triggers.filter((trigger) => trigger.enabled).map((trigger) => trigger.agentId)).size
}

async function loadRunnerStatusFacts(): Promise<RunnerStatusFacts> {
  const [defaultModel, triggers] = await Promise.all([readDefaultModelOrNull(), listTriggers()])
  return { defaultModel, scheduledAgentCount: countScheduledAgents(triggers) }
}

/**
 * Default model and scheduled agents for the runner card. Reloads when `refreshKey` changes
 * (the sidebar passes the route, so a schedule or key saved on another screen shows up on
 * the next navigation) and whenever a run changes status. Keeps the last answer on screen
 * while reloading.
 *
 * @param refreshKey - Any value whose change should reload (string)
 * @returns The facts; `data` is null until the first load (LoadedData<RunnerStatusFacts>)
 */
export function useRunnerStatus(refreshKey: string): LoadedData<RunnerStatusFacts> {
  const loadedFacts = useLoadedData(loadRunnerStatusFacts, [refreshKey])
  useRunEventSubscription((payload) => {
    if (payload.event.type === 'status_changed') loadedFacts.reload()
  })
  return loadedFacts
}
