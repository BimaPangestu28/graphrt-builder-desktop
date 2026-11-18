import type { Agent, AgentStatus, AgentVersion } from '../types'
import { sampleNotImplemented } from './notImplemented'

/** Sample agents for the browser preview and tests. */
export const sampleAgentsBackend = {
  listAgents: (): Promise<Agent[]> => Promise.resolve([]),
  getAgent: (agentId: string): Promise<Agent> => sampleNotImplemented(`getAgent(${agentId})`),
  renameAgent: (_agentId: string, _name: string): Promise<Agent> => sampleNotImplemented('renameAgent'),
  setAgentStatus: (_agentId: string, _status: AgentStatus): Promise<Agent> => sampleNotImplemented('setAgentStatus'),
  deleteAgent: (_agentId: string): Promise<void> => sampleNotImplemented('deleteAgent'),
  listAgentVersions: (_agentId: string): Promise<AgentVersion[]> => Promise.resolve([]),
  restoreAgentVersion: (_agentId: string, _version: number): Promise<Agent> => sampleNotImplemented('restoreAgentVersion'),
}
