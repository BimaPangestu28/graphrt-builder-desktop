import { getAgent } from '@/api/agents'
import type { Agent } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * One agent by id; loads again when the id changes.
 *
 * @param agentId - Agent to load (string)
 * @returns `{ data: Agent | null, error, isLoading, reload }`; error is a `BackendError` with `not_found` for unknown ids
 */
export function useAgent(agentId: string): AsyncDataState<Agent> {
  return useAsyncData(() => getAgent(agentId), [agentId])
}
