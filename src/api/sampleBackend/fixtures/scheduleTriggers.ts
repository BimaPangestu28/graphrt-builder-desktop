import type { ScheduleTrigger } from '@/lib/scheduleCalendar'

/**
 * The design's triggers for screen 10. The backend only has clock-based triggers so far, so the
 * browser preview shows the event and webhook ones from here.
 */

/** Weekday numbers follow Date#getUTCDay: 0 = Sunday, 1 = Monday ... 6 = Saturday. */
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const weekdaysOnly = [1, 2, 3, 4, 5]

export const sampleScheduleTriggers: ScheduleTrigger[] = [
  { id: 'maps-leads', agentName: 'Maps leads to WhatsApp', shortName: 'Maps leads', description: 'Weekdays at 09:00', iconKind: 'schedule', isEnabled: true, recurrence: { hour: 9, weekdays: weekdaysOnly } },
  { id: 'morning-digest', agentName: 'Morning email digest', shortName: 'Email digest', description: 'Every day at 07:00', iconKind: 'schedule', isEnabled: true, recurrence: { hour: 7, weekdays: everyDay } },
  { id: 'reply-drafts', agentName: 'Reply drafts', shortName: 'Reply drafts', description: 'When a new Google review arrives · checks every 15 min', iconKind: 'email', isEnabled: true },
  { id: 'form-responses', agentName: 'Form responses to sheet', shortName: 'Form responses', description: 'Webhook · localhost:7420/hooks/form', iconKind: 'webhook', isEnabled: true },
  { id: 'invoice-reminders', agentName: 'Invoice reminders', shortName: 'Invoices', description: 'Mondays at 10:00', iconKind: 'schedule', isEnabled: false, recurrence: { hour: 10, weekdays: [1] } },
]

/** The mock "today" the browser preview is pinned to (a Wednesday), so it matches the design. */
export const sampleScheduleToday = '2026-11-18'
/** Time zone of the browser preview's sample schedules. */
export const sampleScheduleTimeZone = 'Asia/Jakarta'
