/**
 * Shapes shown on screen 09, the Home dashboard. Everything on Home comes from the backend
 * (paused runs, waiting chats, triggers, run stats, recent runs, this month's usage); sample
 * content for the browser preview lives in `src/api/sampleBackend/`.
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

export interface AgentSummaryStat {
  /** Bold number before the label; omitted for plain text stats like "Last run ok". */
  count?: number
  label: string
}

export type RecentRunStatus = 'Needs you' | 'Done' | 'Failed' | 'Running' | 'Stopped'

export interface RecentRun {
  id: string
  agentName: string
  startedAt: string
  resultSummary: string
  status: RecentRunStatus
}
