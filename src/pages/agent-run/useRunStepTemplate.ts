import { getFlowSummary } from '@/api/builder'
import type { FlowSummary } from '@/api/types'
import { useLoadedData } from '@/hooks/useRunData'
import type { RunStepTemplate } from './runProgress'

/** The steps of a flow summary as a run's expected steps. */
export function toRunStepTemplate(flowSummary: FlowSummary | null): RunStepTemplate[] {
  return flowSummary?.steps.map((step) => ({ id: step.id, label: step.title })) ?? []
}

/**
 * Loads the agent's flow summary: its steps (listed before they run, see {@link toRunStepTemplate})
 * and its start inputs. If it is empty or fails, run screens build the step list from events alone.
 */
export function useAgentFlowSummary(agentId: string) {
  return useLoadedData(() => getFlowSummary(agentId), [agentId])
}
