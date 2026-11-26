import type { Run, RunStatus, Trigger } from '@/api/types'
import type { PastRun, RunOutcome, ScheduleTrigger } from '@/lib/scheduleCalendar'
import { describeCronSchedule, formatZonedIsoDate, parseCronExpression } from '@/lib/schedule'
import { messages } from '@/i18n'

/**
 * Maps backend triggers onto the Scheduler screen's (10) `ScheduleTrigger`, so the trigger list and
 * calendar keep their look. A trigger's cron expression becomes the calendar recurrence, which is what
 * draws its planned runs.
 */

/**
 * One trigger row and its calendar recurrence.
 *
 * @param trigger - Backend trigger (Trigger)
 * @param agentName - Display name of its agent (string)
 * @param shortName - Name inside calendar blocks; defaults to the agent name (string, optional)
 */
export function toScheduleTrigger(trigger: Trigger, agentName: string, shortName: string = agentName): ScheduleTrigger {
  const recurrence = parseCronExpression(trigger.cronExpression)
  return {
    id: trigger.id,
    agentName,
    shortName,
    description: describeCronSchedule(trigger.cronExpression),
    iconKind: 'schedule',
    isEnabled: trigger.enabled,
    recurrence: recurrence ? { hour: recurrence.hour, weekdays: recurrence.weekdays } : undefined,
  }
}

const outcomeByStatus: Record<RunStatus, RunOutcome> = {
  succeeded: 'done',
  failed: 'failed',
  aborted: 'failed',
  paused: 'needsYou',
  running: 'running',
}

/** Text under a past run: "14 sent" when the run reports `messages_sent`, otherwise its outcome. */
function summarizeScheduledRun(run: Run): string {
  const messagesSent = run.outputs?.messages_sent
  if (run.status === 'succeeded' && typeof messagesSent === 'number') return messages().schedule.sentCount(messagesSent)
  const summaries: Record<RunStatus, string> = { succeeded: messages().schedule.done, failed: messages().schedule.failed, aborted: messages().schedule.stopped, paused: messages().schedule.needsYou, running: messages().schedule.running }
  return summaries[run.status]
}

/**
 * Places scheduled runs on their agent's trigger row, on the day they started in `timezone`.
 * Runs link to agents, not triggers, so an agent with several triggers shows its runs on the first.
 *
 * @param runs - Runs started by a schedule (Run[])
 * @param triggers - Backend triggers (Trigger[])
 * @param timezone - IANA zone of the calendar (string)
 * @returns One past run per scheduled run whose agent still has a trigger (PastRun[])
 */
export function toPastRuns(runs: Run[], triggers: Trigger[], timezone: string): PastRun[] {
  return runs.flatMap((run) => {
    const trigger = triggers.find((candidate) => candidate.agentId === run.agentId)
    if (!trigger) return []
    return [
      {
        triggerId: trigger.id,
        runId: run.id,
        date: formatZonedIsoDate(new Date(run.startedAt), timezone),
        outcome: outcomeByStatus[run.status],
        summary: summarizeScheduledRun(run),
      },
    ]
  })
}

/**
 * UTC window that covers `dates` (local "YYYY-MM-DD") in any time zone: one day of margin on each side.
 * Runs outside the dates are dropped later by their local date.
 */
export function getRunHistoryWindow(dates: string[]): { since: string; until: string } {
  const dayInMilliseconds = 24 * 60 * 60 * 1000
  const firstDay = Date.parse(`${dates[0]}T00:00:00Z`)
  const dayAfterLast = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + dayInMilliseconds
  return { since: new Date(firstDay - dayInMilliseconds).toISOString(), until: new Date(dayAfterLast + dayInMilliseconds).toISOString() }
}

/**
 * Puts triggers in a given order (the design's, in the browser preview); triggers it does not
 * know keep their own order after the known ones.
 *
 * @param triggers - Triggers to sort (ScheduleTrigger[])
 * @param orderById - Position per trigger id (ReadonlyMap<string, number>)
 * @returns A new, sorted list (ScheduleTrigger[])
 *
 * @example
 * sortTriggersByOrder([b, a], new Map([['a', 0]])) // [a, b]
 */
export function sortTriggersByOrder(triggers: ScheduleTrigger[], orderById: ReadonlyMap<string, number>): ScheduleTrigger[] {
  const fallbackIndex = orderById.size
  return triggers
    .map((trigger, index) => ({ trigger, order: orderById.get(trigger.id) ?? fallbackIndex + index }))
    .sort((first, second) => first.order - second.order)
    .map(({ trigger }) => trigger)
}
