import { isDesktopApp } from '@/api/client'
import { getCredentialStoreShortName } from '@/lib/platform'
import type { LocalCliStatus, ModelChoice, ModelProvider, ProviderStatus } from '@/api/types'
import { initialConnections, type Connection } from '@/data/connections'
import { isLocalCliProvider, modelProviderNames } from '@/data/settings'
import { describeModelName } from '@/lib/modelChoices'

/** A model provider card: the shared Connection shape plus what the key actions need. */
export interface ModelConnection extends Connection {
  provider: ModelProvider
  /** False for Ollama and the local CLIs, which need no key. */
  usesApiKey: boolean
  /** What graphrt detected for a local CLI (Claude Code, Codex); null for the others. */
  localCli: LocalCliStatus | null
}

/** Display text for each provider card (names, descriptions) from the mock connections. */
const modelCardTemplates = initialConnections.filter((connection) => connection.category === 'models')

function isModelProvider(connectionId: string): connectionId is ModelProvider {
  return connectionId in modelProviderNames
}

/**
 * What the app really knows about a connected provider: the default model's name, or
 * where the key, local server or CLI is. No usage or cost (there is no pricing data).
 */
function describeConnectedProvider(status: ProviderStatus, defaultModel: ModelChoice, isDefault: boolean): string {
  const location = describeProviderLocation(status)
  return isDefault ? `${location} · default model ${describeModelName(defaultModel)}` : location
}

function describeProviderLocation(status: ProviderStatus): string {
  if (status.provider === 'ollama') return status.baseUrl ?? 'Local server'
  if (isLocalCliProvider(status.provider)) return status.localCli?.version ?? 'On this computer'
  return `Key in ${getCredentialStoreShortName()}`
}

function describeConnectedLabel(provider: ModelProvider, isDefault: boolean): string {
  if (isDefault) return 'Default'
  if (provider === 'ollama') return 'Found on this computer'
  return isLocalCliProvider(provider) ? 'Turned on' : 'Connected'
}

/**
 * Builds the AI model cards from backend provider statuses: the default model's provider
 * is "default", other configured ones "connected", the rest "available" (Add key, or a
 * local CLI that is off or not installed).
 *
 * @param statuses - From `listProviderStatuses` (ProviderStatus[])
 * @param defaultModel - From `getDefaultModel` (ModelChoice)
 * @returns One card per provider the backend reports, in the design's order (ModelConnection[])
 */
export function buildModelConnections(
  statuses: ProviderStatus[],
  defaultModel: ModelChoice,
  { useDesignText = !isDesktopApp() }: { useDesignText?: boolean } = {},
): ModelConnection[] {
  return modelCardTemplates.flatMap((template) => {
    const status = statuses.find((candidate) => candidate.provider === template.id)
    if (!status || !isModelProvider(template.id)) return []
    const state: Connection['state'] = !status.configured ? 'available' : status.provider === defaultModel.provider ? 'default' : 'connected'
    const isDefault = state === 'default'
    const usesDesignText = useDesignText && !isLocalCliProvider(status.provider)
    return [
      {
        ...template,
        provider: status.provider,
        usesApiKey: status.provider !== 'ollama' && !isLocalCliProvider(status.provider),
        localCli: status.localCli ?? null,
        state,
        connectedLabel: describeConnectedLabel(status.provider, isDefault),
        connectedDescription: usesDesignText ? template.connectedDescription : describeConnectedProvider(status, defaultModel, isDefault),
      },
    ]
  })
}
