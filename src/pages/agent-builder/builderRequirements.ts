import type { ProviderStatus } from '@/api/types'
import { appRequirementsByAgentId } from '@/data/mapsLeadsAgent'
import { getProviderName } from '@/lib/agentDisplay'
import { agentPath, routePaths } from '@/routes'
import type { BuilderRequirement } from './AgentRequirementsList'

/**
 * Lists what an agent needs on screen 04: connected apps first, then the model keys its
 * flow uses (from the flow summary and provider statuses), then apps still to connect.
 *
 * @param agentId - Agent shown in the builder (string)
 * @param modelProviders - `FlowSummary.modelProviders`, e.g. ["openai"] (string[])
 * @param providerStatuses - Key status per provider, or null while loading (ProviderStatus[] | null)
 * @returns Requirements in display order (BuilderRequirement[])
 */
export function listBuilderRequirements(agentId: string, modelProviders: string[], providerStatuses: ProviderStatus[] | null): BuilderRequirement[] {
  const appRequirements = (appRequirementsByAgentId[agentId] ?? []).map((requirement) => ({
    ...requirement,
    connectPath: agentPath('connectWhatsApp', agentId),
  }))
  const modelRequirements = modelProviders.map((provider) => ({
    label: `${getProviderName(provider)} · Keychain`,
    isConnected: providerStatuses?.some((status) => status.provider === provider && status.configured) ?? true,
    connectPath: routePaths.connections,
  }))
  return [
    ...appRequirements.filter((requirement) => requirement.isConnected),
    ...modelRequirements,
    ...appRequirements.filter((requirement) => !requirement.isConnected),
  ]
}
