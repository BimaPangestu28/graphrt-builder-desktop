import { getFlowSummary } from '@/api/builder'
import { isDesktopApp } from '@/api/client'
import { sampleApprovalNodeId } from '@/api/sampleBackend/runs'
import { testRunSteps } from '@/data/testRun'
import { useLoadedData } from '@/hooks/useRunData'
import type { RunStepTemplate } from './runProgress'

/**
 * Steps of the sample "Maps leads to WhatsApp" test, with the node ids the sample backend's
 * scripted run emits. Labels come from the screen 06 mock.
 */
const sampleNodeIds = ['ask_input', 'search_maps', 'write_message', sampleApprovalNodeId, 'send_whatsapp']
export const sampleRunStepTemplate: RunStepTemplate[] = testRunSteps.map((step, index) => ({ id: sampleNodeIds[index] ?? step.id, label: step.label }))

/**
 * The steps a test run is expected to go through, so not-yet-started steps can be listed.
 * In the desktop app they come from the agent's flow summary; the browser preview uses the sample steps.
 * If the flow summary is empty or fails, the list is built from events alone.
 */
export function useRunStepTemplate(agentId: string): RunStepTemplate[] {
  const { data: flowSummary } = useLoadedData(
    () => (isDesktopApp() ? getFlowSummary(agentId) : Promise.resolve(null)),
    [agentId],
  )
  if (!isDesktopApp()) return sampleRunStepTemplate
  return flowSummary?.steps.map((step) => ({ id: step.id, label: step.title })) ?? []
}
