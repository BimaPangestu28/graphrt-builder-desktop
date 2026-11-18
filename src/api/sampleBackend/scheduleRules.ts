import { BackendError } from '../client'
import type { ScheduleRules } from '../scheduleRuleTypes'
import type { Run, RunStatus } from '../types'
import { respondWith } from './sampleResponse'

/**
 * Sample schedule rules and scheduled-run history for the browser preview and tests:
 * the runs on the Scheduler design (screen 10) for the week of 16 Nov 2026, Asia/Jakarta.
 * Agent ids match the sample triggers (`sampleBackend/triggers.ts`).
 */

const defaultRules: ScheduleRules = { maxConcurrentRuns: 2 }
let storedRules: ScheduleRules = { ...defaultRules }

function buildScheduledRun(id: string, agentId: string, startedAt: string, status: RunStatus, outputs: Record<string, unknown> | null = null): Run {
  return {
    id,
    agentId,
    agentVersion: 1,
    trigger: 'schedule',
    status,
    startedAt,
    finishedAt: status === 'paused' ? null : startedAt,
    outputs,
    errorMessage: status === 'failed' ? 'HTTP 401: invalid_grant' : null,
    pauseReasons: null,
  }
}

/** 07:00 Jakarta is 00:00 UTC; 09:00 Jakarta is 02:00 UTC. */
const sampleScheduledRuns: Run[] = [
  buildScheduledRun('morning-digest-monday', 'morning-digest', '2026-11-16T00:00:02Z', 'succeeded'),
  buildScheduledRun('maps-leads-monday', 'maps-leads', '2026-11-16T02:00:01Z', 'succeeded', { messages_sent: 14 }),
  buildScheduledRun('morning-digest-yesterday', 'morning-digest', '2026-11-17T00:00:02Z', 'failed'),
  buildScheduledRun('maps-leads-tuesday', 'maps-leads', '2026-11-17T02:00:01Z', 'succeeded', { messages_sent: 15 }),
  buildScheduledRun('morning-digest-today', 'morning-digest', '2026-11-18T00:00:02Z', 'succeeded'),
  buildScheduledRun('maps-leads-today', 'maps-leads', '2026-11-18T02:00:01Z', 'paused'),
]

/** Puts the sample rules back to the design's values (tests). */
export function resetSampleScheduleRules(): void {
  storedRules = { ...defaultRules }
}

function validateRules(rules: ScheduleRules): ScheduleRules {
  const isWholeNumber = Number.isInteger(rules.maxConcurrentRuns)
  if (!isWholeNumber || rules.maxConcurrentRuns < 1 || rules.maxConcurrentRuns > 16) {
    throw new BackendError('invalid_input', 'agents running at the same time must be between 1 and 16')
  }
  return { ...rules }
}

function listRunsBetween(since: string, until: string): Run[] {
  const sinceTime = Date.parse(since)
  const untilTime = Date.parse(until)
  if (Number.isNaN(sinceTime) || Number.isNaN(untilTime) || untilTime <= sinceTime) {
    throw new BackendError('invalid_input', 'the time window must be positive')
  }
  return sampleScheduledRuns
    .filter((run) => {
      const startedTime = Date.parse(run.startedAt)
      return startedTime >= sinceTime && startedTime < untilTime
    })
    .map((run) => ({ ...run }))
}

export const sampleScheduleRulesBackend = {
  getScheduleRules: (): Promise<ScheduleRules> => respondWith(() => ({ ...storedRules })),
  updateScheduleRules: (rules: ScheduleRules): Promise<ScheduleRules> =>
    respondWith(() => {
      storedRules = validateRules(rules)
      return { ...storedRules }
    }),
  listScheduledRuns: (since: string, until: string): Promise<Run[]> => respondWith(() => listRunsBetween(since, until)),
}
