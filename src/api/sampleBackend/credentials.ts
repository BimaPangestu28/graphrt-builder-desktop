import { BackendError } from '../client'
import type { ModelChoice, ModelProvider, ProviderStatus } from '../types'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample provider keys for the browser preview and tests. Only whether a key is set
 * is remembered (in module memory); the key text itself is dropped, just as the
 * keychain-backed store never hands keys back to the UI.
 */

const defaultOllamaBaseUrl = 'http://localhost:11434'
const keyedProviders: ModelProvider[] = ['openai', 'anthropic', 'gemini']

interface SampleCredentialsState {
  configuredProviders: Set<ModelProvider>
  ollamaBaseUrl: string
  defaultModel: ModelChoice
}

function createInitialState(): SampleCredentialsState {
  return {
    configuredProviders: new Set<ModelProvider>(['openai']),
    ollamaBaseUrl: defaultOllamaBaseUrl,
    defaultModel: { provider: 'openai', name: 'gpt-4o-mini' },
  }
}

let credentialsState = createInitialState()

/** True when the provider can be used: a stored key, or Ollama (needs none). */
export function isSampleProviderConfigured(provider: ModelProvider): boolean {
  return provider === 'ollama' || credentialsState.configuredProviders.has(provider)
}

/** The sample default model (the sample builder uses it to decide `missing_credentials`). */
export function readSampleDefaultModel(): ModelChoice {
  return { ...credentialsState.defaultModel }
}

/** @throws BackendError - `invalid_input` for Ollama or a blank key */
function storeApiKey(provider: ModelProvider, apiKey: string): void {
  if (provider === 'ollama') throw new BackendError('invalid_input', 'Ollama runs locally and needs no key')
  requireText(apiKey, 'paste the API key')
  credentialsState.configuredProviders.add(provider)
}

function removeApiKey(provider: ModelProvider): void {
  credentialsState.configuredProviders.delete(provider)
}

function listStatuses(): ProviderStatus[] {
  const keyedStatuses: ProviderStatus[] = keyedProviders.map((provider) => ({
    provider,
    configured: credentialsState.configuredProviders.has(provider),
    baseUrl: null,
  }))
  return [...keyedStatuses, { provider: 'ollama', configured: true, baseUrl: credentialsState.ollamaBaseUrl }]
}

/** @throws BackendError - `invalid_input` for a blank or non-http address */
function storeOllamaBaseUrl(baseUrl: string): void {
  const trimmedBaseUrl = requireText(baseUrl, 'enter the Ollama address')
  if (!/^https?:\/\//.test(trimmedBaseUrl)) throw new BackendError('invalid_input', 'the Ollama address must start with http:// or https://')
  credentialsState.ollamaBaseUrl = trimmedBaseUrl
}

/** @throws BackendError - `invalid_input` for a blank model name */
function storeDefaultModel(choice: ModelChoice): void {
  requireText(choice.name, 'pick a model')
  credentialsState.defaultModel = { ...choice }
}

export const sampleCredentialsBackend = {
  setApiKey: (provider: ModelProvider, apiKey: string): Promise<void> => respondWith(() => storeApiKey(provider, apiKey)),
  deleteApiKey: (provider: ModelProvider): Promise<void> => respondWith(() => removeApiKey(provider)),
  listProviderStatuses: (): Promise<ProviderStatus[]> => respondWith(listStatuses),
  getDefaultModel: (): Promise<ModelChoice> => respondWith(readSampleDefaultModel),
  setDefaultModel: (choice: ModelChoice): Promise<void> => respondWith(() => storeDefaultModel(choice)),
  setOllamaBaseUrl: (baseUrl: string): Promise<void> => respondWith(() => storeOllamaBaseUrl(baseUrl)),
}

/** Restores the sample keys and default model (use in test `beforeEach`). */
export function resetSampleCredentials(): void {
  credentialsState = createInitialState()
}
