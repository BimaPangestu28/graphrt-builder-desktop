import { routePaths } from '@/routes'

/** Mock data for screen 09, the Home dashboard once agents are running. */

export interface AttentionItem {
  id: string
  title: string
  detail: string
  actionLabel: string
  actionPath: string
  /** The most urgent item gets the filled ink button; the rest are outlined. */
  isPrimaryAction: boolean
}

export const attentionItems: AttentionItem[] = [
  {
    id: 'review-messages',
    title: 'Maps leads to WhatsApp wants to send 12 messages',
    detail: 'Weekday run 09:00 · paused for your review',
    actionLabel: 'Review messages',
    actionPath: routePaths.batchApproval,
    isPrimaryAction: true,
  },
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

/**
 * Schedule line and run stats on each Home agent card, keyed by agent id. The agents come
 * from `listAgents`; schedules and run counts stay mock data until triggers and runs are
 * wired to Home.
 */
export interface AgentActivity {
  scheduleSummary: string
  stats: AgentSummaryStat[]
}

export const agentActivityById: Record<string, AgentActivity> = {
  'maps-leads': {
    scheduleSummary: 'Weekdays 09:00 · 6 steps',
    stats: [
      { count: 47, label: 'sent this week' },
      { count: 9, label: 'replies' },
    ],
  },
  'morning-digest': {
    scheduleSummary: 'Every day 07:00 · 4 steps',
    stats: [{ count: 5, label: 'runs this week' }, { label: 'Last run ok' }],
  },
  'invoice-reminders': {
    scheduleSummary: 'Mondays 10:00 · 5 steps',
    stats: [{ label: 'Paused by you on 12 Nov' }],
  },
}

export type RecentRunStatus = 'Needs you' | 'Done' | 'Failed'

export interface RecentRun {
  id: string
  agentName: string
  startedAt: string
  resultSummary: string
  status: RecentRunStatus
}

export const recentRuns: RecentRun[] = [
  { id: 'run-4', agentName: 'Maps leads to WhatsApp', startedAt: 'Today 09:00', resultSummary: '12 messages ready', status: 'Needs you' },
  { id: 'run-3', agentName: 'Morning email digest', startedAt: 'Today 07:00', resultSummary: '8 emails summarized', status: 'Done' },
  { id: 'run-2', agentName: 'Maps leads to WhatsApp', startedAt: 'Yesterday 09:00', resultSummary: '15 sent · 1 skipped', status: 'Done' },
  { id: 'run-1', agentName: 'Morning email digest', startedAt: 'Yesterday 07:00', resultSummary: 'Gmail sign-in expired', status: 'Failed' },
]

export const monthlyUsage = [
  { label: 'Runs', value: '64' },
  { label: 'AI cost on your key', value: '$0.38' },
  { label: 'Time saved', value: '[ESTIMATE]' },
]
