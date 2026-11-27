import type { Run, RunEventRecord, RunFilter, RunStatus as BackendRunStatus, RunTrigger } from '@/api/types'
import type { RunRecord, RunStatus as RunsScreenStatus, RunStep } from '@/pages/runs/runRecordTypes'
import { agentPath, routePaths, runReviewPath } from '@/routes'
import { readRunAnswer } from '@/pages/agent-run/runAnswer'
import { humanizeRunError } from '@/pages/agent-run/runErrorText'
import { readPauseDeadline, readPauseQuestion } from '@/pages/agent-run/runPauseQuestion'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { formatAiCost, formatClockTime, formatRunDay, formatRunDuration } from '@/pages/agent-run/runResultSummary'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/**
 * Maps backend runs and their events onto the Runs screen's (20) `RunRecord`, so the table and
 * detail panel keep their look.
 */

/** Status filter chips of the Runs screen. */
export type RunsStatusFilter = 'all' | Exclude<RunsScreenStatus, 'done' | 'stopped'>

const backendStatusByFilter: Record<Exclude<RunsStatusFilter, 'all'>, BackendRunStatus> = {
  needsYou: 'paused',
  running: 'running',
  failed: 'failed',
}

const screenStatusByBackendStatus: Record<BackendRunStatus, RunsScreenStatus> = {
  running: 'running',
  paused: 'needsYou',
  succeeded: 'done',
  failed: 'failed',
  // The user stopped it: neutral "Stopped", not a failure.
  aborted: 'stopped',
}

const startedByLabels: Readonly<Record<RunTrigger, string>> = localizedRecord(() => messages().runs.startedBy)

const fallbackResultByStatus: Readonly<Record<BackendRunStatus, string>> = localizedRecord(() => messages().runs.fallbackResult)

/** The Runs screen's status word for a backend status (`paused` -> `needsYou`, `aborted` -> `stopped`). */
export function toScreenStatus(status: BackendRunStatus): RunsScreenStatus {
  return screenStatusByBackendStatus[status]
}

/** Value of the agent select meaning "every agent". */
export const allAgentsFilterValue = 'all'

/**
 * Builds the backend filter for the agent select and status chips.
 *
 * @example
 * toRunFilter('maps-leads', 'needsYou') // { agentId: 'maps-leads', status: 'paused' }
 */
export function toRunFilter(agentFilter: string, statusFilter: RunsStatusFilter): RunFilter {
  return {
    agentId: agentFilter === allAgentsFilterValue ? undefined : agentFilter,
    status: statusFilter === 'all' ? undefined : backendStatusByFilter[statusFilter],
  }
}

/** How many of `runs` the status chip would show; null for "All". */
export function countRunsForFilter(runs: Run[], statusFilter: RunsStatusFilter): number | null {
  if (statusFilter === 'all') return null
  return runs.filter((run) => run.status === backendStatusByFilter[statusFilter]).length
}

/** Runs that are over: only those can be rated. */
const ratedStatuses = new Set<BackendRunStatus>(['succeeded', 'failed', 'aborted'])

function readOutputText(run: Run, key: string): string | null {
  const outputValue = run.outputs?.[key]
  return typeof outputValue === 'string' && outputValue.length > 0 ? outputValue : null
}

function buildTiming(run: Run, now: Date): string {
  const dayLabel = formatRunDay(run.startedAt, now)
  const t = messages().runs
  if (run.status === 'running') return t.soFar(dayLabel, formatRunDuration(run.startedAt, now.toISOString()) ?? '')
  if (run.status === 'paused') return t.waitingForYou(dayLabel)
  const duration = formatRunDuration(run.startedAt, run.finishedAt)
  const aiCostUsd = run.outputs?.aiCostUsd
  const costPart = typeof aiCostUsd === 'number' ? t.aiCost(formatAiCost(aiCostUsd)) : ''
  return `${dayLabel}${duration ? ` · ${duration}` : ''}${costPart}`
}

function buildFollowUp(run: Run): RunRecord['followUp'] {
  const t = messages().runs
  if (run.status === 'failed') return { label: t.seeWhatWentWrong, path: `${routePaths.errorStates}?${new URLSearchParams({ runId: run.id })}` }
  if (run.status === 'paused' && run.trigger === 'test') return { label: t.continueTest, path: agentPath('testRun', run.agentId, { runId: run.id }) }
  if (run.status === 'paused' && run.trigger === 'schedule') return { label: t.review, path: runReviewPath(run.id) }
  if (run.status === 'paused') return { label: t.openInInbox, path: routePaths.chatDetail }
  if (run.status === 'succeeded' && run.trigger === 'test') return { label: t.openTestResult, path: agentPath('runResult', run.agentId, { runId: run.id }) }
  return undefined
}

/**
 * What the Result column says: the run's summary headline; else, for a failed run, the error in
 * plain words (as on Home) with the raw text as the title; else the question a paused run asks;
 * else a word for its status.
 *
 * @example
 * describeRunResult(dnsFailedRun)
 * // { result: "Could not reach the server: that address doesn't exist", resultTitle: 'connection: iteration item 0 failed: …' }
 */
export function describeRunResult(run: Run): Pick<RunRecord, 'result' | 'resultTitle'> {
  const summary = readOutputText(run, 'summary')
  if (summary) return { result: summary, resultTitle: summary }
  if (run.status === 'failed' && run.errorMessage) return { result: humanizeRunError(run.errorMessage, null, run.errorType).summary, resultTitle: run.errorMessage }
  const question = run.status === 'paused' ? readPauseQuestion(run) : null
  const deadline = run.status === 'paused' ? readPauseDeadline(run, Date.now()) : null
  if (question) return { result: deadline ? `${question} · ${deadline}` : question, resultTitle: question }
  return { result: fallbackResultByStatus[run.status] }
}

/**
 * One table row (and the detail panel's header) for a backend run. Steps and the raw log come
 * from {@link withRunEvents}.
 *
 * @param run - The backend run (Run)
 * @param agentName - Display name of its agent (string)
 * @param now - Reference time for "Today", "Yesterday" and "so far" (Date)
 */
export function toRunRecord(run: Run, agentName: string, now: Date = new Date()): RunRecord {
  const { result, resultTitle } = describeRunResult(run)
  return {
    id: run.id,
    agentId: run.agentId,
    agentName,
    startedBy: startedByLabels[run.trigger],
    when: formatRunDay(run.startedAt, now),
    startedAt: run.startedAt,
    duration: formatRunDuration(run.startedAt, run.finishedAt) ?? undefined,
    place: 'local',
    result,
    resultTitle,
    status: toScreenStatus(run.status),
    timing: buildTiming(run, now),
    steps: [],
    // What the agent answered, in full; else why it failed, what it asks, or the Result column's words.
    output: readRunAnswer(run.outputs) ?? run.errorMessage ?? readPauseQuestion(run) ?? result,
    canRate: ratedStatuses.has(run.status),
    rawLog: [],
    followUp: buildFollowUp(run),
  }
}

function formatLogClock(isoTimestamp: string): string {
  const instant = new Date(isoTimestamp)
  return `${formatClockTime(isoTimestamp)}:${String(instant.getSeconds()).padStart(2, '0')}`
}

function describeLogEvent({ event }: RunEventRecord): string {
  if (typeof event.message === 'string') return event.message
  const nodePart = event.node_id ? ` ${event.node_id}` : ''
  const detailPart = typeof event.detail === 'string' ? `: ${event.detail}` : ''
  return `${event.type}${nodePart}${detailPart}`
}

/** One line per event, "HH:MM:SS message", like the runner's log. */
export function buildRawLog(events: RunEventRecord[]): string[] {
  return events.filter(({ event }) => event.type !== 'status_changed').map((record) => `${formatLogClock(record.createdAt)} ${describeLogEvent(record)}`)
}

/** Steps for the CSV export: one per node shown as a step, done when it succeeded. */
export function buildRunSteps(events: RunEventRecord[]): RunStep[] {
  return buildRunStepViews([], events).map((step) => ({
    label: step.label,
    detail: step.detail ?? (step.state === 'running' ? messages().runs.running : ''),
    isDone: step.state === 'done' || step.state === 'skipped',
  }))
}

/** Adds the steps and raw log of `events` to a record. */
export function withRunEvents(record: RunRecord, events: RunEventRecord[]): RunRecord {
  return { ...record, steps: buildRunSteps(events), rawLog: buildRawLog(events) }
}
