import type { ModelChoice, ModelProvider, ProviderStatus } from '@/api/types'
import { modelProviderNames, recommendedModels } from '@/data/settings'

/** "OpenAI gpt-4o-mini". */
export function describeModelChoice(choice: ModelChoice): string {
  return `${modelProviderNames[choice.provider]} ${choice.name}`
}

/** Stable key for a choice, e.g. "openai:gpt-4o-mini" (used as a select option value). */
export function modelChoiceKey(choice: ModelChoice): string {
  return `${choice.provider}:${choice.name}`
}

/**
 * The models a default-model picker offers: the current default, then the recommended
 * model of every provider that has a key (or is the local Ollama when it is the default).
 *
 * @param statuses - Provider statuses (ProviderStatus[])
 * @param defaultModel - The stored default (ModelChoice)
 * @returns Distinct choices, the current default first (ModelChoice[])
 */
export function listDefaultModelChoices(statuses: ProviderStatus[], defaultModel: ModelChoice): ModelChoice[] {
  const configuredRecommendations = recommendedModels.filter((choice) =>
    statuses.some((status) => status.provider === choice.provider && status.configured),
  )
  const isDefault = (choice: ModelChoice) => modelChoiceKey(choice) === modelChoiceKey(defaultModel)
  return [defaultModel, ...configuredRecommendations.filter((choice) => !isDefault(choice))]
}

/** Model picked when a provider is made the default; Ollama's matches the Welcome screen. */
const ollamaDefaultModel: ModelChoice = { provider: 'ollama', name: 'llama3.2' }

/**
 * The recommended model of one provider, e.g. `deepseek` → deepseek-chat.
 *
 * @param provider - Provider to make the default (ModelProvider)
 * @returns Its recommended model (ModelChoice)
 */
export function recommendedModelFor(provider: ModelProvider): ModelChoice {
  if (provider === 'ollama') return ollamaDefaultModel
  return recommendedModels.find((choice) => choice.provider === provider) ?? { provider, name: provider }
}
