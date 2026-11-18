import { callBackend, isDesktopApp } from './client'
import { sampleAgentsBackend } from './sampleBackend/agents'
import type { Agent, AgentStatus, AgentVersion } from './types'

/** Agents and their version history. Sample data outside the desktop app. */

export function listAgents(): Promise<Agent[]> {
  if (!isDesktopApp()) return sampleAgentsBackend.listAgents()
  return callBackend('list_agents')
}

export function getAgent(agentId: string): Promise<Agent> {
  if (!isDesktopApp()) return sampleAgentsBackend.getAgent(agentId)
  return callBackend('get_agent', { agentId })
}

export function renameAgent(agentId: string, name: string): Promise<Agent> {
  if (!isDesktopApp()) return sampleAgentsBackend.renameAgent(agentId, name)
  return callBackend('rename_agent', { agentId, name })
}

export function setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent> {
  if (!isDesktopApp()) return sampleAgentsBackend.setAgentStatus(agentId, status)
  return callBackend('set_agent_status', { agentId, status })
}

export function deleteAgent(agentId: string): Promise<void> {
  if (!isDesktopApp()) return sampleAgentsBackend.deleteAgent(agentId)
  return callBackend('delete_agent', { agentId })
}

export function listAgentVersions(agentId: string): Promise<AgentVersion[]> {
  if (!isDesktopApp()) return sampleAgentsBackend.listAgentVersions(agentId)
  return callBackend('list_agent_versions', { agentId })
}

export function restoreAgentVersion(agentId: string, version: number): Promise<Agent> {
  if (!isDesktopApp()) return sampleAgentsBackend.restoreAgentVersion(agentId, version)
  return callBackend('restore_agent_version', { agentId, version })
}
