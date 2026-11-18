import { callBackend, isDesktopApp } from './client'
import { sampleCredentialsBackend } from './sampleBackend/credentials'
import type { ModelChoice, ModelProvider, ProviderStatus } from './types'

/** Model provider keys (kept in the OS keychain; never readable from here) and the default model. */

export function setApiKey(provider: ModelProvider, apiKey: string): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.setApiKey(provider, apiKey)
  return callBackend('set_api_key', { provider, apiKey })
}

export function deleteApiKey(provider: ModelProvider): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.deleteApiKey(provider)
  return callBackend('delete_api_key', { provider })
}

export function listProviderStatuses(): Promise<ProviderStatus[]> {
  if (!isDesktopApp()) return sampleCredentialsBackend.listProviderStatuses()
  return callBackend('list_provider_statuses')
}

export function getDefaultModel(): Promise<ModelChoice> {
  if (!isDesktopApp()) return sampleCredentialsBackend.getDefaultModel()
  return callBackend('get_default_model')
}

export function setDefaultModel(choice: ModelChoice): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.setDefaultModel(choice)
  return callBackend('set_default_model', { choice })
}

export function setOllamaBaseUrl(baseUrl: string): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.setOllamaBaseUrl(baseUrl)
  return callBackend('set_ollama_base_url', { baseUrl })
}
