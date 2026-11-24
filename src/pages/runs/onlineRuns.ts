import type { OnlineRun } from '@/api/deployTypes'
import type { RunRecord, RunStatus } from './runRecordTypes'

/** Runs filter: everything, only this computer, or only online agents and servers. */
export type RunsPlaceFilter = 'all' | 'local' | 'online'

export const placeFilterOptions: Array<{ key: RunsPlaceFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'local', label: 'On this computer' },
  { key: 'online', label: 'Online' },
]

/** Reads `?where=` (from "Open runs" after putting an agent online). */
export function toPlaceFilter(value: string | null): RunsPlaceFilter {
  return value === 'local' || value === 'online' ? value : 'all'
}

const statusByCloudStatus: Record<string, RunStatus> = {
  running: 'running',
  pending: 'running',
  queued: 'running',
  succeeded: 'done',
  success: 'done',
  completed: 'done',
  done: 'done',
  failed: 'failed',
  error: 'failed',
  paused: 'needsYou',
  waiting: 'needsYou',
  aborted: 'stopped',
  cancelled: 'stopped',
  canceled: 'stopped',
}

function formatWhen(isoTime: string | null, now: Date): string {
  if (!isoTime) return '—'
  const started = new Date(isoTime)
  if (Number.isNaN(started.getTime())) return '—'
  const clock = started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (started.getTime() >= startOfToday) return `Today ${clock}`
  if (started.getTime() >= startOfToday - 86_400_000) return `Yesterday ${clock}`
  return `${started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`
}

function describeDuration(run: OnlineRun['run']): string | null {
  if (!run.startedAt || !run.finishedAt) return null
  const seconds = Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
  if (!(seconds >= 0)) return null
  return seconds < 60 ? `took ${seconds} second${seconds === 1 ? '' : 's'}` : `took ${Math.round(seconds / 60)} min`
}

/**
 * One online run as a Runs row: the agent's name, "Online", and a plain result.
 *
 * @example
 * toOnlineRunRecord({ agentId: 'a1', sourceName: 'Menu chatbot', place: 'Fly.io', run }, new Date())
 */
export function toOnlineRunRecord(onlineRun: OnlineRun, now: Date = new Date()): RunRecord {
  const { run } = onlineRun
  const status = statusByCloudStatus[run.status.toLowerCase()] ?? 'done'
  const result = run.error ?? (status === 'running' ? 'Running online' : status === 'needsYou' ? 'Waiting for your approval' : 'Finished online')
  const timing = [formatWhen(run.startedAt, now), describeDuration(run), `ran online on ${onlineRun.place}`].filter(Boolean).join(' · ')
  return {
    id: `online:${onlineRun.place}:${run.id}`,
    agentId: onlineRun.agentId ?? undefined,
    agentName: onlineRun.sourceName,
    startedBy: onlineRun.place,
    when: formatWhen(run.startedAt, now),
    startedAt: run.startedAt ?? undefined,
    result,
    status,
    timing,
    steps: [],
    output: result,
    rawLog: [`run ${run.id} · ${run.status}${run.workflow ? ` · workflow ${run.workflow}` : ''}`],
    place: 'online',
  }
}

/** Local and online rows for the place filter, newest first when both are shown. */
export function mergeRunsByPlace(localRecords: RunRecord[], onlineRecords: RunRecord[], filter: RunsPlaceFilter): RunRecord[] {
  if (filter === 'local') return localRecords
  if (filter === 'online') return onlineRecords
  if (onlineRecords.length === 0) return localRecords
  return [...localRecords, ...onlineRecords].sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''))
}
