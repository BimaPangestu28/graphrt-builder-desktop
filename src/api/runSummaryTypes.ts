import type { RunStatus } from './types'

/**
 * Run summaries returned by the backend. Mirrors the serde types in
 * `src-tauri/src/run_summary.rs`; keep both sides in sync.
 *
 * Runs follow the output convention in `src-tauri/src/flow/format_guide.md` ("Run outputs"):
 * the `end` node outputs `summary` (one sentence), optionally `items` (one object per thing
 * processed, with `name`/`title` and `status`) and numeric counters such as `messages_sent`.
 */

/** Finished steps by outcome (start/end bookkeeping nodes are not counted). */
export interface StepCounts {
  succeeded: number
  failed: number
  skipped: number
}

/** Answers to "ask me first" steps; `waiting` is what a paused run waits on now. */
export interface ApprovalCounts {
  approved: number
  skipped: number
  waiting: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** A numeric run output, e.g. `{ name: 'messages_sent', value: 11 }`. */
export interface RunCounter {
  name: string
  value: number
}

export interface RunSummary {
  runId: string
  agentId: string
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  /** Start to finish, including time waiting for the user; null until finished. */
  durationMs: number | null
  steps: StepCounts
  approvals: ApprovalCounts
  usage: TokenUsage | null
  /** The run's `summary` output. */
  headline: string | null
  /** The run's `items` output (objects only). */
  items: Array<Record<string, unknown>>
  counters: RunCounter[]
  errorMessage: string | null
}

/** One agent's runs over the last 7 days, for its Home card. */
export interface AgentRunStats {
  agentId: string
  runsThisWeek: number
  succeeded: number
  failed: number
  paused: number
  /** The agent's latest run ever, not only this week's. */
  lastRunStatus: RunStatus | null
  lastRunAt: string | null
  /** Counters summed over this week's runs. */
  counters: RunCounter[]
}
