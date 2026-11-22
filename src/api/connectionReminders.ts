import { isDesktopApp } from './client'
import type { ConnectionReminder } from './connectionReminderTypes'
import { sampleConnectionRemindersBackend } from './sampleBackend/connectionReminders'

/**
 * Connected services that need attention (Home "Needs you").
 *
 * The desktop backend does not check service sign-ins yet, so the desktop app reports none
 * instead of guessing; the browser preview shows the design's sample reminder.
 *
 * @returns Reminders, most urgent first (ConnectionReminder[])
 */
export function listConnectionReminders(): Promise<ConnectionReminder[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleConnectionRemindersBackend.listConnectionReminders()
  return Promise.resolve([])
}
