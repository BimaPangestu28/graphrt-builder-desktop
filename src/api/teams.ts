import { callBackend, isDesktopApp } from './client'
import { sampleTeamsBackend } from './sampleBackend/teams'
import type { CoordinatorExchange, TeamActivityEntry, TeamGuardrails } from './teamTypes'
import type { Run } from './types'

/** A team's activity, guardrails and coordinator chat (screen 13). Sample data outside the desktop app. */

/** What the team and its members did lately, newest first. */
export function listTeamActivity(teamAgentId: string): Promise<TeamActivityEntry[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTeamsBackend.listTeamActivity(teamAgentId)
  return callBackend('list_team_activity', { agentId: teamAgentId })
}

export function getTeamGuardrails(teamAgentId: string): Promise<TeamGuardrails> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTeamsBackend.getTeamGuardrails(teamAgentId)
  return callBackend('get_team_guardrails', { agentId: teamAgentId })
}

/**
 * Sets the most member-agent calls in one team run; `null` removes the limit.
 *
 * @throws BackendError - `invalid_input` for 0 or more than 100
 */
export function setTeamMaxAgentCalls(teamAgentId: string, limit: number | null): Promise<TeamGuardrails> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTeamsBackend.setTeamMaxAgentCalls(teamAgentId, limit)
  return callBackend('set_team_max_agent_calls', { agentId: teamAgentId, limit })
}

/** The team agent's recent runs as chat exchanges, oldest first. */
export function listCoordinatorChat(teamAgentId: string): Promise<CoordinatorExchange[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTeamsBackend.listCoordinatorChat(teamAgentId)
  return callBackend('list_coordinator_chat', { agentId: teamAgentId })
}

/**
 * Starts a run of the team agent with the message as its goal; its progress arrives as run events.
 *
 * @throws BackendError - `invalid_input` for a blank message or a team that needs other inputs
 */
export function sendCoordinatorMessage(teamAgentId: string, message: string): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTeamsBackend.sendCoordinatorMessage(teamAgentId, message)
  return callBackend('send_coordinator_message', { agentId: teamAgentId, message })
}
