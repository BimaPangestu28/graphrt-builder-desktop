import type { MissedRunPolicy } from '@/api/types'

/**
 * Schedule helpers shared by the schedule dialog (08), the scheduler (10) and the sample backend.
 *
 * The backend speaks 6-field cron with seconds ("0 0 9 * * Mon-Fri") and IANA time zones.
 * These helpers only cover what the UI can produce: a fixed time of day on a set of weekdays.
 * They are not a general cron engine.
 */

/** How often the agent runs, as offered by the "When" radio tiles. */
export type ScheduleFrequency = 'manual' | 'daily' | 'weekdays' | 'custom'

/** A time of day on some weekdays (0 = Sunday … 6 = Saturday, like Date#getDay). */
export interface DailyRecurrence {
  hour: number
  minute: number
  /** Sorted, unique weekday numbers. */
  weekdays: number[]
}

export interface CronBuildOptions {
  frequency: ScheduleFrequency
  /** "HH:MM" from a time input. */
  time: string
  /** Used only when `frequency` is "custom". */
  customWeekdays?: number[]
}

const allWeekdays = [0, 1, 2, 3, 4, 5, 6]
const workWeekdays = [1, 2, 3, 4, 5]
const weekendWeekdays = [0, 6]
const shortWeekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const longWeekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday-first display order. */
const mondayFirstOrder = [1, 2, 3, 4, 5, 6, 0]

/** Weekday choices for the "Custom" frequency, Monday first. */
export const weekdayChoices = mondayFirstOrder.map((weekday) => ({ weekday, label: shortWeekdayNames[weekday] }))

function areSameWeekdays(first: number[], second: number[]): boolean {
  return first.length === second.length && first.every((weekday, index) => weekday === second[index])
}

function normalizeWeekdays(weekdays: number[]): number[] {
  return Array.from(new Set(weekdays.map((weekday) => (weekday === 7 ? 0 : weekday)))).sort((first, second) => first - second)
}

/** Parses "HH:MM" into hour and minute, or null when it is not a valid time. */
export function parseTimeOfDay(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** "09:05" for 9 and 5. */
export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatCronWeekdays(weekdays: number[]): string {
  if (areSameWeekdays(weekdays, allWeekdays)) return '*'
  if (areSameWeekdays(weekdays, workWeekdays)) return 'Mon-Fri'
  return mondayFirstOrder
    .filter((weekday) => weekdays.includes(weekday))
    .map((weekday) => shortWeekdayNames[weekday])
    .join(',')
}

/**
 * Builds the backend cron expression (with seconds) for the dialog's "When" choice.
 *
 * @param options - Frequency, "HH:MM" time and, for "custom", the chosen weekdays (CronBuildOptions)
 * @returns The cron expression, or null for "manual", an invalid time, or no weekdays (string | null)
 *
 * @example
 * buildCronExpression({ frequency: 'weekdays', time: '09:00' }) // "0 0 9 * * Mon-Fri"
 */
export function buildCronExpression({ frequency, time, customWeekdays = [] }: CronBuildOptions): string | null {
  if (frequency === 'manual') return null
  const timeOfDay = parseTimeOfDay(time)
  if (!timeOfDay) return null
  const weekdaysByFrequency: Record<Exclude<ScheduleFrequency, 'manual'>, number[]> = {
    daily: allWeekdays,
    weekdays: workWeekdays,
    custom: normalizeWeekdays(customWeekdays),
  }
  const weekdays = weekdaysByFrequency[frequency]
  if (weekdays.length === 0) return null
  return `0 ${timeOfDay.minute} ${timeOfDay.hour} * * ${formatCronWeekdays(weekdays)}`
}

function parseCronWeekday(token: string): number | null {
  const nameIndex = shortWeekdayNames.findIndex((name) => name.toLowerCase() === token.toLowerCase())
  if (nameIndex >= 0) return nameIndex
  if (!/^\d$/.test(token)) return null
  const weekday = Number(token)
  return weekday <= 7 ? weekday % 7 : null
}

function parseCronWeekdayItem(item: string): number[] | null {
  const [rangeStart, rangeEnd, ...rest] = item.split('-')
  if (rest.length > 0) return null
  const startWeekday = parseCronWeekday(rangeStart)
  if (startWeekday === null) return null
  if (rangeEnd === undefined) return [startWeekday]
  const endWeekday = parseCronWeekday(rangeEnd)
  if (endWeekday === null) return null
  // "Fri-Sun" wraps around the week; "Mon-Sun" with Sun as 7 too.
  const lastWeekday = endWeekday < startWeekday ? endWeekday + 7 : endWeekday
  return Array.from({ length: lastWeekday - startWeekday + 1 }, (_, offset) => (startWeekday + offset) % 7)
}

function parseCronWeekdayField(field: string): number[] | null {
  if (field === '*' || field === '?') return allWeekdays
  const weekdays: number[] = []
  for (const item of field.split(',')) {
    const itemWeekdays = parseCronWeekdayItem(item)
    if (!itemWeekdays) return null
    weekdays.push(...itemWeekdays)
  }
  return normalizeWeekdays(weekdays)
}

function parseCronNumber(field: string, maximum: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null
  const value = Number(field)
  return value <= maximum ? value : null
}

/**
 * Reads a cron expression the UI can describe: seconds 0, a fixed minute and hour,
 * any day of month and month, and a weekday list or range.
 *
 * @returns The recurrence, or null for anything more complex (DailyRecurrence | null)
 *
 * @example
 * parseCronExpression('0 30 7 * * *') // { hour: 7, minute: 30, weekdays: [0..6] }
 */
export function parseCronExpression(cronExpression: string): DailyRecurrence | null {
  const fields = cronExpression.trim().split(/\s+/)
  if (fields.length !== 6) return null
  const [secondField, minuteField, hourField, dayOfMonthField, monthField, weekdayField] = fields
  if (secondField !== '0') return null
  if (!['*', '?'].includes(dayOfMonthField) || monthField !== '*') return null
  const minute = parseCronNumber(minuteField, 59)
  const hour = parseCronNumber(hourField, 23)
  const weekdays = parseCronWeekdayField(weekdayField)
  if (minute === null || hour === null || !weekdays || weekdays.length === 0) return null
  return { hour, minute, weekdays }
}

/** "Every day", "Weekdays", "Weekends", "Mondays" or "Mon, Wed, Fri". */
export function describeWeekdays(weekdays: number[]): string {
  const normalizedWeekdays = normalizeWeekdays(weekdays)
  if (areSameWeekdays(normalizedWeekdays, allWeekdays)) return 'Every day'
  if (areSameWeekdays(normalizedWeekdays, workWeekdays)) return 'Weekdays'
  if (areSameWeekdays(normalizedWeekdays, weekendWeekdays)) return 'Weekends'
  if (normalizedWeekdays.length === 1) return `${longWeekdayNames[normalizedWeekdays[0]]}s`
  return mondayFirstOrder
    .filter((weekday) => normalizedWeekdays.includes(weekday))
    .map((weekday) => shortWeekdayNames[weekday])
    .join(', ')
}

/**
 * Short description of a cron expression, e.g. "Weekdays 09:00".
 * Expressions the UI cannot read are returned unchanged.
 */
export function describeCronExpression(cronExpression: string): string {
  const recurrence = parseCronExpression(cronExpression)
  if (!recurrence) return cronExpression
  return `${describeWeekdays(recurrence.weekdays)} ${formatTimeOfDay(recurrence.hour, recurrence.minute)}`
}

/** Sentence form used in the trigger list, e.g. "Weekdays at 09:00". */
export function describeCronSchedule(cronExpression: string): string {
  const recurrence = parseCronExpression(cronExpression)
  if (!recurrence) return `Cron ${cronExpression}`
  return `${describeWeekdays(recurrence.weekdays)} at ${formatTimeOfDay(recurrence.hour, recurrence.minute)}`
}

/** True when `timezone` is an IANA zone this runtime knows. */
export function isKnownTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

interface ZonedDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedDateTimeParts(instant: Date, timezone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const parts = formatter.formatToParts(instant)
  const readPart = (partType: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === partType)?.value ?? 0)
  return { year: readPart('year'), month: readPart('month'), day: readPart('day'), hour: readPart('hour'), minute: readPart('minute'), second: readPart('second') }
}

/** Milliseconds the zone is ahead of UTC at `instant` (Asia/Jakarta: +7h). */
function getTimeZoneOffsetMs(instant: Date, timezone: string): number {
  const zoned = getZonedDateTimeParts(instant, timezone)
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second)
  return zonedAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** Converts a wall-clock time in `timezone` to an instant. */
function zonedWallTimeToInstant(wallTimeAsUtcMs: number, timezone: string): Date {
  const firstGuess = wallTimeAsUtcMs - getTimeZoneOffsetMs(new Date(wallTimeAsUtcMs), timezone)
  // A second pass settles wall times close to a DST change.
  return new Date(wallTimeAsUtcMs - getTimeZoneOffsetMs(new Date(firstGuess), timezone))
}

function toRfc3339(instant: Date): string {
  return instant.toISOString().replace('.000Z', 'Z')
}

/**
 * Next fire times of a weekday-at-HH:MM cron expression, strictly after `after`.
 *
 * @param cronExpression - Cron with seconds (string)
 * @param timezone - IANA zone the times are in (string)
 * @param count - How many times to return (number)
 * @param after - Start point, defaults to now (Date)
 * @returns RFC 3339 UTC timestamps (string[])
 * @throws Error - When the expression or zone cannot be read
 *
 * @example
 * listUpcomingFireTimes('0 0 9 * * Mon-Fri', 'Asia/Jakarta', 2, new Date('2026-11-18T03:00:00Z'))
 * // ['2026-11-19T02:00:00Z', '2026-11-20T02:00:00Z']
 */
export function listUpcomingFireTimes(cronExpression: string, timezone: string, count: number, after: Date = new Date()): string[] {
  const recurrence = parseCronExpression(cronExpression)
  if (!recurrence) throw new Error(`Unsupported schedule "${cronExpression}"`)
  if (!isKnownTimeZone(timezone)) throw new Error(`Unknown time zone "${timezone}"`)
  const today = getZonedDateTimeParts(after, timezone)
  const fireTimes: string[] = []
  for (let dayOffset = 0; fireTimes.length < count && dayOffset < count * 7 + 8; dayOffset += 1) {
    const wallTimeAsUtcMs = Date.UTC(today.year, today.month - 1, today.day + dayOffset, recurrence.hour, recurrence.minute)
    if (!recurrence.weekdays.includes(new Date(wallTimeAsUtcMs).getUTCDay())) continue
    const fireInstant = zonedWallTimeToInstant(wallTimeAsUtcMs, timezone)
    if (fireInstant.getTime() > after.getTime()) fireTimes.push(toRfc3339(fireInstant))
  }
  return fireTimes
}

/**
 * Formats a fire time for "Next runs: …" in the schedule's own zone, e.g. "Thu 19 Nov 09:00".
 */
export function formatFireTime(isoTimestamp: string, timezone: string): string {
  const instant = new Date(isoTimestamp)
  if (Number.isNaN(instant.getTime())) return isoTimestamp
  const zoned = getZonedDateTimeParts(instant, timezone)
  const wallDate = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day))
  const monthName = wallDate.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return `${shortWeekdayNames[wallDate.getUTCDay()]} ${zoned.day} ${monthName} ${formatTimeOfDay(zoned.hour, zoned.minute)}`
}

/** "YYYY-MM-DD" of `instant` as seen in `timezone`. */
export function formatZonedIsoDate(instant: Date, timezone: string): string {
  const zoned = getZonedDateTimeParts(instant, timezone)
  return `${zoned.year}-${String(zoned.month).padStart(2, '0')}-${String(zoned.day).padStart(2, '0')}`
}

/** The scheduler's "If the Mac was asleep" choices and the backend policy each one means. */
export const missedRunPolicyByOption: Record<string, MissedRunPolicy> = {
  'Run once when it wakes up': 'run_once',
  'Skip the missed run': 'skip',
}

/** Maps a missed-run choice to the backend policy; unknown choices run once, the safe default. */
export function toMissedRunPolicy(option: string): MissedRunPolicy {
  return missedRunPolicyByOption[option] ?? 'run_once'
}
