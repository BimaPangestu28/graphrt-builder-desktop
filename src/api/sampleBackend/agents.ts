import type { Agent, AgentStatus, AgentVersion } from '../types'
import {
  listStoredAgents,
  listStoredVersions,
  readStoredAgent,
  removeStoredAgent,
  resetSampleAgentStore,
  restoreStoredVersion,
  updateStoredAgent,
} from './sampleAgentStore'
import { recordSampleRestore } from './sampleBuilderHistory'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample agents for the browser preview and tests: the agents the screens show
 * ("maps-leads" and friends) with their version history, kept in module memory.
 */
export const sampleAgentsBackend = {
  listAgents: (): Promise<Agent[]> => respondWith(listStoredAgents),
  getAgent: (agentId: string): Promise<Agent> => respondWith(() => readStoredAgent(agentId)),
  renameAgent: (agentId: string, name: string): Promise<Agent> =>
    respondWith(() => updateStoredAgent(agentId, { name: requireText(name, 'give the agent a name') })),
  setAgentStatus: (agentId: string, status: AgentStatus): Promise<Agent> => respondWith(() => updateStoredAgent(agentId, { status })),
  deleteAgent: (agentId: string): Promise<void> => respondWith(() => removeStoredAgent(agentId)),
  listAgentVersions: (agentId: string): Promise<AgentVersion[]> => respondWith(() => listStoredVersions(agentId)),
  restoreAgentVersion: (agentId: string, version: number): Promise<Agent> =>
    respondWith(() => {
      const agentBefore = readStoredAgent(agentId)
      const restoredAgent = restoreStoredVersion(agentId, version)
      recordSampleRestore(agentBefore, restoredAgent, version)
      return restoredAgent
    }),
}

/** Restores the sample agents and their versions to the seed data (use in test `beforeEach`). */
export function resetSampleAgents(): void {
  resetSampleAgentStore()
}
