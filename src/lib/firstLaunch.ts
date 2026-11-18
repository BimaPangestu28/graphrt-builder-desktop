import { getDefaultModel, listProviderStatuses } from '@/api/credentials'

/**
 * Whether a model provider is ready, so `/` can skip the Welcome screen.
 *
 * A stored key for OpenAI, Anthropic or Gemini counts. Ollama needs no key and is
 * always "configured", so it only counts when the user picked it as the default model.
 * A backend error counts as "not ready": Welcome is where providers are set up.
 *
 * @returns true when at least one provider can run agents (Promise<boolean>)
 */
export async function hasUsableModelProvider(): Promise<boolean> {
  try {
    const providerStatuses = await listProviderStatuses()
    const hasStoredKey = providerStatuses.some((status) => status.provider !== 'ollama' && status.configured)
    if (hasStoredKey) return true
    const defaultModel = await getDefaultModel()
    return defaultModel.provider === 'ollama'
  } catch {
    return false
  }
}
