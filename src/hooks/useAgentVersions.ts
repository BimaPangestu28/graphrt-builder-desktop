import { listAgentVersions } from '@/api/agents'
import type { AgentVersion } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * Saved versions of an agent, newest first.
 *
 * @param agentId - Agent whose history to load (string)
 * @returns `{ data: AgentVersion[] | null, error, isLoading, reload }` (AsyncDataState<AgentVersion[]>)
 */
export function useAgentVersions(agentId: string): AsyncDataState<AgentVersion[]> {
  return useAsyncData(() => listAgentVersions(agentId), [agentId])
}
