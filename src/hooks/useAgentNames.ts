import { useMemo } from 'react'
import { listAgents } from '@/api/agents'
import { getPreviewContent } from '@/api/previewContent'
import { useLoadedData } from './useRunData'

/** Looks up an agent's display name; unknown ids fall back to the id itself. */
export type AgentNameLookup = (agentId: string) => string

/**
 * Agent names from {@link listAgents}; in the browser preview, the sample agents' names fill in.
 * A failed agent list is not fatal: names fall back the same way.
 */
export function useAgentNames(): AgentNameLookup {
  const { data: agents } = useLoadedData(() => listAgents(), [])
  return useMemo(() => {
    // The browser preview's sample agents fill in for runs and triggers the agent list lacks.
    const namesById: Record<string, string> = { ...getPreviewContent()?.agentNamesById }
    for (const agent of agents ?? []) namesById[agent.id] = agent.name
    return (agentId: string) => namesById[agentId] ?? agentId
  }, [agents])
}
