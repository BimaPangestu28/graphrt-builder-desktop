import { callBackend, createProgressChannel, isDesktopApp } from './client'
import { sampleBuilderBackend } from './sampleBackend/builder'
import type { Agent, BuilderMessage, BuildProgress, BuildRequest, FlowSummary, RevisionResult } from './types'

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

/**
 * "Stop the builder": cancels the agent's running chat change. Its `reviseAgent` call then
 * rejects with `stopped`, nothing is saved, the Nodes view can edit again and the chat
 * notes "Stopped by you".
 *
 * @returns False when no change was running (Promise<boolean>)
 */
export function stopAgentRevision(agentId: string): Promise<boolean> {
  if (!isDesktopApp()) return sampleBuilderBackend.stopAgentRevision(agentId)
  return callBackend('stop_agent_revision', { agentId })
}

/** Steps, inputs and model providers of the agent's current version. */
export function getFlowSummary(agentId: string): Promise<FlowSummary> {
  if (!isDesktopApp()) return sampleBuilderBackend.getFlowSummary(agentId)
  return callBackend('get_flow_summary', { agentId })
}

/**
 * The agent's saved builder chat (change requests and the builder's replies), oldest first.
 *
 * @param agentId - Agent whose chat to read (string)
 * @returns Saved messages, oldest first (BuilderMessage[])
 * @throws BackendError - `not_found` for an unknown agent
 */
export function listBuilderMessages(agentId: string): Promise<BuilderMessage[]> {
  if (!isDesktopApp()) return sampleBuilderBackend.listBuilderMessages(agentId)
  return callBackend('list_builder_messages', { agentId })
}
