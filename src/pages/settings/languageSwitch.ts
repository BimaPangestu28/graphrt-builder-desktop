import type { SettingsSectionKey } from '@/lib/settings'

/**
 * Switching the language re-mounts every screen (see `LocaleRoot`). The Language row remembers its
 * section here first, so Settings opens on it again instead of the default Runner section.
 */
let sectionAfterLanguageSwitch: SettingsSectionKey | null = null

export function keepSectionAcrossLanguageSwitch(section: SettingsSectionKey): void {
  sectionAfterLanguageSwitch = section
}

/** The section to open on: the remembered one, else Runner. Pure, so it can seed `useState`. */
export function sectionToOpen(): SettingsSectionKey {
  return sectionAfterLanguageSwitch ?? 'runner'
}

/** Forgets the remembered section once Settings has opened on it. */
export function forgetSectionAfterLanguageSwitch(): void {
  sectionAfterLanguageSwitch = null
}
