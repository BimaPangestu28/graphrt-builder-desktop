import type { AgentRunStats } from '@/api/runSummaryTypes'
import type { Run, RunStatus } from '@/api/types'
import type { AgentSummaryStat, AttentionItem, RecentRun, RecentRunStatus } from '@/data/homeDashboard'
import { formatCounterLabel, pickHeadlineCounter } from '@/pages/agent-run/runCounters'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { agentPath } from '@/routes'

/** Turns backend runs and run stats into what the Home screen (09) shows. */

/** Looks up an agent's display name by id. */
export type AgentNameLookup = (agentId: string) => string

const lastRunWords: Record<RunStatus, string> = {
  succeeded: 'ok',
  failed: 'failed',
  paused: 'waiting for you',
  running: 'running',
  aborted: 'stopped',
}

const recentRunStatuses: Record<RunStatus, RecentRunStatus> = {
  succeeded: 'Done',
  failed: 'Failed',
  paused: 'Needs you',
  running: 'Running',
  aborted: 'Stopped',
}

/**
 * Stats line of a Home agent card: what it did this week (its main counter, else its run
 * count) and how its last run went.
 *
 * @param stats - The agent's weekly stats, or undefined when unknown (AgentRunStats | undefined)
 * @param now - Reference time for "Today"/"Yesterday" (Date)
 * @returns Up to two stats (AgentSummaryStat[])
 *
 * @example
 * describeAgentRunStats(stats) // [{ count: 12, label: 'messages sent this week' }, { label: 'Last run ok · Today 09:00' }]
 */
export function describeAgentRunStats(stats: AgentRunStats | undefined, now: Date = new Date()): AgentSummaryStat[] {
  if (!stats) return []
  if (stats.runsThisWeek === 0 && !stats.lastRunStatus) return [{ label: 'No runs yet' }]
  const headlineCounter = pickHeadlineCounter(stats.counters)
  const weekStat: AgentSummaryStat = headlineCounter
    ? { count: Math.round(headlineCounter.value), label: `${formatCounterLabel(headlineCounter.name).toLowerCase()} this week` }
    : { count: stats.runsThisWeek, label: stats.runsThisWeek === 1 ? 'run this week' : 'runs this week' }
  if (!stats.lastRunStatus || !stats.lastRunAt) return [weekStat]
  return [weekStat, { label: `Last run ${lastRunWords[stats.lastRunStatus]} · ${formatRunDay(stats.lastRunAt, now)}` }]
}

/** The question a paused run asks (human-input `prompt`, or the sample data's `question`). */
export function readPauseQuestion(run: Run): string | null {
  const pauseData = run.pauseReasons?.[0]?.data
  if (typeof pauseData === 'string') return pauseData
  if (!pauseData || typeof pauseData !== 'object') return null
  const { question, prompt } = pauseData as Record<string, unknown>
  if (typeof question === 'string' && question.length > 0) return question
  return typeof prompt === 'string' && prompt.length > 0 ? prompt : null
}

/**
 * "Needs you" rows for runs paused for approval, each opening the run (06) to answer it.
 *
 * @param pausedRuns - Runs with status `paused`, newest first (Run[])
 * @param agentName - Display name lookup (AgentNameLookup)
 * @param now - Reference time (Date)
 */
export function buildPausedRunItems(pausedRuns: Run[], agentName: AgentNameLookup, now: Date = new Date()): AttentionItem[] {
  return pausedRuns.map((run, index) => {
    const question = readPauseQuestion(run)
    const pausedAt = `${formatRunDay(run.startedAt, now)} run · paused for your review`
    return {
      id: `paused-${run.id}`,
      title: `${agentName(run.agentId)} is waiting for you`,
      detail: question ? `${question} · ${pausedAt}` : pausedAt,
      actionLabel: 'Review',
      actionPath: agentPath('testRun', run.agentId, { runId: run.id }),
      isPrimaryAction: index === 0,
    }
  })
}

function describeRunResult(run: Run): string {
  const summary = run.outputs?.summary
  if (run.status === 'failed') return run.errorMessage ?? 'Failed'
  if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim()
  if (run.status === 'paused') return readPauseQuestion(run) ?? 'Waiting for you'
  if (run.status === 'running') return 'Still running'
  if (run.status === 'aborted') return 'Stopped'
  return 'Finished'
}

/**
 * Recent runs table rows: agent, start time, the run's summary headline and its status.
 *
 * @param runs - Newest first (Run[])
 * @param agentName - Display name lookup (AgentNameLookup)
 * @param now - Reference time (Date)
 */
export function buildRecentRunRows(runs: Run[], agentName: AgentNameLookup, now: Date = new Date()): RecentRun[] {
  return runs.map((run) => ({
    id: run.id,
    agentName: agentName(run.agentId),
    startedAt: formatRunDay(run.startedAt, now),
    resultSummary: describeRunResult(run),
    status: recentRunStatuses[run.status],
  }))
}
