import { getFlowSummary } from '@/api/builder'
import { useLoadedData } from '@/hooks/useRunData'

export { toRunStepTemplate } from './runProgress'

/**
 * Loads the agent's flow summary: its steps (listed before they run, see `toRunStepTemplate`)
 * and its start inputs. If it is empty or fails, run screens build the step list from events alone.
 */
export function useAgentFlowSummary(agentId: string) {
  return useLoadedData(() => getFlowSummary(agentId), [agentId])
}
