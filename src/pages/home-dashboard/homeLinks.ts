import type { Run } from '@/api/types'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { agentPath, routePaths, runReviewPath } from '@/routes'

/** Where Home sends the user for a run or a failure, and how it says when a run started. */

/**
 * "When something goes wrong" (23) for one failed run.
 *
 * @example
 * failedRunPath('r1') // "/runs/problems?runId=r1"
 */
export function failedRunPath(runId: string): string {
  return `${routePaths.errorStates}?${new URLSearchParams({ runId })}`
}

/**
 * The screen that shows a run: failures → what went wrong; test runs → the test screen
 * (the result screen once they succeeded); paused runs → the review screen; anything else →
 * Runs with the run selected.
 *
 * @param run - The run (Run)
 * @returns The route (string)
 */
export function runPathFor(run: Run): string {
  if (run.status === 'failed') return failedRunPath(run.id)
  if (run.trigger === 'test') {
    return run.status === 'succeeded' ? agentPath('runResult', run.agentId, { runId: run.id }) : agentPath('testRun', run.agentId, { runId: run.id })
  }
  if (run.status === 'paused') return runReviewPath(run.id)
  return `${routePaths.runs}?${new URLSearchParams({ runId: run.id })}`
}

/**
 * "just now", "5 min ago", "3 h ago" within the last 12 hours, then "Today 07:00",
 * "Yesterday 07:00" or "16 Nov 07:00".
 *
 * @param isoTimestamp - RFC 3339 time in the past (string)
 * @param now - Reference time (Date)
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const elapsedMinutes = Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / 60_000)
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`
  if (elapsedMinutes < 12 * 60) return `${Math.floor(elapsedMinutes / 60)} h ago`
  return formatRunDay(isoTimestamp, now)
}

/**
 * Newest run of each agent, from runs listed newest first.
 *
 * @param runs - Runs, newest first (Run[])
 * @returns Agent id → its latest run (Map<string, Run>)
 */
export function findLatestRunByAgent(runs: Run[]): Map<string, Run> {
  const latestRuns = new Map<string, Run>()
  for (const run of runs) {
    if (!latestRuns.has(run.agentId)) latestRuns.set(run.agentId, run)
  }
  return latestRuns
}
