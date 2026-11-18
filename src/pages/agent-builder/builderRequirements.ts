import type { InstalledPlugin } from '@/api/pluginTypes'
import type { FlowStep, ProviderStatus, WorkflowSecretStatus } from '@/api/types'
import { appRequirementsByAgentId } from '@/data/mapsLeadsAgent'
import { getProviderName } from '@/lib/agentDisplay'
import { agentPath, connectionsPluginsPath, routePaths } from '@/routes'
import { isPluginReady, listMissingSettings } from '../connections/pluginDisplay'
import type { BuilderRequirement } from './AgentRequirementsList'

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
    label: `${getProviderName(provider)} · Keychain`,
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
 * Plugin names the flow's steps use, in step order. Plugin node types look like
 * `<plugin>.<kind>` (e.g. `whatsapp-api.send_text`); built-in ones have no dot.
 *
 * @example
 * listStepPluginNames([{ nodeType: 'llm' }, { nodeType: 'whatsapp-api.send_text' }]) // ["whatsapp-api"]
 */
export function listStepPluginNames(steps: Pick<FlowStep, 'nodeType'>[]): string[] {
  const pluginNames = steps.flatMap((flowStep) => {
    const separatorIndex = flowStep.nodeType.indexOf('.')
    return separatorIndex > 0 ? [flowStep.nodeType.slice(0, separatorIndex)] : []
  })
  return [...new Set(pluginNames)]
}

function describeSetupGap(installedPlugin: InstalledPlugin): string {
  if (installedPlugin.loadError) return `Could not load: ${installedPlugin.loadError}`
  return 'Installed · not trusted yet'
}

function toPluginRequirement(pluginName: string, installedPlugin: InstalledPlugin | undefined): BuilderRequirement {
  const base = { label: `${pluginName} plugin`, pluginName, connectPath: connectionsPluginsPath }
  if (!installedPlugin) return { ...base, isConnected: false, pluginState: 'not_installed', detail: 'Not installed' }
  if (!isPluginReady(installedPlugin)) return { ...base, isConnected: false, pluginState: 'needs_setup', detail: describeSetupGap(installedPlugin) }
  const missingSettings = listMissingSettings(installedPlugin)
  if (missingSettings.length === 0) return { ...base, isConnected: true, pluginState: 'ready' }
  return { ...base, isConnected: true, pluginState: 'ready', detail: `Ready · not set (optional?): ${missingSettings.join(', ')}` }
}

/**
 * One requirement per plugin the flow's steps use: not installed (Install), installed but
 * untrusted or missing settings (Set up in Connections → Plugins), or ready.
 *
 * @param steps - `FlowSummary.steps` (FlowStep[])
 * @param installedPlugins - From `listInstalledPlugins`, or null while loading (no rows then)
 * @returns Plugin requirements in step order (BuilderRequirement[])
 */
export function listPluginRequirements(steps: FlowStep[], installedPlugins: InstalledPlugin[] | null): BuilderRequirement[] {
  if (!installedPlugins) return []
  return listStepPluginNames(steps).map((pluginName) =>
    toPluginRequirement(pluginName, installedPlugins.find((installedPlugin) => installedPlugin.name === pluginName)),
  )
}
