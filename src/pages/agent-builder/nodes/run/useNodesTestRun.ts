import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowInput } from '@/api/types'
import { answerApprovals, getLastRunInputs } from '@/api/runReview'
import type { ApprovalAnswer, PendingApproval } from '@/api/runReviewTypes'
import { abortRun, listRuns, startRun, subscribeToRunEvents } from '@/api/runs'
import type { Run } from '@/api/types'
import { useRunLive, type LiveRun } from '@/hooks/useRunLive'
import { toError } from '@/lib/errors'

/**
 * The run shown on the Nodes canvas: a test started from the Nodes view, a test of this agent
 * that starts elsewhere while the view is open, the newest test still running when it opens,
 * or a past run picked in the run bar. Follows it live with {@link useRunLive}.
 */

/** How many recent runs the run bar offers. */
export const recentRunLimit = 8

export interface NodesTestRun {
  /** The run on the canvas, or null. */
  runId: string | null
  liveRun: LiveRun
  /** The agent's newest runs, newest first (the run bar's picker). */
  recentRuns: Run[]
  selectRun: (runId: string | null) => void
  /** Starts a test of the current version with the last run's inputs (or the defaults). */
  startTest: () => Promise<TestStartResult>
  stopRun: () => Promise<void>
  answerApproval: (approval: PendingApproval, answer: ApprovalAnswer) => Promise<void>
  isStarting: boolean
  isAnswering: boolean
  /** The last start, stop or answer that failed. */
  actionError: Error | null
}

/** The started run, or why it did not start. */
export interface TestStartResult {
  run: Run | null
  error: Error | null
}

export interface UseNodesTestRunOptions {
  agentId: string
  /** A run to show from the start (the page's `runId`). */
  initialRunId?: string | null
  /** The graph's start inputs, for their defaults when the agent never ran. */
  inputs: FlowInput[]
}

function defaultInputs(inputs: FlowInput[]): Record<string, unknown> {
  return Object.fromEntries(inputs.flatMap((input) => (input.defaultValue === undefined ? [] : [[input.name, input.defaultValue]])))
}

const activeStatuses = new Set(['running', 'paused'])

/** Recent runs of the agent, and following a test that starts while the view is open. */
function useRecentRuns(agentId: string, onTestStarted: (runId: string) => void) {
  const [recentRuns, setRecentRuns] = useState<Run[]>([])
  const onTestStartedRef = useRef(onTestStarted)
  onTestStartedRef.current = onTestStarted

  const reloadRuns = useCallback(async () => {
    try {
      const runs = await listRuns({ agentId, limit: recentRunLimit })
      setRecentRuns(runs)
      return runs
    } catch (listError) {
      console.warn('could not list the recent runs of the agent', listError)
      return []
    }
  }, [agentId])

  useEffect(() => {
    let isCurrent = true
    let unsubscribe: (() => void) | null = null
    void subscribeToRunEvents((payload) => {
      if (payload.agentId !== agentId) return
      if (payload.event.type === 'run_started' && payload.event.resumed !== true) onTestStartedRef.current(payload.runId)
      if (payload.event.type === 'run_started' || payload.event.type === 'status_changed') void reloadRuns()
    }).then((stop) => {
      if (isCurrent) unsubscribe = stop
      else stop()
    })
    return () => {
      isCurrent = false
      unsubscribe?.()
    }
  }, [agentId, reloadRuns])

  return { recentRuns, reloadRuns }
}

/**
 * @param options.agentId - Agent whose runs to show (string)
 * @param options.initialRunId - Run to show first, if any (string | null)
 * @param options.inputs - Start inputs of the graph, for defaults (FlowInput[])
 * @returns The shown run, its live events and the run actions (NodesTestRun)
 *
 * @example
 * const testRun = useNodesTestRun({ agentId: agent.id, inputs: graph.inputs })
 * await testRun.startTest()
 */
export function useNodesTestRun({ agentId, initialRunId = null, inputs }: UseNodesTestRunOptions): NodesTestRun {
  const [runId, setRunId] = useState<string | null>(initialRunId)
  const [isStarting, setIsStarting] = useState(false)
  const [isAnswering, setIsAnswering] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs
  const liveRun = useRunLive(runId)
  const { recentRuns, reloadRuns } = useRecentRuns(agentId, setRunId)

  // When the view opens on a test that is still going, show it.
  useEffect(() => {
    let isCurrent = true
    void reloadRuns().then((runs) => {
      const activeTest = runs.find((run) => run.trigger === 'test' && activeStatuses.has(run.status))
      if (isCurrent && activeTest) setRunId((current) => current ?? activeTest.id)
    })
    return () => {
      isCurrent = false
    }
  }, [reloadRuns])

  useEffect(() => setRunId(initialRunId), [initialRunId])

  const selectRun = useCallback((nextRunId: string | null) => {
    setActionError(null)
    setRunId(nextRunId)
  }, [])

  const startTest = useCallback(async () => {
    setIsStarting(true)
    setActionError(null)
    try {
      const lastInputs = await getLastRunInputs(agentId).catch(() => null)
      const startedRun = await startRun(agentId, 'test', lastInputs ?? defaultInputs(inputsRef.current))
      setRunId(startedRun.id)
      void reloadRuns()
      return { run: startedRun, error: null }
    } catch (startError) {
      const error = toError(startError)
      setActionError(error)
      return { run: null, error }
    } finally {
      setIsStarting(false)
    }
  }, [agentId, reloadRuns])

  const stopRun = useCallback(async () => {
    if (!runId) return
    try {
      await abortRun(runId)
    } catch (stopError) {
      setActionError(toError(stopError))
    }
  }, [runId])

  const answerApproval = useCallback(
    async (approval: PendingApproval, answer: ApprovalAnswer) => {
      if (!runId) return
      setIsAnswering(true)
      setActionError(null)
      try {
        await answerApprovals(runId, { [approval.resumeKey]: answer })
      } catch (answerError) {
        setActionError(toError(answerError))
      } finally {
        setIsAnswering(false)
      }
    },
    [runId],
  )

  return { runId, liveRun, recentRuns, selectRun, startTest, stopRun, answerApproval, isStarting, isAnswering, actionError }
}
