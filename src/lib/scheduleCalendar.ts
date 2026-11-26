import { messages } from '@/i18n'
import { localizedArray, withLocalizedLabels } from '@/i18n/localized'
/**
 * Screen 10 (Scheduler): the calendar's trigger and entry shapes, the rule choices, and helpers to
 * lay a week out on the calendar grid. Triggers and past runs come from the backend (`listTriggers`,
 * `listScheduledRuns`); the browser preview's sample triggers live in the sample backend.
 * Dates are plain "YYYY-MM-DD" strings handled in UTC so the grid never shifts with the machine's time zone.
 */

export type TriggerIconKind = 'schedule' | 'email' | 'webhook'

export interface ScheduleTrigger {
  id: string
  agentName: string
  /** Short name shown inside calendar blocks. */
  shortName: string
  description: string
  iconKind: TriggerIconKind
  isEnabled: boolean
  /** Clock-based recurrence. Event or webhook triggers have none and never appear on the calendar. */
  recurrence?: { hour: number; weekdays: number[] }
}

export type RunOutcome = 'done' | 'failed' | 'needsYou' | 'running'

/** A run a schedule started, placed on its trigger's row (see `schedulerViewModel.toPastRuns`). */
export interface PastRun {
  triggerId: string
  runId: string
  date: string
  outcome: RunOutcome
  /** Text under the agent name, e.g. "14 sent". */
  summary: string
}

/** First and last hour row of the calendar. */
export const calendarFirstHour = 6
export const calendarLastHour = 12

export const ifMacAsleepOptions: readonly string[] = localizedArray(() => [messages().schedule.runOnceWhenWakes, messages().schedule.skipMissedRun])

/** "Agents running at the same time" choices and the limit each one stores, in the design's order. */
export const concurrencyOptions: ReadonlyArray<{ readonly label: string; maxConcurrentRuns: number }> = withLocalizedLabels(
  [{ maxConcurrentRuns: 2 }, { maxConcurrentRuns: 1 }, { maxConcurrentRuns: 4 }],
  (option) => (option.maxConcurrentRuns === 1 ? '1' : messages().schedule.upTo(option.maxConcurrentRuns)),
)

export type CalendarEntryKind = RunOutcome | 'planned' | 'paused'

export interface CalendarEntry {
  key: string
  date: string
  hour: number
  title: string
  detail: string
  kind: CalendarEntryKind
  /** The run behind a past-run block. */
  runId?: string
}

const dayInMilliseconds = 24 * 60 * 60 * 1000
const monthNames: readonly string[] = localizedArray(() => messages().schedule.shortMonths)
const weekdayNames: readonly string[] = localizedArray(() => messages().schedule.shortWeekdays)

function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Lists the seven dates (Monday first) of the week `weekOffset` weeks away from `todayIsoDate`.
 *
 * @example
 * getWeekDates('2026-11-18', 0) // ['2026-11-16', ..., '2026-11-22']
 */
export function getWeekDates(todayIsoDate: string, weekOffset: number): string[] {
  const today = parseIsoDate(todayIsoDate)
  const daysSinceMonday = (today.getUTCDay() + 6) % 7
  const mondayTime = today.getTime() - daysSinceMonday * dayInMilliseconds + weekOffset * 7 * dayInMilliseconds
  return Array.from({ length: 7 }, (_, dayIndex) => formatIsoDate(new Date(mondayTime + dayIndex * dayInMilliseconds)))
}

/** "Mon", "Tue" ... for a date. */
export function getWeekdayName(isoDate: string): string {
  return weekdayNames[parseIsoDate(isoDate).getUTCDay()]
}

/** Day of the month as a number. */
export function getDayOfMonth(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDate()
}

/**
 * Human label for a week, as in the page subtitle: "16 to 22 Nov" or "30 Nov to 6 Dec".
 */
export function formatWeekRange(weekDates: string[]): string {
  const firstDate = parseIsoDate(weekDates[0])
  const lastDate = parseIsoDate(weekDates[weekDates.length - 1])
  const firstMonth = monthNames[firstDate.getUTCMonth()]
  const lastMonth = monthNames[lastDate.getUTCMonth()]
  const firstLabel = firstMonth === lastMonth ? `${firstDate.getUTCDate()}` : `${firstDate.getUTCDate()} ${firstMonth}`
  return messages().schedule.weekRange(firstLabel, `${lastDate.getUTCDate()} ${lastMonth}`)
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** Hour labels for the calendar's left column: "06:00" ... "12:00". */
export function getCalendarHourLabels(): Array<{ hour: number; label: string }> {
  const hourCount = calendarLastHour - calendarFirstHour + 1
  return Array.from({ length: hourCount }, (_, index) => {
    const hour = calendarFirstHour + index
    return { hour, label: formatHour(hour) }
  })
}

function buildEntryForDay(trigger: ScheduleTrigger, isoDate: string, todayIsoDate: string, runs: PastRun[]): CalendarEntry | null {
  const recurrence = trigger.recurrence
  if (!recurrence || !recurrence.weekdays.includes(parseIsoDate(isoDate).getUTCDay())) return null
  const base = { key: `${trigger.id}-${isoDate}`, date: isoDate, hour: recurrence.hour, title: trigger.shortName }
  const pastRun = runs.find((run) => run.triggerId === trigger.id && run.date === isoDate)
  if (pastRun) return { ...base, kind: pastRun.outcome, detail: pastRun.summary, runId: pastRun.runId }
  if (!trigger.isEnabled) return { ...base, kind: 'paused', detail: messages().schedule.paused }
  if (isoDate > todayIsoDate) return { ...base, kind: 'planned', detail: formatHour(recurrence.hour) }
  return null
}

/**
 * Builds the calendar blocks for the given dates: finished runs come from history,
 * future runs of enabled triggers show as planned, and disabled triggers show as paused.
 * Runs outside the visible hours are left out.
 */
export function buildCalendarEntries(options: { dates: string[]; triggers: ScheduleTrigger[]; todayIsoDate: string; runs?: PastRun[] }): CalendarEntry[] {
  const { dates, triggers, todayIsoDate, runs = [] } = options
  return dates
    .flatMap((isoDate) => triggers.map((trigger) => buildEntryForDay(trigger, isoDate, todayIsoDate, runs)))
    .filter((entry): entry is CalendarEntry => entry !== null && entry.hour >= calendarFirstHour && entry.hour <= calendarLastHour)
}
