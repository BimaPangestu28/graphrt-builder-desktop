import type { GraphrtEvent, RunEventRecord } from '@/api/types'
import type { TestRunStep, TestRunStepState } from '@/data/testRun'

/**
 * Turns a run's graphrt events into what screens 06, 07 and 20 show: per-step progress and
 * elapsed time. The pending question is read by `src/api/pauseReasons.ts`.
 */

/** A step the run is expected to go through, before any event arrives. */
export interface RunStepTemplate {
  id: string
  label: string
}

/** Latest known state of one node, read from its events. */
export interface NodeProgress {
  nodeId: string
  /** `title` sent with the node's events, if any. */
  title: string | null
  state: TestRunStepState
  detail: string | null
}

const stateByEventType: Record<string, TestRunStepState> = {
  node_started: 'running',
  node_progress: 'running',
  node_retry: 'running',
  node_chunk: 'running',
  node_succeeded: 'done',
  node_paused: 'waiting',
  node_failed: 'failed',
  node_skipped: 'skipped',
}

function readStringField(event: GraphrtEvent, fieldName: string): string | null {
  const fieldValue = event[fieldName]
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : null
}

function formatDurationMs(durationMs: unknown): string | null {
  return typeof durationMs === 'number' ? `${(durationMs / 1000).toFixed(1)}s` : null
}

/** "search_maps" → "Search maps", for nodes the UI has no title for. */
export function humanizeNodeId(nodeId: string): string {
  const spaced = nodeId.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Reads every node's latest state from the events, in the order nodes first appeared.
 *
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @returns One entry per node (NodeProgress[])
 */
export function collectNodeProgress(events: RunEventRecord[]): NodeProgress[] {
  const progressByNodeId = new Map<string, NodeProgress>()
  for (const { event } of events) {
    const state = stateByEventType[event.type]
    if (!state || !event.node_id) continue
    const previous = progressByNodeId.get(event.node_id)
    progressByNodeId.set(event.node_id, {
      nodeId: event.node_id,
      title: readStringField(event, 'title') ?? previous?.title ?? null,
      state,
      detail: readStringField(event, 'detail') ?? formatDurationMs(event.duration_ms) ?? (state === 'running' ? null : previous?.detail ?? null),
    })
  }
  return [...progressByNodeId.values()]
}

/**
 * Lays live progress over the expected steps. Steps without events stay "pending"; nodes the
 * template does not know are appended so nothing the run did is hidden.
 */
export function buildStepProgress(template: RunStepTemplate[], events: RunEventRecord[]): TestRunStep[] {
  const nodeProgress = collectNodeProgress(events)
  const progressByNodeId = new Map(nodeProgress.map((progress) => [progress.nodeId, progress]))
  const templateIds = new Set(template.map((step) => step.id))
  const templateSteps = template.map((step): TestRunStep => {
    const progress = progressByNodeId.get(step.id)
    return { id: step.id, label: step.label, state: progress?.state ?? 'pending', detail: progress?.detail ?? undefined }
  })
  const extraSteps = nodeProgress
    .filter((progress) => !templateIds.has(progress.nodeId))
    .map((progress): TestRunStep => ({
      id: progress.nodeId,
      label: progress.title ?? humanizeNodeId(progress.nodeId),
      state: progress.state,
      detail: progress.detail ?? undefined,
    }))
  return [...templateSteps, ...extraSteps]
}

/** "14s ago", "3m ago" or "2h ago" between two instants. */
export function formatElapsedSince(startedAt: string, now: Date = new Date()): string {
  const elapsedSeconds = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`
  return `${Math.floor(elapsedSeconds / 3600)}h ago`
}
