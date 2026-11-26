import { useSyncExternalStore } from 'react'
import { getLocale, setLocale, subscribeToLocale } from './locale'
import { dictionaries, type Messages } from './messages'
import type { Locale } from './types'

export { detectSystemLocale, getLocale, parseLocale, setLocale, subscribeToLocale } from './locale'
export * from './format'
export type { Locale } from './types'
export type { Messages } from './messages'

/**
 * The strings of the current language, for code outside React (view models, formatters). Call it
 * when the text is needed, not at module load, so a language switch is picked up.
 */
export function messages(): Messages {
  return dictionaries[getLocale()]
}

/** The current language; re-renders the component when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, getLocale, getLocale)
}

/**
 * The strings of the current language; re-renders the component when the language changes.
 *
 * @example
 * const t = useT()
 * return <h1>{t.home.title}</h1>
 */
export function useT(): Messages {
  return dictionaries[useLocale()]
}

/** Switches the UI language (without saving it; see `saveLocale`). */
export function useSetLocale(): (locale: Locale) => void {
  return setLocale
}
