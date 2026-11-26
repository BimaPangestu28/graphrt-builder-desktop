import { messages } from '@/i18n'
const millisecondsPerMinute = 60_000

function isSameDay(first: Date, second: Date): boolean {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

function formatClockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Formats when a version was saved the way the history list shows it.
 *
 * @param savedAt - RFC 3339 timestamp (string)
 * @param now - Reference time, for tests (Date)
 * @returns "Just now", "Today 13:01", "Yesterday 16:12" or "12 Nov" (string)
 *
 * @example
 * formatSavedAt('2026-11-18T06:01:00Z', new Date('2026-11-18T10:00:00Z')) // "Today 13:01" in Asia/Jakarta
 */
export function formatSavedAt(savedAt: string, now: Date = new Date()): string {
  const savedDate = new Date(savedAt)
  if (Number.isNaN(savedDate.getTime())) return savedAt
  const elapsedMilliseconds = now.getTime() - savedDate.getTime()
  if (elapsedMilliseconds >= 0 && elapsedMilliseconds < millisecondsPerMinute) return messages().misc.justNow
  if (isSameDay(savedDate, now)) return messages().misc.todayClocktime(formatClockTime(savedDate))
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(savedDate, yesterday)) return messages().misc.yesterdayClocktime(formatClockTime(savedDate))
  return savedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
