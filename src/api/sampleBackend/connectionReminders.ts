import type { ConnectionReminder } from '../connectionReminderTypes'
import { respondWith } from './sampleResponse'

/** The Home design's connection reminder, for the browser preview and tests. */
const sampleConnectionReminders: ConnectionReminder[] = [
  {
    id: 'gmail-expired',
    title: 'Gmail sign-in expired',
    detail: 'Morning email digest failed yesterday at 07:00',
    actionLabel: 'Reconnect Gmail',
  },
]

export const sampleConnectionRemindersBackend = {
  listConnectionReminders: (): Promise<ConnectionReminder[]> =>
    respondWith(() => sampleConnectionReminders.map((reminder) => ({ ...reminder }))),
}
