import { getAppSettings, updateAppSettings } from '@/api/appSettings'
import { listAvailableModels, setApiKey, setDefaultModel, setLocalCliEnabled, setOllamaBaseUrl, setWelcomeChoice } from '@/api/credentials'
import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { ModelProvider, WelcomeChoice } from '@/api/types'
import { isLocalCliProvider } from '@/lib/settings'
import { recommendedModelFor, recommendedOllamaModel } from '@/lib/modelChoices'
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

/** What the Welcome wizard holds when Finish is pressed. */
export interface WelcomeSetup {
  choice: WelcomeChoice
  apiKeyProvider: ApiKeyProvider
  apiKey: string
  /**
   * Keep graphrt running in the menu bar / system tray after its window closes (the
   * `showInMenuBar` app setting, also in Settings). Left out: the setting is not touched.
   */
  keepRunningInBackground?: boolean
}

/**
 * Saves the model setup of one Welcome choice: turns a local CLI on and makes its own
 * default model the default; stores the Ollama address or an API key with its recommended
 * model; Skip stores no model. Then stores the background (tray) preference when it
 * differs from the current one. The choice is remembered last, so a failed save leaves
 * Welcome showing on the next launch.
 *
 * @param setup - The choice, for "api-key" the provider and key, and the tray preference (WelcomeSetup)
 * @throws BackendError - when a setting cannot be saved (e.g. the CLI is not installed, the keychain is locked)
 */
export async function saveWelcomeSetup({ choice, apiKeyProvider, apiKey, keepRunningInBackground }: WelcomeSetup): Promise<void> {
  if (isLocalCliProvider(choice)) {
    await setLocalCliEnabled(choice, true)
    await setDefaultModel(recommendedModelFor(choice))
  } else if (choice === 'ollama') {
    await setOllamaBaseUrl(defaultOllamaBaseUrl)
    await setDefaultModel(recommendedOllamaModel(await installedModels()))
  } else if (choice === 'api-key') {
    await setApiKey(apiKeyProvider, apiKey.trim())
    await setDefaultModel(recommendedModelFor(apiKeyProvider))
  }
  if (keepRunningInBackground !== undefined) await saveKeepRunningInBackground(keepRunningInBackground)
  await setWelcomeChoice(choice)
}

/** The model lists for picking the Ollama default; an unreadable list only means the fallback model is used. */
async function installedModels(): Promise<ProviderModels[] | null> {
  try {
    return await listAvailableModels()
  } catch {
    return null
  }
}

/** Turns the menu bar / tray icon (which keeps graphrt running after its window closes) on or off. */
async function saveKeepRunningInBackground(keepRunning: boolean): Promise<void> {
  const currentSettings = await getAppSettings()
  if (currentSettings.showInMenuBar === keepRunning) return
  await updateAppSettings({ ...currentSettings, showInMenuBar: keepRunning })
}

/** Where Finish leads: Home after "Decide later" (explore first), otherwise the New agent screen. */
export function pathAfterWelcome(choice: WelcomeChoice): string {
  return choice === 'skip' ? routePaths.home : routePaths.newAgent
}
