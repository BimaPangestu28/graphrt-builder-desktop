import { getLocale } from './locale'
import type { Locale } from './types'

/**
 * Locale-aware formatting for dates, times, numbers and money. English keeps the formats the app
 * always had (day before month as in en-GB, digit grouping as in en-US); Indonesian uses id-ID
 * (`1.234`, `3 Des`, `Sen`).
 */

const dateLocaleTags: Record<Locale, string> = { en: 'en-GB', id: 'id-ID' }
const numberLocaleTags: Record<Locale, string> = { en: 'en-US', id: 'id-ID' }

/** BCP 47 tag for dates and times in the current language. */
export function dateLocaleTag(locale: Locale = getLocale()): string {
  return dateLocaleTags[locale]
}

/** BCP 47 tag for numbers in the current language. */
export function numberLocaleTag(locale: Locale = getLocale()): string {
  return numberLocaleTags[locale]
}

/**
 * A whole or decimal number with the digit grouping of the current language.
 *
 * @param value - The number (number)
 * @param options - Intl options, e.g. `{ maximumFractionDigits: 1 }` (Intl.NumberFormatOptions)
 * @returns "1,234" in English, "1.234" in Indonesian (string)
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(numberLocaleTag(), options)
}

/**
 * An amount of money.
 *
 * @param amount - The amount (number)
 * @param currency - ISO 4217 code, e.g. "USD" or "IDR" (string)
 * @returns "$1.50" in English, "US$1,50" in Indonesian (string)
 */
export function formatCurrency(amount: number, currency: string, options?: Intl.NumberFormatOptions): string {
  return amount.toLocaleString(numberLocaleTag(), { style: 'currency', currency, ...options })
}

/**
 * Short weekday name, e.g. "Mon" / "Sen".
 */
export function formatWeekdayShort(instant: Date, timeZone?: string): string {
  return instant.toLocaleString(dateLocaleTag(), { weekday: 'short', timeZone })
}

/**
 * Short month name, e.g. "Nov" / "Nov", "Dec" / "Des".
 */
export function formatMonthShort(instant: Date, timeZone?: string): string {
  return instant.toLocaleString(dateLocaleTag(), { month: 'short', timeZone })
}

/**
 * Day and short month, e.g. "3 Dec" / "3 Des".
 */
export function formatDayMonth(instant: Date): string {
  return `${instant.getDate()} ${formatMonthShort(instant)}`
}

/**
 * Date and time with Intl options in the current language.
 */
export function formatDateTime(instant: Date, options?: Intl.DateTimeFormatOptions): string {
  return instant.toLocaleString(dateLocaleTag(), options)
}

/**
 * Date only with Intl options in the current language.
 */
export function formatDate(instant: Date, options?: Intl.DateTimeFormatOptions): string {
  return instant.toLocaleDateString(dateLocaleTag(), options)
}

/**
 * Time only with Intl options in the current language.
 */
export function formatTime(instant: Date, options?: Intl.DateTimeFormatOptions): string {
  return instant.toLocaleTimeString(dateLocaleTag(), options)
}

/**
 * The tag to pass to an Intl call that kept its own English format: `englishTag` (undefined is the
 * system default) in English, id-ID in Indonesian.
 */
export function intlTag(englishTag?: string): string | undefined {
  return getLocale() === 'id' ? 'id-ID' : englishTag
}
