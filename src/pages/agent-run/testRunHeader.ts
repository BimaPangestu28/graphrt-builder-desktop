import type { Run } from '@/api/types'
import { formatDurationMs, formatElapsedClock } from './runProgress'
import { countTopLevelSteps, type RunStepView } from './runSteps'

/** Header and sidebar texts of the Test run screen (06), from the run and its steps. */

/** Whether the run can still change (the clock ticks, Stop is offered). */
export function isRunActive(run: Run | null): boolean {
  return run === null || run.status === 'running' || run.status === 'paused'
}

function measureElapsedMs(run: Run, now: number): number {
  const endMs = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  return endMs - new Date(run.startedAt).getTime()
}

/**
 * "Running · 0:42 · 2 of 4 steps done", "Failed after 1m 12s · 2 of 4 steps done".
 *
 * @param run - The run, or null before it loaded (Run | null)
 * @param steps - The step list (RunStepView[])
 * @param now - Current time in ms (number)
 */
export function buildRunHeaderMeta(run: Run | null, steps: RunStepView[], now: number): string {
  if (!run) return 'Starting the test…'
  const { doneCount, totalCount } = countTopLevelSteps(steps)
  const countPart = totalCount > 0 ? ` · ${doneCount} of ${totalCount} steps done` : ''
  const elapsedMs = measureElapsedMs(run, now)
  if (run.status === 'running') return `Running · ${formatElapsedClock(elapsedMs)}${countPart}`
  if (run.status === 'paused') return `Waiting for you · ${formatElapsedClock(elapsedMs)}${countPart}`
  if (run.status === 'failed') return `Failed after ${formatDurationMs(elapsedMs)}${countPart}`
  if (run.status === 'aborted') return `Stopped after ${formatDurationMs(elapsedMs)}${countPart}`
  return `Finished in ${formatDurationMs(elapsedMs)}`
}

export interface SidebarRunStatus {
  status: string
  statusTone: 'brand' | 'amber' | 'danger'
}

/** The sidebar's agent status while testing and after the test ended. */
export function buildSidebarRunStatus(run: Run | null): SidebarRunStatus {
  if (run?.status === 'paused') return { status: 'Testing · waiting for you', statusTone: 'amber' }
  if (run?.status === 'failed') return { status: 'Test failed', statusTone: 'danger' }
  if (run?.status === 'aborted') return { status: 'Test stopped', statusTone: 'amber' }
  if (run?.status === 'succeeded') return { status: 'Tested', statusTone: 'brand' }
  return { status: 'Testing', statusTone: 'brand' }
}
