import { getFlowSummary } from '@/api/builder'
import type { FlowSummary } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * Steps, inputs and model providers of an agent's current version.
 *
 * @param agentId - Agent whose flow to summarize (string)
 * @returns `{ data: FlowSummary | null, error, isLoading, reload }` (AsyncDataState<FlowSummary>)
 */
export function useFlowSummary(agentId: string): AsyncDataState<FlowSummary> {
  return useAsyncData(() => getFlowSummary(agentId), [agentId])
}
