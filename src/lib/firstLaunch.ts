import { getDefaultModel, getWelcomeChoice, listProviderStatuses } from '@/api/credentials'
import type { ModelChoice, ProviderStatus } from '@/api/types'

/**
 * True when the statuses and default show a provider that can run agents: a stored key
 * (OpenAI, Anthropic, Gemini, DeepSeek), a turned-on installed local CLI (Claude Code,
 * Codex), or Ollama once it is the default model (it needs no key and is always "configured").
 *
 * @param providerStatuses - From `listProviderStatuses` (ProviderStatus[])
 * @param defaultModel - From `getDefaultModel` (ModelChoice)
 * @returns Whether a model is connected (boolean)
 */
export function isModelConnected(providerStatuses: ProviderStatus[], defaultModel: ModelChoice | null): boolean {
  const hasConnectedProvider = providerStatuses.some((status) => status.provider !== 'ollama' && status.configured)
  return hasConnectedProvider || defaultModel?.provider === 'ollama'
}

/**
 * Whether `/` can skip the Welcome screen: the user already made a Welcome choice (Skip
 * included, so it does not loop back), or a model provider is ready (see {@link isModelConnected}).
 * A backend error counts as "not ready": Welcome is where providers are set up.
 *
 * @returns true when Welcome is done (Promise<boolean>)
 */
export async function hasFinishedWelcome(): Promise<boolean> {
  try {
    const welcomeChoice = await getWelcomeChoice()
    if (welcomeChoice) return true
    const providerStatuses = await listProviderStatuses()
    if (isModelConnected(providerStatuses, null)) return true
    return isModelConnected(providerStatuses, await getDefaultModel())
  } catch {
    return false
  }
}
