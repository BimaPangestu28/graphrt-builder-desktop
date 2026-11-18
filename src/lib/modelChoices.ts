import type { ProviderModels } from '@/api/modelCatalogTypes'
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

/** The models of one provider in a picker, with a note when its list could not be fetched. */
export interface ModelOptionGroup {
  provider: ModelProvider
  label: string
  choices: ModelChoice[]
  /** E.g. "showing the recommended model: the key was rejected". */
  note: string | null
}

/**
 * Picker groups: one per connected provider (the default model's provider first), listing
 * every chat model the provider reports for the stored key. Until the list arrives, or when
 * the provider can't be reached, a group falls back to its recommended model. The current
 * default is always selectable.
 *
 * @param defaultModel - The stored default (ModelChoice)
 * @param statuses - Provider statuses (ProviderStatus[])
 * @param catalog - From `listAvailableModels`, or null while loading (ProviderModels[] | null)
 * @returns Groups in display order (ModelOptionGroup[])
 */
export function buildModelOptionGroups(
  defaultModel: ModelChoice,
  statuses: ProviderStatus[],
  catalog: ProviderModels[] | null,
): ModelOptionGroup[] {
  const connectedProviders = statuses
    .filter((status) => status.configured)
    .map((status) => status.provider)
    .filter((provider) => provider !== 'ollama' || provider === defaultModel.provider || catalog?.some((list) => list.provider === 'ollama'))
  const providers = [defaultModel.provider, ...connectedProviders.filter((provider) => provider !== defaultModel.provider)]
  return providers.map((provider) => {
    const list = catalog?.find((candidate) => candidate.provider === provider)
    const listedChoices = (list?.models ?? []).map((model) => ({ provider, name: model.id }))
    const fallbackNote = !catalog ? null : list?.error ? `showing the recommended model: ${list.error}` : null
    const choices = listedChoices.length > 0 ? listedChoices : [recommendedModelFor(provider)]
    const withDefault =
      provider === defaultModel.provider && !choices.some((choice) => choice.name === defaultModel.name) ? [defaultModel, ...choices] : choices
    return { provider, label: modelProviderNames[provider], choices: withDefault, note: listedChoices.length > 0 ? null : fallbackNote }
  })
}
