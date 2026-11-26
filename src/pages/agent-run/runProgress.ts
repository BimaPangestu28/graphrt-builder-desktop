import type { FlowSummary } from '@/api/types'
import { formatNumber, messages } from '@/i18n'

/**
 * The expected steps of a run (from the flow summary) and the time formats the run screens
 * (06, 07 and 20) share. Step progress is read from events by `runSteps.ts`, the plain-language
 * feed by `runNarration.ts` and the pending question by `src/api/pauseReasons.ts`.
 */

/** A step the run is expected to go through, before any event arrives. */
export interface RunStepTemplate {
  id: string
  label: string
  /** 0 at the top level, 1 inside an iteration or loop, and so on. */
  depth?: number
  /** graphrt node kind (`llm`, `iteration`, `http-request`…), when known. */
  nodeType?: string | null
  /** The flow summary's one-line detail ("POST api.example.com", "over search_maps.places"). */
  detail?: string | null
}

/** graphrt bookkeeping kinds: they never show as steps. */
export const hiddenNodeKinds = new Set(['start', 'end', 'iteration-start', 'loop-start', 'loop-end'])

/** Kinds that call a model and stream text. */
export const modelNodeKinds = new Set(['llm', 'agent', 'question-classifier', 'parameter-extractor'])

/** Kinds that repeat a body of steps. */
export const containerNodeKinds = new Set(['iteration', 'loop'])

/**
 * The flow summary's steps, in flow order, without bookkeeping nodes.
 *
 * @param flowSummary - The agent's flow summary, or null while loading (FlowSummary | null)
 * @returns The expected steps (RunStepTemplate[])
 */
export function toRunStepTemplate(flowSummary: FlowSummary | null): RunStepTemplate[] {
  return (flowSummary?.steps ?? [])
    .filter((step) => !hiddenNodeKinds.has(step.nodeType))
    .map((step) => ({ id: step.id, label: step.title, depth: step.depth, nodeType: step.nodeType, detail: step.detail }))
}

/** "search_maps" → "Search maps", for nodes the UI has no title for. */
export function humanizeNodeId(nodeId: string): string {
  const spaced = nodeId.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * A step or run duration: "0.4s", "12.3s", "1m 12s", "1h 5m".
 *
 * @example
 * formatDurationMs(72_000) // "1m 12s"
 */
export function formatDurationMs(durationMs: number): string {
  const safeMs = Math.max(0, durationMs)
  const t = messages().agentRun
  if (safeMs < 60_000) return t.durationDecimalSeconds(formatNumber(safeMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
  const totalSeconds = Math.round(safeMs / 1000)
  if (totalSeconds < 3600) return t.durationMinutesSeconds(Math.floor(totalSeconds / 60), String(totalSeconds % 60).padStart(2, '0'))
  return t.durationHoursMinutes(Math.floor(totalSeconds / 3600), String(Math.floor((totalSeconds % 3600) / 60)))
}

/**
 * A ticking clock for elapsed time: "0:42", "12:05", "1:02:03".
 *
 * @example
 * formatElapsedClock(42_000) // "0:42"
 */
export function formatElapsedClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** "14s ago", "3m ago" or "2h ago" between two instants. */
export function formatElapsedSince(startedAt: string, now: Date = new Date()): string {
  const elapsedSeconds = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000))
  const t = messages().agentRun
  if (elapsedSeconds < 60) return t.secondsAgo(elapsedSeconds)
  if (elapsedSeconds < 3600) return t.minutesAgo(Math.floor(elapsedSeconds / 60))
  return t.hoursAgo(Math.floor(elapsedSeconds / 3600))
}
