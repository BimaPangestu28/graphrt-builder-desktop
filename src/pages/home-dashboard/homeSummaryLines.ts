import type { Trigger } from '@/api/types'
import { formatClockTime } from '@/pages/agent-run/runResultSummary'
import { describeCronExpression } from '@/lib/schedule'
import { formatMonthShort, formatWeekdayShort, messages } from '@/i18n'

/** Text lines of the Home screen (09) built from real counts and schedules. */

/**
 * "1 thing needs you" / "3 things need you".
 *
 * @param count - Paused runs plus chats waiting for the user (number)
 */
export function describeNeedsYouCount(count: number): string {
  const t = messages().home
  if (count === 0) return t.nothingNeedsYou
  return t.thingsNeedYou(count)
}

function addLocalDays(date: Date, days: number): Date {
  const shifted = new Date(date)
  shifted.setDate(date.getDate() + days)
  return shifted
}

/** "today 09:00", "tomorrow 07:00" or "Thu 19 Nov 09:00", in the machine's zone. */
export function formatUpcomingTime(isoTimestamp: string, now: Date = new Date()): string {
  const instant = new Date(isoTimestamp)
  const clockTime = formatClockTime(isoTimestamp)
  const t = messages().home
  if (instant.toDateString() === now.toDateString()) return t.today(clockTime)
  if (instant.toDateString() === addLocalDays(now, 1).toDateString()) return t.tomorrow(clockTime)
  const weekday = formatWeekdayShort(instant)
  const month = formatMonthShort(instant)
  return `${weekday} ${instant.getDate()} ${month} ${clockTime}`
}

/**
 * "next run tomorrow 07:00" from the earliest `nextFireAt` of the enabled triggers.
 *
 * @param triggers - Every trigger (Trigger[])
 * @param now - Reference time (Date)
 * @returns The line, or "no runs scheduled" when nothing is switched on (string)
 */
export function describeNextRun(triggers: Trigger[], now: Date = new Date()): string {
  const upcomingTimes = triggers
    .filter((trigger) => trigger.enabled && trigger.nextFireAt)
    .map((trigger) => trigger.nextFireAt as string)
    .sort((first, second) => new Date(first).getTime() - new Date(second).getTime())
  const t = messages().home
  return upcomingTimes.length > 0 ? t.nextRun(formatUpcomingTime(upcomingTimes[0], now)) : t.noRunsScheduled
}

/**
 * Schedule line of a Home agent card, e.g. "Weekdays 09:00" or "Schedule off · Mondays 10:00".
 *
 * @param agentTriggers - The agent's triggers (Trigger[])
 * @returns The line, or null when the agent has no schedule (string | null)
 */
export function describeAgentSchedule(agentTriggers: Trigger[]): string | null {
  const t = messages().home
  const enabledTriggers = agentTriggers.filter((trigger) => trigger.enabled)
  if (enabledTriggers.length === 0) {
    return agentTriggers.length > 0 ? t.scheduleOff(describeCronExpression(agentTriggers[0].cronExpression)) : null
  }
  const firstSchedule = describeCronExpression(enabledTriggers[0].cronExpression)
  const otherCount = enabledTriggers.length - 1
  return otherCount > 0 ? t.moreSchedules(firstSchedule, otherCount) : firstSchedule
}
