import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { ModelChoice, ModelProvider, ProviderStatus } from '@/api/types'
import { isLocalCliProvider, localCliDefaultModelName, localCliShortNames, modelProviderNames, recommendedModels } from '@/lib/settings'
import { messages } from '@/i18n'

/** Label of the local CLIs' `default` model id: the CLI picks its own model. */
export function localCliDefaultModelLabel(): string {
  return messages().connections.cliDefault
}

/**
 * The model's name as pickers show it: the id, except a local CLI's `default` which reads "CLI default".
 *
 * @param choice - The model (ModelChoice)
 * @returns E.g. "gpt-4o-mini", "sonnet" or "CLI default" (string)
 */
export function describeModelName(choice: ModelChoice): string {
  if (isLocalCliProvider(choice.provider) && choice.name === localCliDefaultModelName) return localCliDefaultModelLabel()
  return choice.name
}

/**
 * A model in a compact picker (chip) where the provider group is not visible once closed:
 * the bare name for API providers, "Claude Code · CLI default" for the local CLIs.
 */
export function describeCompactModelChoice(choice: ModelChoice): string {
  if (!isLocalCliProvider(choice.provider)) return choice.name
  return `${localCliShortNames[choice.provider]} · ${describeModelName(choice)}`
}

/** "OpenAI gpt-4o-mini", "Claude Code (on this computer) CLI default". */
export function describeModelChoice(choice: ModelChoice): string {
  return `${modelProviderNames[choice.provider]} ${describeModelName(choice)}`
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

/** Ollama model picked when the installed models are not known (the one the Welcome screen tells people to pull). */
const ollamaDefaultModel: ModelChoice = { provider: 'ollama', name: 'llama3.2' }

/**
 * The Ollama model to make the default: the largest installed one, since a larger model
 * drafts and runs agents more reliably. Models of unknown size count as the smallest; ties
 * keep the catalog's order. Falls back to `llama3.2` when the list is empty or unknown.
 *
 * @param catalog - The model lists of the connected providers, or null when not loaded (ProviderModels[] | null)
 * @returns The Ollama model for new agents (ModelChoice)
 *
 * @example
 * // installed: llama3.2 (3.2B), qwen2.5:14b (14.8B)
 * recommendedOllamaModel(catalog) // { provider: 'ollama', name: 'qwen2.5:14b' }
 */
export function recommendedOllamaModel(catalog: ProviderModels[] | null): ModelChoice {
  const installedModels = catalog?.find((list) => list.provider === 'ollama' && !list.error)?.models ?? []
  let strongest: { id: string; size: number } | null = null
  for (const model of installedModels) {
    const size = model.parameterMillions ?? 0
    if (strongest === null || size > strongest.size) strongest = { id: model.id, size }
  }
  return strongest ? { provider: 'ollama', name: strongest.id } : ollamaDefaultModel
}

/**
 * The recommended model of one provider, e.g. `deepseek` → deepseek-chat, a local CLI → `default`.
 *
 * @param provider - Provider to make the default (ModelProvider)
 * @returns Its recommended model (ModelChoice)
 */
export function recommendedModelFor(provider: ModelProvider): ModelChoice {
  if (provider === 'ollama') return ollamaDefaultModel
  if (isLocalCliProvider(provider)) return { provider, name: localCliDefaultModelName }
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

/** A local CLI's listed models with "CLI default" first; other providers' lists are kept as reported. */
function putCliDefaultFirst(choices: ModelChoice[]): ModelChoice[] {
  const cliDefault = choices.find((choice) => isLocalCliProvider(choice.provider) && choice.name === localCliDefaultModelName)
  return cliDefault ? [cliDefault, ...choices.filter((choice) => choice !== cliDefault)] : choices
}

/**
 * Picker groups: one per connected provider (local CLIs only once turned on and installed) (the default model's provider first), listing
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
  defaultModel: ModelChoice | null,
  statuses: ProviderStatus[],
  catalog: ProviderModels[] | null,
): ModelOptionGroup[] {
  const connectedProviders = statuses
    .filter((status) => status.configured)
    .map((status) => status.provider)
    .filter((provider) => provider !== 'ollama' || provider === defaultModel?.provider || catalog?.some((list) => list.provider === 'ollama'))
  const providers = defaultModel
    ? [defaultModel.provider, ...connectedProviders.filter((provider) => provider !== defaultModel.provider)]
    : connectedProviders
  return providers.map((provider) => {
    const list = catalog?.find((candidate) => candidate.provider === provider)
    const listedChoices = putCliDefaultFirst((list?.models ?? []).map((model) => ({ provider, name: model.id })))
    const fallbackNote = !catalog ? null : list?.error ? messages().connections.showingTheRecommendedModelError(list.error) : null
    const choices = listedChoices.length > 0 ? listedChoices : [recommendedModelFor(provider)]
    const withDefault =
      defaultModel && provider === defaultModel.provider && !choices.some((choice) => choice.name === defaultModel.name) ? [defaultModel, ...choices] : choices
    return { provider, label: modelProviderNames[provider], choices: withDefault, note: listedChoices.length > 0 ? null : fallbackNote }
  })
}
