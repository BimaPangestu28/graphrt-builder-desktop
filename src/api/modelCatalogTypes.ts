import type { ModelProvider } from './types'

/** One chat model a provider offers (mirrors `model_catalog::AvailableModel`). */
export interface AvailableModel {
  /** Id used in workflows, e.g. "gpt-4o-mini". */
  id: string
  /** Provider's display name, when it has one (Anthropic, Gemini). */
  displayName: string | null
  /** Size of a local Ollama model in millions of parameters (3.2B is 3200), when Ollama reports it. */
  parameterMillions?: number | null
}

/** The models of one connected provider, or why they could not be listed. */
export interface ProviderModels {
  provider: ModelProvider
  models: AvailableModel[]
  /** Plain-language reason the list is empty (rejected key, offline...). */
  error: string | null
}
