import type { UsageSummary } from '@/api/usageSummaryTypes'

/** "This month" card (Home, 09): the window start and the rows shown from a usage summary. */

export interface MonthlyUsageRow {
  label: string
  value: string
}

/** Midnight on the 1st of `now`'s month, in the machine's zone. */
export function startOfLocalMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/**
 * Short token count: "850", "4.2K", "412K", "1.3M".
 *
 * @param tokenCount - Tokens (number)
 */
export function formatTokenCount(tokenCount: number): string {
  if (tokenCount < 1000) return String(Math.round(tokenCount))
  if (tokenCount < 10_000) return `${(tokenCount / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (tokenCount < 1_000_000) return `${Math.round(tokenCount / 1000)}K`
  return `${(tokenCount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * Rows of the card: runs started this month and the AI tokens they used. There is no cost
 * row: graphrt does not know each provider's prices, so it would be a guess.
 *
 * @param summary - From `getUsageSummary` (UsageSummary)
 * @returns The rows (MonthlyUsageRow[])
 */
export function buildMonthlyUsageRows(summary: UsageSummary): MonthlyUsageRow[] {
  return [
    { label: 'Runs', value: String(summary.runCount) },
    { label: 'AI tokens', value: formatTokenCount(summary.usage.totalTokens) },
  ]
}
