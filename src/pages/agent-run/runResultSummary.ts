import type { RunSummary } from '@/api/runSummaryTypes'
import type { RunResultStat } from '@/pages/agent-run/testRunTypes'
import type { StatusPillTone } from './StatusPill'
import { formatCounterLabel, formatCounterValue } from './runCounters'

/**
 * What screen 07 shows for a run, built from its {@link RunSummary} (run output convention:
 * `summary` headline, `items` table, numeric counters as stat tiles). Only what the run
 * reported is shown: no items means no table, no counters means no counter tiles.
 */

export interface RunResultRow {
  id: string
  /** Name first, then the extra columns; the status is shown separately as a pill. */
  cells: string[]
  status: string
  statusTone: StatusPillTone
}

export interface RunResultTable {
  /** Header labels; the last one is the status column. */
  columns: string[]
  rows: RunResultRow[]
  /** Trailing row, e.g. "15 more places"; null when everything is listed. */
  moreLabel: string | null
}

export interface RunResultView {
  /** Up to four tiles: counters, then time and tokens. */
  stats: RunResultStat[]
  /** Null when the run listed no items. */
  table: RunResultTable | null
  /** "5 steps done · 1 skipped · You approved 1, skipped 1"; null when nothing ran. */
  activity: string | null
  /** True when the run reported neither items nor counters. */
  hasNoOutputs: boolean
  /** "Today 13:03 · on this computer" */
  meta: string
  /** The run's headline, or a plain status sentence. */
  builderReply: string
}

const maxStatTiles = 4
const maxCounterTiles = 3
const maxTableRows = 10
const maxExtraColumns = 2
const maxShortFieldLength = 40
const nameKeys = ['name', 'title']
const reservedItemKeys = new Set(['name', 'title', 'status', 'id'])
const okStatusPattern = /^(sent|done|ok|succeeded|success|approved|added|created|saved|posted|booked|replied|delivered|completed)$/
const failedStatusPattern = /^(failed|error|errored|rejected|bounced)$/

/** "41s", "2m 05s" or "1h 07m" from milliseconds. */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "41s" or "2m 05s"; null while the run has not finished. */
export function formatRunDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null
  return formatDurationMs(new Date(finishedAt).getTime() - new Date(startedAt).getTime())
}

/** "$0.004" with up to three decimals. */
export function formatAiCost(costUsd: number): string {
  return `$${Number(costUsd.toFixed(3))}`
}

function isSameLocalDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString()
}

/** "13:04" in the machine's zone. */
export function formatClockTime(isoTimestamp: string): string {
  const instant = new Date(isoTimestamp)
  return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
}

/** "Today 13:03", "Yesterday 07:00" or "16 Nov 07:00", relative to `now`. */
export function formatRunDay(isoTimestamp: string, now: Date = new Date()): string {
  const instant = new Date(isoTimestamp)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameLocalDay(instant, now)) return `Today ${formatClockTime(isoTimestamp)}`
  if (isSameLocalDay(instant, yesterday)) return `Yesterday ${formatClockTime(isoTimestamp)}`
  return `${instant.getDate()} ${instant.toLocaleString('en-GB', { month: 'short' })} ${formatClockTime(isoTimestamp)}`
}

/** Tone of an item status: sent/done → ok, failed → danger, anything else neutral. */
export function toneForItemStatus(status: string): StatusPillTone {
  const normalizedStatus = status.trim().toLowerCase()
  if (okStatusPattern.test(normalizedStatus)) return 'ok'
  if (failedStatusPattern.test(normalizedStatus)) return 'danger'
  return 'neutral'
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function readShortField(item: Record<string, unknown>, key: string): string | null {
  const fieldValue = item[key]
  if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) return String(fieldValue)
  if (typeof fieldValue === 'string' && fieldValue.length <= maxShortFieldLength) return fieldValue
  return null
}

function readItemName(item: Record<string, unknown>, index: number): string {
  for (const key of nameKeys) {
    const nameValue = readShortField(item, key) ?? (typeof item[key] === 'string' ? (item[key] as string) : null)
    if (nameValue) return nameValue
  }
  return `Item ${index + 1}`
}

/** Up to two keys whose values are short text or numbers in every item that has them. */
function pickExtraColumnKeys(items: Array<Record<string, unknown>>): string[] {
  const candidateKeys = [...new Set(items.flatMap((item) => Object.keys(item)))].filter((key) => !reservedItemKeys.has(key))
  return candidateKeys
    .filter((key) => items.every((item) => item[key] === undefined || item[key] === null || readShortField(item, key) !== null))
    .slice(0, maxExtraColumns)
}

/**
 * Generic table of a run's `items`: name/title, up to two other short fields, then status.
 *
 * @param items - The run's `items` output (Array<Record<string, unknown>>)
 * @returns The table, or null when there are no items (RunResultTable | null)
 */
export function buildItemTable(items: Array<Record<string, unknown>>): RunResultTable | null {
  if (items.length === 0) return null
  const extraKeys = pickExtraColumnKeys(items)
  const rows = items.slice(0, maxTableRows).map((item, index): RunResultRow => {
    const status = typeof item.status === 'string' && item.status.length > 0 ? item.status : 'done'
    return {
      id: `item-${index + 1}`,
      cells: [readItemName(item, index), ...extraKeys.map((key) => readShortField(item, key) ?? '')],
      status: capitalize(status),
      statusTone: toneForItemStatus(status),
    }
  })
  const hiddenItemCount = items.length - rows.length
  return {
    columns: ['Name', ...extraKeys.map(formatCounterLabel), 'Status'],
    rows,
    moreLabel: hiddenItemCount > 0 ? `${hiddenItemCount} more` : null,
  }
}

function buildStats(summary: RunSummary): RunResultStat[] {
  const counterTiles = summary.counters
    .slice(0, maxCounterTiles)
    .map((counter) => ({ label: formatCounterLabel(counter.name), value: formatCounterValue(counter.name, counter.value) }))
  const timeTiles = summary.durationMs === null ? [] : [{ label: 'Time', value: formatDurationMs(summary.durationMs) }]
  const tokenTiles = summary.usage ? [{ label: 'AI tokens', value: summary.usage.totalTokens.toLocaleString('en-US') }] : []
  return [...counterTiles, ...timeTiles, ...tokenTiles].slice(0, maxStatTiles)
}

function buildActivity(summary: RunSummary): string | null {
  const { steps, approvals } = summary
  const parts = [
    steps.succeeded > 0 ? `${steps.succeeded} ${steps.succeeded === 1 ? 'step' : 'steps'} done` : null,
    steps.skipped > 0 ? `${steps.skipped} skipped` : null,
    steps.failed > 0 ? `${steps.failed} failed` : null,
    approvals.approved + approvals.skipped > 0 ? `You approved ${approvals.approved}, skipped ${approvals.skipped}` : null,
    approvals.waiting > 0 ? `${approvals.waiting} waiting for you` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

function describeStatus(summary: RunSummary): string {
  switch (summary.status) {
    case 'succeeded':
      return 'The run finished'
    case 'failed':
      return `The run did not finish: ${summary.errorMessage ?? 'something went wrong'}`
    case 'paused':
      return 'The run is waiting for you'
    case 'aborted':
      return 'The run was stopped'
    default:
      return 'The run is still going'
  }
}

/**
 * Builds screen 07's content from a run summary.
 *
 * @param summary - The run's summary (RunSummary)
 * @returns Tiles, table and texts (RunResultView)
 */
export function buildRunResultView(summary: RunSummary): RunResultView {
  const builderReply = summary.status === 'failed' ? describeStatus(summary) : summary.headline ?? describeStatus(summary)
  return {
    stats: buildStats(summary),
    table: buildItemTable(summary.items),
    activity: buildActivity(summary),
    hasNoOutputs: summary.items.length === 0 && summary.counters.length === 0,
    meta: `${formatRunDay(summary.startedAt)} · on this computer`,
    builderReply,
  }
}
