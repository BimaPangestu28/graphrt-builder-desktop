/**
 * Screen 10 (Scheduler): the design's sample triggers (event and webhook ones are shown in the
 * browser preview only), the rule choices, and helpers to lay a week out on the calendar grid.
 * Past runs come from the backend (`listScheduledRuns`).
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

/** Weekday numbers follow Date#getUTCDay: 0 = Sunday, 1 = Monday ... 6 = Saturday. */
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const weekdaysOnly = [1, 2, 3, 4, 5]

export const initialScheduleTriggers: ScheduleTrigger[] = [
  { id: 'maps-leads', agentName: 'Maps leads to WhatsApp', shortName: 'Maps leads', description: 'Weekdays at 09:00', iconKind: 'schedule', isEnabled: true, recurrence: { hour: 9, weekdays: weekdaysOnly } },
  { id: 'morning-digest', agentName: 'Morning email digest', shortName: 'Email digest', description: 'Every day at 07:00', iconKind: 'schedule', isEnabled: true, recurrence: { hour: 7, weekdays: everyDay } },
  { id: 'reply-drafts', agentName: 'Reply drafts', shortName: 'Reply drafts', description: 'When a new Google review arrives · checks every 15 min', iconKind: 'email', isEnabled: true },
  { id: 'form-responses', agentName: 'Form responses to sheet', shortName: 'Form responses', description: 'Webhook · localhost:7420/hooks/form', iconKind: 'webhook', isEnabled: true },
  { id: 'invoice-reminders', agentName: 'Invoice reminders', shortName: 'Invoices', description: 'Mondays at 10:00', iconKind: 'schedule', isEnabled: false, recurrence: { hour: 10, weekdays: [1] } },
]

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

/** The mock "today" the browser preview is pinned to (a Wednesday), so it matches the design. */
export const scheduleToday = '2026-11-18'
/** Time zone of the browser preview's sample schedules. */
export const scheduleTimeZone = 'Asia/Jakarta'

/** First and last hour row of the calendar. */
export const calendarFirstHour = 6
export const calendarLastHour = 12

export const ifMacAsleepOptions = ['Run once when it wakes up', 'Skip the missed run']

/** "Agents running at the same time" choices and the limit each one stores, in the design's order. */
export const concurrencyOptions: Array<{ label: string; maxConcurrentRuns: number }> = [
  { label: 'Up to 2', maxConcurrentRuns: 2 },
  { label: '1', maxConcurrentRuns: 1 },
  { label: 'Up to 4', maxConcurrentRuns: 4 },
]

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
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  return `${firstLabel} to ${lastDate.getUTCDate()} ${lastMonth}`
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
  if (!trigger.isEnabled) return { ...base, kind: 'paused', detail: 'Paused' }
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
