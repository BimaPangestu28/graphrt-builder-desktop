import type { Trigger } from '@/api/types'
import { formatClockTime } from '@/pages/agent-run/runResultSummary'
import { describeCronExpression } from '@/lib/schedule'

/** Text lines of the Home screen (09) built from real counts and schedules. */

/**
 * "1 thing needs you" / "3 things need you".
 *
 * @param count - Paused runs plus chats waiting for the user (number)
 */
export function describeNeedsYouCount(count: number): string {
  if (count === 0) return 'Nothing needs you'
  return count === 1 ? '1 thing needs you' : `${count} things need you`
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
  if (instant.toDateString() === now.toDateString()) return `today ${clockTime}`
  if (instant.toDateString() === addLocalDays(now, 1).toDateString()) return `tomorrow ${clockTime}`
  const weekday = instant.toLocaleString('en-GB', { weekday: 'short' })
  const month = instant.toLocaleString('en-GB', { month: 'short' })
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
  return upcomingTimes.length > 0 ? `next run ${formatUpcomingTime(upcomingTimes[0], now)}` : 'no runs scheduled'
}

/**
 * Schedule line of a Home agent card, e.g. "Weekdays 09:00" or "Schedule off · Mondays 10:00".
 *
 * @param agentTriggers - The agent's triggers (Trigger[])
 * @returns The line, or null when the agent has no schedule (string | null)
 */
export function describeAgentSchedule(agentTriggers: Trigger[]): string | null {
  const enabledTriggers = agentTriggers.filter((trigger) => trigger.enabled)
  if (enabledTriggers.length === 0) {
    return agentTriggers.length > 0 ? `Schedule off · ${describeCronExpression(agentTriggers[0].cronExpression)}` : null
  }
  const firstSchedule = describeCronExpression(enabledTriggers[0].cronExpression)
  const otherCount = enabledTriggers.length - 1
  return otherCount > 0 ? `${firstSchedule} · +${otherCount} more` : firstSchedule
}
