import type { Run, RunEventPayload, RunEventRecord, RunFilter, RunTrigger } from '../types'
import { sampleNotImplemented } from './notImplemented'

/** Sample runs for the browser preview and tests. */
export const sampleRunsBackend = {
  startRun: (_agentId: string, _trigger: RunTrigger, _inputs: Record<string, unknown>): Promise<Run> => sampleNotImplemented('startRun'),
  resumeRun: (_runId: string, _nodeInputs: Record<string, unknown>): Promise<Run> => sampleNotImplemented('resumeRun'),
  abortRun: (_runId: string): Promise<void> => Promise.resolve(),
  listRuns: (_filter?: RunFilter): Promise<Run[]> => Promise.resolve([]),
  getRun: (runId: string): Promise<Run> => sampleNotImplemented(`getRun(${runId})`),
  listRunEvents: (_runId: string): Promise<RunEventRecord[]> => Promise.resolve([]),
  subscribeToRunEvents: (_onRunEvent: (payload: RunEventPayload) => void): Promise<() => void> => Promise.resolve(() => {}),
}
