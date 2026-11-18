import { getAgent } from '@/api/agents'
import type { Agent, AgentStatus } from '@/api/types'
import type { SidebarAgentsState } from '@/components/layout'
import { useLoadedData } from '@/hooks/useRunData'

const agentStatusLabels: Record<AgentStatus, string> = {
  draft: 'Draft',
  tested: 'Tested',
  active: 'Active',
  paused: 'Paused',
}

interface SidebarAgentOptions {
  /** Replaces the agent's own status, e.g. "Testing · waiting for you". */
  status?: string
  statusTone?: 'brand' | 'amber'
}

/**
 * The sidebar's agent section on screens 06 and 07: the agent's real name and status once it
 * has loaded, the plain agent list before that (or when it cannot be read).
 */
export function buildRunSidebarAgents(agentId: string, agent: Agent | null, options: SidebarAgentOptions = {}): SidebarAgentsState {
  if (!agent) return { kind: 'list', activeAgentId: agentId }
  return { kind: 'draft', name: agent.name, status: options.status ?? agentStatusLabels[agent.status], statusTone: options.statusTone, agentId }
}

/** Loads the agent a run screen belongs to. */
export function useRunAgent(agentId: string): Agent | null {
  return useLoadedData(() => getAgent(agentId), [agentId]).data
}
