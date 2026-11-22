import { callBackend, isDesktopApp } from './client'
import type { NewWorkflowSecret, WorkflowSecretOverview } from './connectionTypes'
import type { ProviderModels } from './modelCatalogTypes'
import { sampleCredentialsBackend } from './sampleBackend/credentials'
import type {
  InstallableModelProvider,
  LocalCliCheckResult,
  LocalCliProvider,
  ModelChoice,
  ModelProvider,
  ProviderStatus,
  WelcomeChoice,
  WorkflowSecretStatus,
} from './types'

/** Model provider keys (kept in the OS keychain; never readable from here) and the default model. */

export function setApiKey(provider: ModelProvider, apiKey: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setApiKey(provider, apiKey)
  return callBackend('set_api_key', { provider, apiKey })
}

export function deleteApiKey(provider: ModelProvider): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.deleteApiKey(provider)
  return callBackend('delete_api_key', { provider })
}

/**
 * Every model provider's status, local CLIs included (openai … ollama, claude-code-cli, codex-cli).
 *
 * @param refresh - True looks for the local CLIs again; otherwise the backend's cached detection is used (boolean)
 * @returns One status per provider (Promise<ProviderStatus[]>)
 */
export function listProviderStatuses(refresh = false): Promise<ProviderStatus[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.listProviderStatuses(refresh)
  return callBackend('list_provider_statuses', { refresh })
}

/**
 * Turns a local CLI provider (Claude Code, Codex) on or off in graphrt. Turning off the
 * default model's provider makes the backend pick another default.
 *
 * @param provider - The CLI provider (LocalCliProvider)
 * @param enabled - On or off (boolean)
 * @returns The provider's updated status (Promise<ProviderStatus>)
 * @throws BackendError - `invalid_input` for a provider that is not a CLI, or turning on one that is not installed
 */
export function setLocalCliEnabled(provider: LocalCliProvider, enabled: boolean): Promise<ProviderStatus> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setLocalCliEnabled(provider, enabled)
  return callBackend('set_local_cli_enabled', { provider, enabled })
}

/**
 * Runs one tiny prompt through a local CLI to see that it answers. Spends a little of the
 * user's plan, so call it only when the user asks ("Check connection").
 *
 * @param provider - The CLI provider (LocalCliProvider)
 * @returns Whether it answered and a plain-language message (Promise<LocalCliCheckResult>)
 */
export function checkLocalCli(provider: LocalCliProvider): Promise<LocalCliCheckResult> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.checkLocalCli(provider)
  return callBackend('check_local_cli', { provider })
}

/** What the user picked on the Welcome screen, or null before they picked anything. */
export function getWelcomeChoice(): Promise<WelcomeChoice | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.getWelcomeChoice()
  return callBackend('get_welcome_choice')
}

/** Remembers the Welcome choice, so `/` stops showing Welcome (Skip included). */
export function setWelcomeChoice(choice: WelcomeChoice): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setWelcomeChoice(choice)
  return callBackend('set_welcome_choice', { choice })
}

/**
 * Opens the install / download page of a local model provider (Claude Code, Codex docs or
 * Ollama's download page) in the default browser: a plain link would stay inside the app window.
 *
 * @param provider - claude-code-cli, codex-cli or ollama (InstallableModelProvider)
 */
export function openModelInstallPage(provider: InstallableModelProvider): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.openModelInstallPage(provider)
  return callBackend('open_model_install_page', { provider })
}

export function getDefaultModel(): Promise<ModelChoice> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.getDefaultModel()
  return callBackend('get_default_model')
}

export function setDefaultModel(choice: ModelChoice): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setDefaultModel(choice)
  return callBackend('set_default_model', { choice })
}

export function setOllamaBaseUrl(baseUrl: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setOllamaBaseUrl(baseUrl)
  return callBackend('set_ollama_base_url', { baseUrl })
}

/**
 * The `env.*` values (API keys, tokens) an agent's workflow needs and whether each is
 * stored. Values live in the OS keychain and are shared by every agent using the same name.
 */
export function listWorkflowSecrets(agentId: string): Promise<WorkflowSecretStatus[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.listWorkflowSecrets(agentId)
  return callBackend('list_workflow_secrets', { agentId })
}

/**
 * Every secret name any agent declares or an MCP server needs, with whether it is stored
 * and who uses it (Connections, Secrets tab). Values are never returned.
 */
export function listAllWorkflowSecrets(): Promise<WorkflowSecretOverview[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.listAllWorkflowSecrets()
  return callBackend('list_all_workflow_secrets')
}

/** Saves or replaces a workflow secret, e.g. `setWorkflowSecret('MAPS_API_KEY', value)`. */
export function setWorkflowSecret(name: string, value: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.setWorkflowSecret(name, value)
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.addWorkflowSecret(secret)
  return callBackend('add_workflow_secret', { secret })
}

export function deleteWorkflowSecret(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.deleteWorkflowSecret(name)
  return callBackend('delete_workflow_secret', { name })
}

/**
 * The chat models every connected provider offers, asked from the providers with the stored
 * keys (cached for ten minutes in the backend; `refresh` asks again). A provider that could
 * not be reached comes back with `error` and no models.
 */
export function listAvailableModels(refresh = false): Promise<ProviderModels[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleCredentialsBackend.listAvailableModels(refresh)
  return callBackend('list_available_models', { refresh })
}
