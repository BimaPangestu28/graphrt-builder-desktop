/**
 * Shapes shown on screen 09, the Home dashboard. Everything on Home comes from the backend
 * (runs, waiting chats, problems, plugin requirements, triggers, run stats, this month's
 * usage); sample content for the browser preview lives in `src/api/sampleBackend/`.
 */

/** What a "Needs you" row is about, most urgent first (see `needsYouKindOrder`). */
export type AttentionKind = 'approval' | 'chat' | 'failed_run' | 'setup' | 'schedule' | 'connection'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  title: string
  /** What it is about; may be long (a whole message), so it is shown clamped. */
  detail: string
  /** Small line under the detail: when, why and how many more (e.g. "Today 09:56 run · paused for your review"). */
  meta?: string
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
  agentId: string
  agentName: string
  /** Where the agent name links to. */
  agentPath: string
  /** Relative start time, e.g. "5 min ago", "Yesterday 07:00". */
  startedAt: string
  /** Full start time for the tooltip. */
  startedAtTitle: string
  /** Plain-language result: the summary headline, or the humanized error. */
  resultSummary: string
  status: RecentRunStatus
  /** The screen that shows this run. */
  runPath: string
}
