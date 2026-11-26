import type { Locale } from './types'

/**
 * The UI language, kept in module memory so plain functions (view models, formatters) read the
 * same language as components. The choice is stored in the app settings (`language`); this module
 * also mirrors it in localStorage so the window paints in the right language before the settings
 * load.
 */

const LOCALE_CACHE_KEY = 'graphrt.locale'

type LocaleListener = (locale: Locale) => void

const listeners = new Set<LocaleListener>()

/**
 * The language of the operating system: Indonesian for any `id` locale, English otherwise.
 *
 * @param languages - Preferred languages, most preferred first (readonly string[])
 * @returns The locale to start with (Locale)
 */
export function detectSystemLocale(languages: readonly string[] = readNavigatorLanguages()): Locale {
  const firstLanguage = languages.find((language) => language.trim() !== '')
  return firstLanguage?.toLowerCase().split(/[-_]/)[0] === 'id' ? 'id' : 'en'
}

function readNavigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages
  return navigator.language ? [navigator.language] : []
}

/** Narrows a stored value to a locale. */
export function parseLocale(value: unknown): Locale | null {
  return value === 'en' || value === 'id' ? value : null
}

function readCachedLocale(): Locale | null {
  try {
    return parseLocale(globalThis.localStorage?.getItem(LOCALE_CACHE_KEY))
  } catch {
    return null
  }
}

function writeCachedLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_CACHE_KEY, locale)
  } catch {
    // Storage can be unavailable (private window, tests); the settings still hold the choice.
  }
}

let currentLocale: Locale = readCachedLocale() ?? detectSystemLocale()

/** The language the UI shows now. */
export function getLocale(): Locale {
  return currentLocale
}

/**
 * Switches the UI language and tells every subscriber. Does not save it to the app settings
 * (see `saveLocale` in `./persistLocale`).
 *
 * @param locale - The new language (Locale)
 */
export function setLocale(locale: Locale): void {
  writeCachedLocale(locale)
  if (locale === currentLocale) return
  currentLocale = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  for (const listener of listeners) listener(locale)
}

/** Calls `listener` on every language change. Returns the unsubscribe function. */
export function subscribeToLocale(listener: LocaleListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test helper: back to English without touching storage or listeners' order. */
export function resetLocaleForTests(locale: Locale = 'en'): void {
  currentLocale = locale
  for (const listener of listeners) listener(locale)
}
