import type { Locale, Translation } from './types'
import { settings } from './locales/settings'
import { common } from './locales/common'
import { shell } from './locales/shell'
import { welcome } from './locales/welcome'
import { platform } from './locales/platform'

/**
 * Every dictionary of the app, by language. Add an area by importing its `defineMessages` pair
 * and listing it in both objects below (the completeness test checks they match).
 */
const english = {
  settings: settings.en,
  common: common.en,
  shell: shell.en,
  welcome: welcome.en,
  platform: platform.en,
}

export type Messages = Translation<typeof english>

const indonesian: Messages = {
  settings: settings.id,
  common: common.id,
  shell: shell.id,
  welcome: welcome.id,
  platform: platform.id,
}

export const dictionaries: Record<Locale, Messages> = { en: english, id: indonesian }
