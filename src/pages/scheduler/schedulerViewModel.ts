import type { Run, RunStatus, Trigger } from '@/api/types'
import { initialScheduleTriggers, type PastRun, type RunOutcome, type ScheduleTrigger } from '@/data/scheduler'
import { describeCronSchedule, formatZonedIsoDate, parseCronExpression } from '@/lib/schedule'

/**
 * Maps backend triggers onto the Scheduler screen's (10) `ScheduleTrigger`, so the trigger list and
 * calendar keep their look. A trigger's cron expression becomes the calendar recurrence, which is what
 * draws its planned runs.
 */

const mockTriggerOrder = new Map(initialScheduleTriggers.map((trigger, index) => [trigger.id, index]))
const shortNamesById = new Map(initialScheduleTriggers.map((trigger) => [trigger.id, trigger.shortName]))

/**
 * Event and webhook triggers from the mockup. The backend only has clock-based triggers so far,
 * so the browser preview keeps showing these from mock data.
 */
export const mockEventTriggers: ScheduleTrigger[] = initialScheduleTriggers.filter((trigger) => trigger.iconKind !== 'schedule')

/**
 * One trigger row and its calendar recurrence.
 *
 * @param trigger - Backend trigger (Trigger)
 * @param agentName - Display name of its agent (string)
 */
export function toScheduleTrigger(trigger: Trigger, agentName: string): ScheduleTrigger {
  const recurrence = parseCronExpression(trigger.cronExpression)
  return {
    id: trigger.id,
    agentName,
    shortName: shortNamesById.get(trigger.agentId) ?? agentName,
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
  if (run.status === 'succeeded' && typeof messagesSent === 'number') return `${messagesSent} sent`
  const summaries: Record<RunStatus, string> = { succeeded: 'Done', failed: 'Failed', aborted: 'Stopped', paused: 'Needs you', running: 'Running' }
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

/** Puts triggers in the mockup's order; triggers it does not know keep their order at the end. */
export function sortLikeMockup(triggers: ScheduleTrigger[]): ScheduleTrigger[] {
  const fallbackIndex = mockTriggerOrder.size
  return triggers
    .map((trigger, index) => ({ trigger, order: mockTriggerOrder.get(trigger.id) ?? fallbackIndex + index }))
    .sort((first, second) => first.order - second.order)
    .map(({ trigger }) => trigger)
}
