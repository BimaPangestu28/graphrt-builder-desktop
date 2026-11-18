import type { Trigger } from '@/api/types'
import { initialScheduleTriggers, type ScheduleTrigger } from '@/data/scheduler'
import { describeCronSchedule, parseCronExpression } from '@/lib/schedule'

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

/** Puts triggers in the mockup's order; triggers it does not know keep their order at the end. */
export function sortLikeMockup(triggers: ScheduleTrigger[]): ScheduleTrigger[] {
  const fallbackIndex = mockTriggerOrder.size
  return triggers
    .map((trigger, index) => ({ trigger, order: mockTriggerOrder.get(trigger.id) ?? fallbackIndex + index }))
    .sort((first, second) => first.order - second.order)
    .map(({ trigger }) => trigger)
}
