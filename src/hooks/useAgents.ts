import { listAgents } from '@/api/agents'
import type { Agent } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * Every agent, most recently updated first.
 *
 * @returns `{ data: Agent[] | null, error, isLoading, reload }` (AsyncDataState<Agent[]>)
 */
export function useAgents(): AsyncDataState<Agent[]> {
  return useAsyncData(listAgents, [])
}
