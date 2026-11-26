import { getAppSettings, updateAppSettings } from '@/api/appSettings'
import { getLocale, parseLocale, setLocale } from './locale'
import type { Locale } from './types'

/**
 * Brings the UI language in line with the app settings at start-up: a stored choice wins; on
 * first launch the language picked from the system is stored, so the tray menu and the
 * notifications (written by the Rust side) use it too. A backend error keeps the current
 * language and is logged, since the window works without it.
 */
export async function syncLocaleWithSettings(): Promise<void> {
  try {
    const settings = await getAppSettings()
    const storedLocale = parseLocale(settings.language)
    if (storedLocale) {
      setLocale(storedLocale)
      return
    }
    await updateAppSettings({ ...settings, language: getLocale() })
  } catch (error) {
    console.warn('Could not read or store the UI language', error)
  }
}

/**
 * Switches the UI language and stores it in the app settings.
 *
 * @param locale - The chosen language (Locale)
 * @throws BackendError - when the settings cannot be read or written (the UI still switches)
 */
export async function saveLocale(locale: Locale): Promise<void> {
  setLocale(locale)
  const settings = await getAppSettings()
  await updateAppSettings({ ...settings, language: locale })
}
