import type { RunRecord } from './runRecordTypes'
import type { RunsPlaceFilter } from './onlineRuns'

/**
 * What the Runs screen shows instead of the table when there are no rows:
 * - `loading`: runs (or agents) are still being read
 * - `noAgents`: nothing ran because there is no agent yet (offer "New agent")
 * - `noRunsYet`: there are agents, but none has run yet
 * - `noOnlineRuns`: "Online" is picked and no agent has run online yet
 * - `noMatch`: there are runs, the filters hide all of them (offer "Clear filters")
 */
export type RunsEmptyState = 'loading' | 'noAgents' | 'noRunsYet' | 'noOnlineRuns' | 'noMatch'

export interface RunsEmptyStateInput {
  /** Rows shown with the current filters. */
  visibleRunCount: number
  /** Runs on this computer, any agent and status; null while loading. */
  localRunCount: number | null
  /** Online runs, any agent and status; null while loading (0 when they could not be read). */
  onlineRunCount: number | null
  /** Agents on this computer; null while loading. */
  agentCount: number | null
  placeFilter: RunsPlaceFilter
  /** An agent or status filter is set (not "All agents" / "All"). */
  hasAgentOrStatusFilter: boolean
}

/**
 * Picks the empty state for the Runs screen, or null when there are rows to show.
 *
 * @example
 * chooseRunsEmptyState({ visibleRunCount: 0, localRunCount: 0, onlineRunCount: 0, agentCount: 0, placeFilter: 'all', hasAgentOrStatusFilter: false })
 * // 'noAgents'
 */
export function chooseRunsEmptyState(input: RunsEmptyStateInput): RunsEmptyState | null {
  const { visibleRunCount, localRunCount, onlineRunCount, agentCount, placeFilter, hasAgentOrStatusFilter } = input
  if (visibleRunCount > 0) return null
  if (localRunCount === null) return 'loading'
  if (placeFilter === 'online' && !hasAgentOrStatusFilter) return onlineRunCount === null ? 'loading' : 'noOnlineRuns'
  if (localRunCount > 0 || (onlineRunCount ?? 0) > 0) return 'noMatch'
  // No local runs. Wait for the online list and the agents before saying there is nothing at all.
  if (onlineRunCount === null || agentCount === null) return 'loading'
  return agentCount === 0 ? 'noAgents' : 'noRunsYet'
}

/** Counts for the "Today" summary above the Runs table. */
export interface RunsTodaySummary {
  /** Runs started today. */
  started: number
  /** Runs started today that finished fine. */
  done: number
  /** Runs started today that failed. */
  failed: number
  /** Runs waiting for the user right now, whenever they started. */
  needsYou: number
}

function isSameLocalDay(first: Date, second: Date): boolean {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

/**
 * Today's counts across local and online runs, by the machine's local day.
 *
 * @param records - Every run, unfiltered: its status and start time
 * @param now - Reference time (Date)
 */
export function summarizeRunsToday(records: ReadonlyArray<Pick<RunRecord, 'status' | 'startedAt'>>, now: Date = new Date()): RunsTodaySummary {
  const summary: RunsTodaySummary = { started: 0, done: 0, failed: 0, needsYou: 0 }
  for (const record of records) {
    if (record.status === 'needsYou') summary.needsYou += 1
    if (!record.startedAt) continue
    const startedAt = new Date(record.startedAt)
    if (Number.isNaN(startedAt.getTime()) || !isSameLocalDay(startedAt, now)) continue
    summary.started += 1
    if (record.status === 'done') summary.done += 1
    if (record.status === 'failed') summary.failed += 1
  }
  return summary
}
