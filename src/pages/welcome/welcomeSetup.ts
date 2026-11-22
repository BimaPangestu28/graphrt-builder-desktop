import { setApiKey, setDefaultModel, setLocalCliEnabled, setOllamaBaseUrl, setWelcomeChoice } from '@/api/credentials'
import type { ModelProvider, WelcomeChoice } from '@/api/types'
import { isLocalCliProvider } from '@/lib/settings'
import { recommendedModelFor } from '@/lib/modelChoices'
import { routePaths } from '@/routes'

/** The key-based providers the Welcome "Add an API key" choice offers, with their names. */
export const apiKeyProviderOptions = [
  { provider: 'openai', label: 'OpenAI' },
  { provider: 'anthropic', label: 'Anthropic' },
  { provider: 'gemini', label: 'Google Gemini' },
  { provider: 'deepseek', label: 'DeepSeek' },
] as const satisfies ReadonlyArray<{ provider: ModelProvider; label: string }>

export type ApiKeyProvider = (typeof apiKeyProviderOptions)[number]['provider']

export const defaultOllamaBaseUrl = 'http://localhost:11434'

/** What the Welcome form holds when Continue is pressed. */
export interface WelcomeSetup {
  choice: WelcomeChoice
  apiKeyProvider: ApiKeyProvider
  apiKey: string
}

/**
 * Saves the model setup of one Welcome choice: turns a local CLI on and makes its own
 * default model the default; stores the Ollama address or an API key with its recommended
 * model; Skip stores nothing but the choice. The choice is remembered last, so a failed
 * save leaves Welcome showing on the next launch.
 *
 * @param setup - The choice and, for "api-key", the provider and key (WelcomeSetup)
 * @throws BackendError - when a setting cannot be saved (e.g. the CLI is not installed, the keychain is locked)
 */
export async function saveWelcomeSetup({ choice, apiKeyProvider, apiKey }: WelcomeSetup): Promise<void> {
  if (isLocalCliProvider(choice)) {
    await setLocalCliEnabled(choice, true)
    await setDefaultModel(recommendedModelFor(choice))
  } else if (choice === 'ollama') {
    await setOllamaBaseUrl(defaultOllamaBaseUrl)
    await setDefaultModel(recommendedModelFor('ollama'))
  } else if (choice === 'api-key') {
    await setApiKey(apiKeyProvider, apiKey.trim())
    await setDefaultModel(recommendedModelFor(apiKeyProvider))
  }
  await setWelcomeChoice(choice)
}

/** Where Continue leads: Home after Skip (explore first), otherwise the New agent screen. */
export function pathAfterWelcome(choice: WelcomeChoice): string {
  return choice === 'skip' ? routePaths.home : routePaths.newAgent
}
