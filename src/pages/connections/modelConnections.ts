import { isDesktopApp } from '@/api/client'
import { getCredentialStoreShortName } from '@/lib/platform'
import type { LocalCliStatus, ModelChoice, ModelProvider, ProviderStatus } from '@/api/types'
import { listModelCardTemplates } from '@/pages/connections/modelCardTemplates'
import type { Connection } from '@/api/appConnectionTypes'
import { isLocalCliProvider, modelProviderNames } from '@/lib/settings'
import { describeModelName } from '@/lib/modelChoices'
import { messages } from '@/i18n'

/** A model provider card: the shared Connection shape plus what the key actions need. */
export interface ModelConnection extends Connection {
  provider: ModelProvider
  /** False for Ollama and the local CLIs, which need no key. */
  usesApiKey: boolean
  /** What graphrt detected for a local CLI (Claude Code, Codex); null for the others. */
  localCli: LocalCliStatus | null
}

function isModelProvider(connectionId: string): connectionId is ModelProvider {
  return connectionId in modelProviderNames
}

/**
 * What the app really knows about a connected provider: the default model's name, or
 * where the key, local server or CLI is. No usage or cost (there is no pricing data).
 */
function describeConnectedProvider(status: ProviderStatus, defaultModel: ModelChoice | null, isDefault: boolean): string {
  const location = describeProviderLocation(status)
  return isDefault && defaultModel ? messages().connections.locationDefaultModelModelname(location, describeModelName(defaultModel)) : location
}

function describeProviderLocation(status: ProviderStatus): string {
  if (status.provider === 'ollama') return status.baseUrl ?? messages().connections.localServer
  if (isLocalCliProvider(status.provider)) return status.localCli?.version ?? messages().connections.onThisComputer
  return messages().connections.keyInCredentialstoreshortname(getCredentialStoreShortName())
}

function describeConnectedLabel(provider: ModelProvider, isDefault: boolean): string {
  if (isDefault) return messages().connections.default
  if (provider === 'ollama') return messages().connections.foundOnThisComputer
  return isLocalCliProvider(provider) ? messages().connections.turnedOn : messages().connections.connected
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
  defaultModel: ModelChoice | null,
  { useDesignText = !isDesktopApp() }: { useDesignText?: boolean } = {},
): ModelConnection[] {
  return listModelCardTemplates().flatMap((template) => {
    const status = statuses.find((candidate) => candidate.provider === template.id)
    if (!status || !isModelProvider(template.id)) return []
    const state: Connection['state'] = !status.configured ? 'available' : status.provider === defaultModel?.provider ? 'default' : 'connected'
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

/**
 * Whether a model card is one agents can think with right now. Ollama needs no key, so the
 * backend always reports it as set up, whether or not it runs or has a model: it counts
 * only once it is the default model (the same rule as `isModelConnected` on first launch).
 *
 * @param connection - A card from {@link buildModelConnections} (Connection)
 * @returns True for the default model's card and every other connected one except Ollama (boolean)
 */
export function isUsableModelConnection(connection: Connection): boolean {
  if (connection.state === 'default') return true
  return connection.state === 'connected' && connection.id !== 'ollama'
}

/**
 * How many models are connected. The AI models tab badge and the "Connect an AI model to
 * get started" notice both read this, so they cannot disagree.
 *
 * @param connections - Cards from {@link buildModelConnections} (Connection[])
 * @returns The number of usable model cards (number)
 *
 * @example
 * countConnectedModels(buildModelConnections([{ provider: 'ollama', configured: true, baseUrl: null, localCli: null }], null)) // 0
 */
export function countConnectedModels(connections: Connection[]): number {
  return connections.filter(isUsableModelConnection).length
}
