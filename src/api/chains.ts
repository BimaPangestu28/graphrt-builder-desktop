import { callBackend, createProgressChannel, isDesktopApp } from './client'
import { sampleChainsBackend } from './sampleBackend/chains'
import type { AgentStepInfo, Chain, ChainDraft, ChainStatus, TeamOverview } from './chainTypes'
import type { BuildProgress, RevisionResult, Run } from './types'

/** Chains of agents, agents used as steps, and teams. Sample data outside the desktop app. */

export function listChains(): Promise<Chain[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.listChains()
  return callBackend('list_chains')
}

export function getChain(chainId: string): Promise<Chain> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.getChain(chainId)
  return callBackend('get_chain', { chainId })
}

/** New chains are paused until activated. */
export function createChain(draft: ChainDraft): Promise<Chain> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.createChain(draft)
  return callBackend('create_chain', { draft })
}

/** Replaces the name and every step. */
export function updateChain(chainId: string, draft: ChainDraft): Promise<Chain> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.updateChain(chainId, draft)
  return callBackend('update_chain', { chainId, draft })
}

export function deleteChain(chainId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.deleteChain(chainId)
  return callBackend('delete_chain', { chainId })
}

export function setChainStatus(chainId: string, status: ChainStatus): Promise<Chain> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.setChainStatus(chainId, status)
  return callBackend('set_chain_status', { chainId, status })
}

/** Starts the first agent; the chain continues on its own, even while paused. */
export function testChain(chainId: string): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.testChain(chainId)
  return callBackend('test_chain', { chainId })
}

/** Every agent with its inputs and outputs, and whether it can run as a step. */
export function listAgentSteps(): Promise<AgentStepInfo[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.listAgentSteps()
  return callBackend('list_agent_steps')
}

/** A team agent's coordinator step and member agents. */
export function getTeam(agentId: string): Promise<TeamOverview> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.getTeam(agentId)
  return callBackend('get_team', { agentId })
}

/**
 * Adds another agent as a `tool` step of `targetAgentId`, through the builder (a new version).
 *
 * @param placement - Plain words for where it goes, e.g. "after Search Google Maps" (string | null)
 * @throws BackendError - `invalid_input` when the agent cannot run as a step, `missing_credentials` without a model key
 */
export async function addAgentStep(
  request: { targetAgentId: string; stepAgentId: string; placement: string | null },
  onProgress: (progress: BuildProgress) => void,
): Promise<RevisionResult> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.addAgentStep(request, onProgress)
  const onProgressChannel = await createProgressChannel(onProgress)
  return callBackend('add_agent_step', { ...request, onProgress: onProgressChannel })
}

/** Gives the team's coordinator another member agent as a tool (a new version of the team agent). */
export async function addTeamMember(teamAgentId: string, memberAgentId: string, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChainsBackend.addTeamMember(teamAgentId, memberAgentId, onProgress)
  const onProgressChannel = await createProgressChannel(onProgress)
  return callBackend('add_team_member', { teamAgentId, memberAgentId, onProgress: onProgressChannel })
}
