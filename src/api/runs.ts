import { callBackend, isDesktopApp, listenToBackend } from './client'
import { sampleRunsBackend } from './sampleBackend/runs'
import type { Run, RunEventPayload, RunEventRecord, RunFilter, RunTrigger } from './types'

/** Starting, resuming and reading runs, and their live events. */

export const RUN_EVENT = 'run-event'

/** Starts the agent's current version; events follow through {@link subscribeToRunEvents}. */
export function startRun(agentId: string, trigger: RunTrigger, inputs: Record<string, unknown>): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.startRun(agentId, trigger, inputs)
  return callBackend('start_run', { agentId, trigger, inputs })
}

/**
 * Continues a paused run. `nodeInputs` maps the paused node id to the answer,
 * e.g. `{ approve_message: { action: 'approve', values: { message } } }`.
 */
export function resumeRun(runId: string, nodeInputs: Record<string, unknown>): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.resumeRun(runId, nodeInputs)
  return callBackend('resume_run', { runId, nodeInputs })
}

export function abortRun(runId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.abortRun(runId)
  return callBackend('abort_run', { runId })
}

export function listRuns(filter?: RunFilter): Promise<Run[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.listRuns(filter)
  return callBackend('list_runs', { filter: filter ?? null })
}

export function getRun(runId: string): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.getRun(runId)
  return callBackend('get_run', { runId })
}

export function listRunEvents(runId: string): Promise<RunEventRecord[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.listRunEvents(runId)
  return callBackend('list_run_events', { runId })
}

/** Live events of every run. Returns an unsubscribe function. */
export function subscribeToRunEvents(onRunEvent: (payload: RunEventPayload) => void): Promise<() => void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunsBackend.subscribeToRunEvents(onRunEvent)
  return listenToBackend(RUN_EVENT, onRunEvent)
}
