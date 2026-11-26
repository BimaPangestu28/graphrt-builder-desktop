import type { RunCounter } from '@/api/runSummaryTypes'
import type { Run } from '@/api/types'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { formatCounterLabel, formatCounterValue, isMoneyCounter, pickHeadlineCounter } from '@/pages/agent-run/runCounters'
import { messages } from '@/i18n'

/** "This month" card (Home, 09): the window start and the numbers shown. */

export interface MonthlyUsageRow {
  label: string
  value: string
}

export interface MonthlyNumbers {
  rows: MonthlyUsageRow[]
  /** No run and no token this month. */
  isEmpty: boolean
}

const maxCounterRows = 2

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

/** Numeric run outputs (the run output convention's counters), money excluded. */
function readRunCounters(run: Run): RunCounter[] {
  return Object.entries(run.outputs ?? {}).flatMap(([name, value]) =>
    typeof value === 'number' && Number.isFinite(value) && !isMoneyCounter(name) ? [{ name, value }] : [],
  )
}

/** Counters summed over runs. */
function sumRunCounters(runs: Run[]): RunCounter[] {
  const totals = new Map<string, number>()
  runs.flatMap(readRunCounters).forEach((counter) => totals.set(counter.name, (totals.get(counter.name) ?? 0) + counter.value))
  return [...totals].map(([name, value]) => ({ name, value }))
}

/** Up to two counters that best say what the agents did ("Messages sent" before "Places found"). */
function pickMonthCounters(counters: RunCounter[]): RunCounter[] {
  const picked: RunCounter[] = []
  let remaining = counters.filter((counter) => counter.value > 0)
  while (picked.length < maxCounterRows) {
    const headline = pickHeadlineCounter(remaining)
    if (!headline) break
    picked.push(headline)
    remaining = remaining.filter((counter) => counter !== headline)
  }
  return picked
}

/**
 * Numbers of the "This month" card: runs that succeeded and failed since `monthStart`, what
 * the agents did (summed run counters such as `messages_sent`) and the AI tokens used. There
 * is no cost row: graphrt does not know each provider's prices, so it would be a guess.
 *
 * @param usageSummary - From `getUsageSummary`, or null when unavailable (UsageSummary | null)
 * @param runs - Recent runs (Run[])
 * @param monthStart - Start of the month (Date)
 * @returns The rows and whether everything is zero (MonthlyNumbers)
 *
 * @example
 * buildMonthlyNumbers(summary, runs, startOfLocalMonth()).rows
 * // [{ label: 'Runs succeeded', value: '12' }, { label: 'Runs failed', value: '1' }, { label: 'Messages sent', value: '47' }, { label: 'AI tokens', value: '48K' }]
 */
export function buildMonthlyNumbers(usageSummary: UsageSummary | null, runs: Run[], monthStart: Date): MonthlyNumbers {
  const monthRuns = runs.filter((run) => new Date(run.startedAt).getTime() >= monthStart.getTime())
  const succeededRuns = monthRuns.filter((run) => run.status === 'succeeded')
  const failedCount = monthRuns.filter((run) => run.status === 'failed').length
  const totalTokens = usageSummary?.usage.totalTokens ?? 0
  const t = messages().home
  const rows: MonthlyUsageRow[] = [
    { label: t.runsSucceeded, value: String(succeededRuns.length) },
    { label: t.runsFailed, value: String(failedCount) },
    ...pickMonthCounters(sumRunCounters(succeededRuns)).map((counter) => ({
      label: formatCounterLabel(counter.name),
      value: formatCounterValue(counter.name, Math.round(counter.value)),
    })),
    ...(usageSummary ? [{ label: t.aiTokens, value: formatTokenCount(totalTokens) }] : []),
  ]
  const hasRuns = monthRuns.length > 0 || (usageSummary?.runCount ?? 0) > 0
  return { rows, isEmpty: !hasRuns && totalTokens === 0 }
}
