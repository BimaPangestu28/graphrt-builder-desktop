import { useMemo } from 'react'
import { listAgents } from '@/api/agents'
import { initialScheduleTriggers } from '@/data/scheduler'
import { sampleAgentIdsByName } from '@/api/sampleBackend/sampleRunSeed'
import { useLoadedData } from './useRunData'

/** Names of the sample agents, used until (or when) the backend does not know an agent. */
const fallbackAgentNamesById: Record<string, string> = {
  ...Object.fromEntries(Object.entries(sampleAgentIdsByName).map(([agentName, agentId]) => [agentId, agentName])),
  ...Object.fromEntries(initialScheduleTriggers.map((trigger) => [trigger.id, trigger.agentName])),
}

/** Looks up an agent's display name; unknown ids fall back to the id itself. */
export type AgentNameLookup = (agentId: string) => string

/**
 * Agent names from {@link listAgents}, falling back to the sample agents' names.
 * A failed agent list is not fatal: names fall back the same way.
 */
export function useAgentNames(): AgentNameLookup {
  const { data: agents } = useLoadedData(() => listAgents(), [])
  return useMemo(() => {
    const namesById: Record<string, string> = { ...fallbackAgentNamesById }
    for (const agent of agents ?? []) namesById[agent.id] = agent.name
    return (agentId: string) => namesById[agentId] ?? agentId
  }, [agents])
}
