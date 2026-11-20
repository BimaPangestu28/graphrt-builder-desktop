import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { listAgentPluginRequirements } from '@/api/plugins'
import type { Agent } from '@/api/types'
import { useAgents } from '@/hooks/useAgents'
import { useAsyncData } from '@/hooks/useAsyncData'

/** One agent whose current workflow uses a plugin. */
export interface PluginUser {
  agentId: string
  agentName: string
  /** Step titles that use the plugin, e.g. ["Search Google Maps"]. */
  usedBySteps: string[]
  /** The plugin is fully set up for this agent (installed, trusted, settings, browser, session). */
  isReady: boolean
}

/**
 * The agents whose requirements name the plugin, in the agents' order.
 *
 * @param agents - Every agent (Agent[])
 * @param requirementsByAgentId - Each agent's plugin requirements; agents missing here are skipped (Map)
 * @param pluginName - e.g. "google-maps-scraper" (string)
 * @returns The agents using it (PluginUser[])
 */
export function findPluginUsers(agents: Agent[], requirementsByAgentId: Map<string, PluginRequirement[]>, pluginName: string): PluginUser[] {
  return agents.flatMap((agent) => {
    const requirement = requirementsByAgentId.get(agent.id)?.find((candidate) => candidate.name === pluginName)
    return requirement ? [{ agentId: agent.id, agentName: agent.name, usedBySteps: requirement.usedBySteps, isReady: requirement.ready }] : []
  })
}

/** Each agent's plugin requirements; an agent whose requirements cannot be read is left out (logged). */
async function loadRequirementsByAgentId(agents: Agent[]): Promise<Map<string, PluginRequirement[]>> {
  const entries = await Promise.all(
    agents.map(async (agent) => {
      try {
        return [[agent.id, await listAgentPluginRequirements(agent.id)] as const]
      } catch (requirementsError) {
        console.warn(`Could not read the plugin requirements of agent ${agent.id}`, requirementsError)
        return []
      }
    }),
  )
  return new Map(entries.flat())
}

/**
 * Which agents use a plugin, computed on this side from every agent's plugin requirements.
 *
 * @param pluginName - The plugin (string)
 * @param refreshKey - Changes when the plugin's install state changes, so readiness reloads (string)
 * @returns `{ data: PluginUser[] | null, error }` (null while loading)
 */
export function usePluginUsers(pluginName: string, refreshKey: string) {
  const { data: agents, error: agentsError } = useAgents()
  const agentIdsKey = agents?.map((agent) => agent.id).join(',') ?? null
  const usersState = useAsyncData(async () => {
    if (!agents) return null
    return findPluginUsers(agents, await loadRequirementsByAgentId(agents), pluginName)
    // agentIdsKey stands for `agents`; refreshKey reloads readiness after install, trust or settings.
  }, [pluginName, agentIdsKey, refreshKey])
  return { data: usersState.data, error: agentsError ?? usersState.error }
}
