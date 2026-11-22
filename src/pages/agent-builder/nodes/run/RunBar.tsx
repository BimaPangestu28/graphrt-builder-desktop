import { Link } from 'react-router-dom'
import type { AgentGraph } from '@/api/agentGraphTypes'
import type { Run } from '@/api/types'
import { joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { formatDurationMs, formatElapsedClock, formatElapsedSince } from '@/pages/agent-run/runProgress'
import { describeCurrentItem, type RunCanvasState } from './nodeRunStates'
import { useCanvasNow } from './CanvasClock'
import type { NodesLiveRun } from './useNodesLiveRun'

/**
 * The bar above the canvas while a run is shown (spec 35, 36, 44): status, elapsed time and
 * progress ("Running · 0:14 · 1 of 7 steps done", "Waiting for you · 1:48 · business 3 of 10",
 * "Running · 6:12 · 2 handled errors so far"), the run picker, Steps view and Stop run.
 */

const barButtonClassNames = 'inline-flex h-7 cursor-pointer items-center rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium !text-ink no-underline hover:bg-subtle disabled:cursor-default disabled:opacity-50'

function RunStatus({ run }: { run: Run | null }) {
  if (run?.status === 'paused') return <StatusPill tone="amber" size="card">Waiting for you</StatusPill>
  if (run?.status === 'failed') return <StatusPill tone="danger" size="card">Failed</StatusPill>
  if (run?.status === 'aborted') return <StatusPill tone="neutral" size="card">Stopped</StatusPill>
  if (run?.status === 'succeeded') return <StatusPill tone="ok" size="card">Succeeded</StatusPill>
  return <StatusPill tone="neutral" size="card">Running</StatusPill>
}

/** "Running · 0:42", "Waiting for you · 1:48", "Failed after 12.3s", "Finished in 1m 05s". */
function describeElapsed(run: Run, now: number): string {
  const elapsedMs = (run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.startedAt)
  switch (run.status) {
    case 'paused':
      return `Waiting for you · ${formatElapsedClock(elapsedMs)}`
    case 'failed':
      return `Failed after ${formatDurationMs(elapsedMs)}`
    case 'aborted':
      return `Stopped after ${formatDurationMs(elapsedMs)}`
    case 'succeeded':
      return `Finished in ${formatDurationMs(elapsedMs)}`
    default:
      return `Running · ${formatElapsedClock(elapsedMs)}`
  }
}

/**
 * The run bar's meta line.
 *
 * @example
 * describeRunMeta(run, graph, runState, now) // "Waiting for you · 1:48 · business 3 of 10"
 */
export function describeRunMeta(run: Run | null, graph: AgentGraph, runState: RunCanvasState | null, now: number): string {
  if (!run || !runState) return 'Starting the test…'
  const isActive = run.status === 'running' || run.status === 'paused'
  const parts = [describeElapsed(run, now)]
  const currentItem = isActive ? describeCurrentItem(graph, runState) : null
  if (runState.handledErrorCount > 0) parts.push(`${runState.handledErrorCount === 1 ? '1 handled error' : `${runState.handledErrorCount} handled errors`}${isActive ? ' so far' : ''}`)
  else if (currentItem) parts.push(currentItem)
  else if (runState.totalCount > 0) parts.push(`${runState.doneCount} of ${runState.totalCount} steps done`)
  return parts.join(' · ')
}

function describeRunOption(run: Run, now: number): string {
  const trigger = run.trigger === 'test' ? 'Test' : run.trigger === 'schedule' ? 'Scheduled run' : 'Run'
  const status = { running: 'running', paused: 'waiting', succeeded: 'succeeded', failed: 'failed', aborted: 'stopped' }[run.status]
  return `${trigger} · ${formatElapsedSince(run.startedAt, new Date(now))} · ${status} · v${run.agentVersion}`
}

interface RunBarProps {
  agentId: string
  graph: AgentGraph
  live: NodesLiveRun
}

export function RunBar({ agentId, graph, live }: RunBarProps) {
  const { testRun, runState, isActive } = live
  const now = useCanvasNow()
  const { run } = testRun.liveRun
  if (!testRun.runId) return null
  const stepsViewPath = isActive || !run ? agentPath('testRun', agentId, { runId: testRun.runId }) : agentPath('runResult', agentId, { runId: testRun.runId })
  const isOtherVersion = run !== null && run.agentVersion !== graph.version
  return (
    <div role="region" aria-label="Test run" className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-1.5 text-[12px]">
      <span className="font-semibold text-ink">Test run</span>
      <RunStatus run={run} />
      <span role="status" className="min-w-0 truncate text-muted">
        {describeRunMeta(run, graph, runState, now)}
        {isOtherVersion ? ` · ran v${run.agentVersion}` : ''}
      </span>
      {testRun.actionError && <span className="text-danger">{describeError(testRun.actionError)}</span>}
      <span className="flex-1" />
      <label className="flex items-center gap-1 text-muted">
        <span className="sr-only">Show run</span>
        <select
          value={testRun.runId}
          onChange={(event) => testRun.selectRun(event.target.value || null)}
          className="h-7 max-w-[220px] rounded-md border border-line-strong bg-surface px-1.5 text-[12px] text-ink"
        >
          {!testRun.recentRuns.some((recentRun) => recentRun.id === testRun.runId) && <option value={testRun.runId}>This run</option>}
          {testRun.recentRuns.map((recentRun) => (
            <option key={recentRun.id} value={recentRun.id}>
              {describeRunOption(recentRun, now)}
            </option>
          ))}
        </select>
      </label>
      <Link to={stepsViewPath} className={barButtonClassNames}>
        Steps view
      </Link>
      {isActive ? (
        <button type="button" onClick={() => void testRun.stopRun()} className={joinClassNames(barButtonClassNames, 'text-danger')}>
          Stop run
        </button>
      ) : (
        <button type="button" onClick={() => testRun.selectRun(null)} className={barButtonClassNames}>
          Hide run
        </button>
      )}
    </div>
  )
}
