import { messages } from '@/i18n'
/**
 * Picks the Home heading for the local hour of day.
 *
 * @param hour - Hour from 0 to 23 (number)
 * @returns "Good morning" before 12, "Good afternoon" before 18, otherwise "Good evening" (string)
 *
 * @example
 * getGreetingForHour(14) // "Good afternoon"
 */
export function getGreetingForHour(hour: number): string {
  const t = messages().home
  if (hour < 12) return t.greetingMorning
  if (hour < 18) return t.greetingAfternoon
  return t.greetingEvening
}
