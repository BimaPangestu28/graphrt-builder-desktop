import { useMemo, useState } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { readPendingApprovals } from '@/api/pauseReasons'
import type { PendingApproval } from '@/api/runReviewTypes'
import { useLiveBrowserFrames } from '@/hooks/useLiveBrowserFrames'
import { pickStepLiveViews } from '@/pages/agent-run/liveBrowserFrames'
import { isRunActive } from '@/pages/agent-run/testRunHeader'
import type { RunStepView } from '@/pages/agent-run/runSteps'
import { buildRunCanvasState, type RunCanvasState } from './nodeRunStates'
import { useNodesTestRun, type NodesTestRun } from './useNodesTestRun'

/** Everything the Nodes view needs to show a run on the canvas. */
export interface NodesLiveRun {
  testRun: NodesTestRun
  /** Node and arrow states of the shown run; null when none is shown. */
  runState: RunCanvasState | null
  approvals: PendingApproval[]
  liveViews: Map<string, string | null>
  isActive: boolean
  /** The node whose question is open (Review), or null. */
  reviewNodeId: string | null
  setReviewNodeId: (nodeId: string | null) => void
}

/**
 * Follows the run shown on the canvas and maps it onto the graph's nodes.
 *
 * @param options.agentId - Agent (string)
 * @param options.graph - The graph on the canvas, or null while loading (AgentGraph | null)
 * @param options.initialRunId - Run to show first (string | null)
 * @returns The run, its canvas state, questions and live browser pictures (NodesLiveRun); the
 *   clock lives in `CanvasClockProvider`, ticking while `isActive`
 */
export function useNodesLiveRun({ agentId, graph, initialRunId }: { agentId: string; graph: AgentGraph | null; initialRunId?: string | null }): NodesLiveRun {
  const testRun = useNodesTestRun({ agentId, initialRunId, inputs: graph?.inputs ?? [] })
  const [reviewNodeId, setReviewNodeId] = useState<string | null>(null)
  const { run, events } = testRun.liveRun
  const isActive = testRun.runId !== null && isRunActive(run)
  const approvals = useMemo(() => readPendingApprovals(run), [run])
  const runState = useMemo(() => (graph && testRun.runId ? buildRunCanvasState(graph, events, approvals) : null), [graph, testRun.runId, events, approvals])
  const hasRunningStep = Boolean(runState && Object.values(runState.nodes).some((view) => view.status === 'running'))
  const frames = useLiveBrowserFrames(isActive && hasRunningStep)
  const liveViews = useMemo(() => {
    if (!runState) return new Map<string, string | null>()
    const steps = Object.values(runState.nodes).flatMap((view) => (view.step ? [view.step] : [])) as RunStepView[]
    return pickStepLiveViews(steps, frames)
  }, [runState, frames])
  return { testRun, runState, approvals, liveViews, isActive, reviewNodeId, setReviewNodeId }
}
