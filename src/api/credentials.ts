import { callBackend, isDesktopApp } from './client'
import type { NewWorkflowSecret, WorkflowSecretOverview } from './connectionTypes'
import type { ProviderModels } from './modelCatalogTypes'
import { sampleCredentialsBackend } from './sampleBackend/credentials'
import type { ModelChoice, ModelProvider, ProviderStatus, WorkflowSecretStatus } from './types'

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

/**
 * The `env.*` values (API keys, tokens) an agent's workflow needs and whether each is
 * stored. Values live in the OS keychain and are shared by every agent using the same name.
 */
export function listWorkflowSecrets(agentId: string): Promise<WorkflowSecretStatus[]> {
  if (!isDesktopApp()) return sampleCredentialsBackend.listWorkflowSecrets(agentId)
  return callBackend('list_workflow_secrets', { agentId })
}

/**
 * Every secret name any agent declares or an MCP server needs, with whether it is stored
 * and who uses it (Connections > Advanced > Secrets). Values are never returned.
 */
export function listAllWorkflowSecrets(): Promise<WorkflowSecretOverview[]> {
  if (!isDesktopApp()) return sampleCredentialsBackend.listAllWorkflowSecrets()
  return callBackend('list_all_workflow_secrets')
}

/** Saves or replaces a workflow secret, e.g. `setWorkflowSecret('MAPS_API_KEY', value)`. */
export function setWorkflowSecret(name: string, value: string): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.setWorkflowSecret(name, value)
  return callBackend('set_workflow_secret', { name, value })
}

/**
 * Adds a secret the user names themselves; agents read it as `{{#env.NAME#}}`.
 *
 * @param secret - Name (UPPER_SNAKE_CASE), value and optional note (NewWorkflowSecret)
 * @throws BackendError - `invalid_input` for a malformed name, empty or too large value,
 *   or a name that already has a value
 */
export function addWorkflowSecret(secret: NewWorkflowSecret): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.addWorkflowSecret(secret)
  return callBackend('add_workflow_secret', { secret })
}

export function deleteWorkflowSecret(name: string): Promise<void> {
  if (!isDesktopApp()) return sampleCredentialsBackend.deleteWorkflowSecret(name)
  return callBackend('delete_workflow_secret', { name })
}

/**
 * The chat models every connected provider offers, asked from the providers with the stored
 * keys (cached for ten minutes in the backend; `refresh` asks again). A provider that could
 * not be reached comes back with `error` and no models.
 */
export function listAvailableModels(refresh = false): Promise<ProviderModels[]> {
  if (!isDesktopApp()) return sampleCredentialsBackend.listAvailableModels(refresh)
  return callBackend('list_available_models', { refresh })
}
