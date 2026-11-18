import type { TokenUsage } from './runSummaryTypes'

/**
 * Run and model-token totals since a date, for the Home "This month" card (09).
 * Mirrors `UsageSummary` in `src-tauri/src/usage_summary.rs`; keep both sides in sync.
 */
export interface UsageSummary {
  /** Start of the window, normalised to UTC (RFC 3339). */
  from: string
  /** Runs started at or after `from`, whatever their status. */
  runCount: number
  /** Runs among them where a model call reported token usage. */
  runsWithUsage: number
  /** Tokens summed over those runs. */
  usage: TokenUsage
}
