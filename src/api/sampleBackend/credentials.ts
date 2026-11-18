import type { ModelChoice, ModelProvider, ProviderStatus } from '../types'

/** Sample provider keys for the browser preview and tests (nothing is stored). */
export const sampleCredentialsBackend = {
  setApiKey: (_provider: ModelProvider, _apiKey: string): Promise<void> => Promise.resolve(),
  deleteApiKey: (_provider: ModelProvider): Promise<void> => Promise.resolve(),
  listProviderStatuses: (): Promise<ProviderStatus[]> => Promise.resolve([]),
  getDefaultModel: (): Promise<ModelChoice> => Promise.resolve({ provider: 'openai', name: 'gpt-4o-mini' }),
  setDefaultModel: (_choice: ModelChoice): Promise<void> => Promise.resolve(),
  setOllamaBaseUrl: (_baseUrl: string): Promise<void> => Promise.resolve(),
}
