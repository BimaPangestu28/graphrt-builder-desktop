import type { Agent, BuildProgress, BuildRequest, FlowSummary, RevisionResult } from '../types'
import { sampleNotImplemented } from './notImplemented'

/** Sample agent building for the browser preview and tests. */
export const sampleBuilderBackend = {
  buildAgent: (_request: BuildRequest, _onProgress: (progress: BuildProgress) => void): Promise<Agent> => sampleNotImplemented('buildAgent'),
  reviseAgent: (_agentId: string, _instruction: string, _onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> =>
    sampleNotImplemented('reviseAgent'),
  getFlowSummary: (_agentId: string): Promise<FlowSummary> => Promise.resolve({ steps: [], inputs: [], modelProviders: [] }),
}
