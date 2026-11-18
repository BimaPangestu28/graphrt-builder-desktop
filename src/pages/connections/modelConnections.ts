import type { ModelChoice, ModelProvider, ProviderStatus } from '@/api/types'
import { initialConnections, type Connection } from '@/data/connections'

/** A model provider card: the shared Connection shape plus what the key actions need. */
export interface ModelConnection extends Connection {
  provider: ModelProvider
  /** False for Ollama, which runs locally without a key. */
  usesApiKey: boolean
}

/** Display text for each provider card (names, descriptions) from the mock connections. */
const modelCardTemplates = initialConnections.filter((connection) => connection.category === 'models')

function isModelProvider(connectionId: string): connectionId is ModelProvider {
  return ['openai', 'anthropic', 'gemini', 'deepseek', 'ollama'].includes(connectionId)
}

/**
 * Builds the AI model cards from backend provider statuses: the default model's provider
 * is "default", other configured ones "connected", the rest "available" (Add key).
 *
 * @param statuses - From `listProviderStatuses` (ProviderStatus[])
 * @param defaultModel - From `getDefaultModel` (ModelChoice)
 * @returns One card per provider the backend reports, in the design's order (ModelConnection[])
 */
export function buildModelConnections(statuses: ProviderStatus[], defaultModel: ModelChoice): ModelConnection[] {
  return modelCardTemplates.flatMap((template) => {
    const status = statuses.find((candidate) => candidate.provider === template.id)
    if (!status || !isModelProvider(template.id)) return []
    const state: Connection['state'] = !status.configured ? 'available' : status.provider === defaultModel.provider ? 'default' : 'connected'
    const isDefault = state === 'default'
    return [
      {
        ...template,
        provider: status.provider,
        usesApiKey: status.provider !== 'ollama',
        state,
        connectedLabel: isDefault ? 'Default' : template.id === 'ollama' ? 'Found on this Mac' : 'Connected',
      },
    ]
  })
}
