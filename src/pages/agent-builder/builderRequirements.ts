import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { getCredentialStoreShortName } from '@/lib/platform'
import type { ProviderStatus, WorkflowSecretStatus } from '@/api/types'
import { appRequirementsByAgentId } from '@/data/mapsLeadsAgent'
import { getProviderName } from '@/lib/agentDisplay'
import { agentPath, connectionsPluginsPath, routePaths } from '@/routes'
import type { BuilderRequirement } from './AgentRequirementsList'
import { describeRequirementState, needsOnlySessionLink } from './pluginRequirementDisplay'

/**
 * Lists what an agent needs on screen 04: connected apps first, then the model keys its
 * flow uses (from the flow summary and provider statuses), then the workflow secrets it
 * declares (`env.*`, added inline), then apps still to connect.
 *
 * @param agentId - Agent shown in the builder (string)
 * @param modelProviders - `FlowSummary.modelProviders`, e.g. ["openai"] (string[])
 * @param providerStatuses - Key status per provider, or null while loading (ProviderStatus[] | null)
 * @param workflowSecrets - The flow's `env.*` values with their status, or null while loading
 * @returns Requirements in display order (BuilderRequirement[])
 */
export function listBuilderRequirements(
  agentId: string,
  modelProviders: string[],
  providerStatuses: ProviderStatus[] | null,
  workflowSecrets: WorkflowSecretStatus[] | null = null,
): BuilderRequirement[] {
  const appRequirements = (appRequirementsByAgentId[agentId] ?? []).map((requirement) => ({
    ...requirement,
    connectPath: agentPath('connectWhatsApp', agentId),
  }))
  const modelRequirements = modelProviders.map((provider) => ({
    label: `${getProviderName(provider)} · ${getCredentialStoreShortName()}`,
    isConnected: providerStatuses?.some((status) => status.provider === provider && status.configured) ?? true,
    connectPath: routePaths.connections,
  }))
  const secretRequirements = (workflowSecrets ?? []).map((secret) => ({
    label: secret.description ? `${secret.description} · ${secret.name}` : secret.name,
    isConnected: secret.configured || !secret.required,
    connectPath: routePaths.connections,
    secretName: secret.name,
  }))
  return [
    ...appRequirements.filter((requirement) => requirement.isConnected),
    ...modelRequirements,
    ...secretRequirements,
    ...appRequirements.filter((requirement) => !requirement.isConnected),
  ]
}

/**
 * The "Needs" rows for the plugins the agent uses, from the same requirements the chat's
 * setup card shows (`listAgentPluginRequirements`), so both stay in sync. Plugins that are
 * not ready point to the card ("Set up in chat"); one that only needs its account linked
 * (whatsapp-web) is "Not linked" with the QR link action right in the row.
 *
 * @param pluginRequirements - From `listAgentPluginRequirements`, or null while loading (no rows then)
 * @returns One row per plugin, in the backend's order (BuilderRequirement[])
 */
export function listPluginSetupRequirements(pluginRequirements: PluginRequirement[] | null): BuilderRequirement[] {
  return (pluginRequirements ?? []).map((requirement) => ({
    label: `${requirement.name} plugin`,
    pluginName: requirement.name,
    connectPath: connectionsPluginsPath,
    isConnected: requirement.ready,
    pluginState: readPluginState(requirement),
    detail: requirement.ready || needsOnlySessionLink(requirement) ? undefined : describeRequirementState(requirement),
  }))
}

function readPluginState(requirement: PluginRequirement): NonNullable<BuilderRequirement['pluginState']> {
  if (requirement.ready) return 'ready'
  if (needsOnlySessionLink(requirement)) return 'not_linked'
  return requirement.installed ? 'needs_setup' : 'not_installed'
}
