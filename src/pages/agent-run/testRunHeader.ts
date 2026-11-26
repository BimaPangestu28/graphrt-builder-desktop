import type { Run } from '@/api/types'
import { formatDurationMs, formatElapsedClock } from './runProgress'
import { countTopLevelSteps, type RunStepView } from './runSteps'
import { messages } from '@/i18n'

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
  const t = messages().agentRun
  if (!run) return t.startingTest
  const { doneCount, totalCount } = countTopLevelSteps(steps)
  const countPart = totalCount > 0 ? t.stepsDoneOf(doneCount, totalCount) : ''
  const elapsedMs = measureElapsedMs(run, now)
  if (run.status === 'running') return t.headerRunning(formatElapsedClock(elapsedMs), countPart)
  if (run.status === 'paused') return t.headerWaiting(formatElapsedClock(elapsedMs), countPart)
  if (run.status === 'failed') return t.headerFailed(formatDurationMs(elapsedMs), countPart)
  if (run.status === 'aborted') return t.headerStopped(formatDurationMs(elapsedMs), countPart)
  return t.finishedIn(formatDurationMs(elapsedMs))
}

export interface SidebarRunStatus {
  status: string
  statusTone: 'brand' | 'amber' | 'danger'
}

/** The sidebar's agent status while testing and after the test ended. */
export function buildSidebarRunStatus(run: Run | null): SidebarRunStatus {
  const t = messages().agentRun
  if (run?.status === 'paused') return { status: t.sidebarTestingWaiting, statusTone: 'amber' }
  if (run?.status === 'failed') return { status: t.sidebarTestFailed, statusTone: 'danger' }
  if (run?.status === 'aborted') return { status: t.sidebarTestStopped, statusTone: 'amber' }
  if (run?.status === 'succeeded') return { status: t.sidebarTested, statusTone: 'brand' }
  return { status: t.sidebarTesting, statusTone: 'brand' }
}
