import { routePaths } from '@/routes'

/**
 * Data for screen 09, the Home dashboard. Paused runs, agent run stats and recent runs come
 * from the backend; what is left here is preview-only sample content (Inbox and connection
 * reminders, schedule lines, monthly usage) not yet backed by the runtime.
 */

export interface AttentionItem {
  id: string
  title: string
  detail: string
  actionLabel: string
  actionPath: string
  /** The most urgent item gets the filled ink button; the rest are outlined. */
  isPrimaryAction: boolean
}

/** Inbox and connection reminders shown under the paused runs in the browser preview only. */
export const sampleAttentionItems: AttentionItem[] = [
  {
    id: 'inbox-waiting',
    title: '2 customers are waiting in Inbox',
    detail: 'Catering assistant passed them to you · oldest 9 minutes',
    actionLabel: 'Open Inbox',
    actionPath: routePaths.inbox,
    isPrimaryAction: false,
  },
  {
    id: 'gmail-expired',
    title: 'Gmail sign-in expired',
    detail: 'Morning email digest failed yesterday at 07:00',
    actionLabel: 'Reconnect Gmail',
    actionPath: routePaths.connections,
    isPrimaryAction: false,
  },
]

export interface AgentSummaryStat {
  /** Bold number before the label; omitted for plain text stats like "Last run ok". */
  count?: number
  label: string
}

/** Schedule line on the sample agents' Home cards, keyed by agent id (preview content). */
export const agentScheduleSummaryById: Record<string, string> = {
  'maps-leads': 'Weekdays 09:00 · 6 steps',
  'morning-digest': 'Every day 07:00 · 4 steps',
  'invoice-reminders': 'Mondays 10:00 · 5 steps',
}

export type RecentRunStatus = 'Needs you' | 'Done' | 'Failed' | 'Running' | 'Stopped'

export interface RecentRun {
  id: string
  agentName: string
  startedAt: string
  resultSummary: string
  status: RecentRunStatus
}

export const monthlyUsage = [
  { label: 'Runs', value: '64' },
  { label: 'AI cost on your key', value: '$0.38' },
  { label: 'Time saved', value: '[ESTIMATE]' },
]
