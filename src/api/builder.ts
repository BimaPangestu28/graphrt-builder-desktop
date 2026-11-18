import { callBackend, createProgressChannel, isDesktopApp } from './client'
import { sampleBuilderBackend } from './sampleBackend/builder'
import type { Agent, BuildProgress, BuildRequest, FlowSummary, RevisionResult } from './types'

/** Drafting agents from plain language and reading their steps. */

/**
 * Drafts, validates and saves a new agent. `onProgress` receives each stage for screen 03.
 *
 * @throws BackendError - `missing_credentials` when no model provider is set up
 */
export async function buildAgent(request: BuildRequest, onProgress: (progress: BuildProgress) => void): Promise<Agent> {
  if (!isDesktopApp()) return sampleBuilderBackend.buildAgent(request, onProgress)
  const onProgressChannel = await createProgressChannel(onProgress)
  return callBackend('build_agent', { request, onProgress: onProgressChannel })
}

/** Applies a chat instruction ("make the message shorter") as a new version. */
export async function reviseAgent(agentId: string, instruction: string, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> {
  if (!isDesktopApp()) return sampleBuilderBackend.reviseAgent(agentId, instruction, onProgress)
  const onProgressChannel = await createProgressChannel(onProgress)
  return callBackend('revise_agent', { agentId, instruction, onProgress: onProgressChannel })
}

/** Steps, inputs and model providers of the agent's current version. */
export function getFlowSummary(agentId: string): Promise<FlowSummary> {
  if (!isDesktopApp()) return sampleBuilderBackend.getFlowSummary(agentId)
  return callBackend('get_flow_summary', { agentId })
}
