import { BackendError } from '../client'
import type { NewWorkflowSecret, WorkflowSecretOverview } from '../connectionTypes'
import type { ProviderModels } from '../modelCatalogTypes'
import type { ModelChoice, ModelProvider, ProviderStatus, WorkflowSecretStatus } from '../types'
import { readSampleMcpServers } from './mcpServers'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample provider keys for the browser preview and tests. Only whether a key is set
 * is remembered (in module memory); the key text itself is dropped, just as the
 * keychain-backed store never hands keys back to the UI.
 */

const defaultOllamaBaseUrl = 'http://localhost:11434'
const keyedProviders: ModelProvider[] = ['openai', 'anthropic', 'gemini', 'deepseek']

interface SampleCredentialsState {
  configuredProviders: Set<ModelProvider>
  ollamaBaseUrl: string
  defaultModel: ModelChoice
  /** Names of workflow secrets that have a value (the value itself is dropped). */
  configuredSecretNames: Set<string>
  /** Secrets saved in the app (Add secret, Replace), like the backend's saved-secrets index. */
  savedSecrets: Map<string, SampleSavedSecret>
}

interface SampleSavedSecret {
  note: string | null
  createdAt: string
  updatedAt: string
}

function createInitialState(): SampleCredentialsState {
  return {
    configuredProviders: new Set<ModelProvider>(['openai']),
    ollamaBaseUrl: defaultOllamaBaseUrl,
    defaultModel: { provider: 'openai', name: 'gpt-4o-mini' },
    configuredSecretNames: new Set<string>(['GOOGLE_PLACES_API_KEY']),
    savedSecrets: new Map<string, SampleSavedSecret>(),
  }
}

/** Secrets the sample agents declare, as the Connections design shows them (screen 21). */
const sampleAgentSecrets: Array<Omit<WorkflowSecretOverview, 'configured' | 'mcpServers' | 'note' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'GOOGLE_PLACES_API_KEY',
    description: 'Google Places API key',
    isSecret: true,
    required: true,
    agents: [{ agentId: 'maps-leads', agentName: 'Maps leads to WhatsApp' }],
  },
]

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

const workflowSecretNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Names the user types: `MY_SERVER_TOKEN` (same rule as `workflow_secrets/saved.rs`). */
const newSecretNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/
const secretValueMaxBytes = 16 * 1024
const secretNoteMaxChars = 200

/** Records a save in the saved-secrets index; `note` undefined keeps the stored one. */
function recordSecretSave(name: string, note?: string | null): void {
  const now = new Date().toISOString()
  const previousRecord = credentialsState.savedSecrets.get(name)
  credentialsState.savedSecrets.set(name, {
    note: note === undefined ? (previousRecord?.note ?? null) : note,
    createdAt: previousRecord?.createdAt ?? now,
    updatedAt: now,
  })
}

/** @throws BackendError - `invalid_input` for a blank or too large value */
function requireSecretValue(name: string, value: string): void {
  requireText(value, `the value for ${name} is empty`)
  if (new TextEncoder().encode(value).length > secretValueMaxBytes) {
    throw new BackendError('invalid_input', `the value for ${name} is too large (at most 16 KB)`)
  }
}

/** @throws BackendError - `invalid_input` for a malformed name or blank value */
function storeWorkflowSecret(name: string, value: string): void {
  if (!workflowSecretNamePattern.test(name)) throw new BackendError('invalid_input', 'secret names use letters, digits and underscores')
  requireSecretValue(name, value)
  credentialsState.configuredSecretNames.add(name)
  recordSecretSave(name)
}

/** @throws BackendError - `invalid_input` for a malformed name, bad value, long note or a name already saved */
function addSampleWorkflowSecret(secret: NewWorkflowSecret): void {
  const name = secret.name.trim()
  if (!newSecretNamePattern.test(name)) {
    throw new BackendError(
      'invalid_input',
      'secret names use capital letters, digits and underscores (like MY_SERVER_TOKEN), start with a letter and are at most 64 characters',
    )
  }
  const note = secret.note?.trim() || null
  if (note && note.length > secretNoteMaxChars) throw new BackendError('invalid_input', 'the note is too long (at most 200 characters)')
  if (credentialsState.configuredSecretNames.has(name)) {
    throw new BackendError('invalid_input', `a secret named ${name} is already saved; use Replace to change its value`)
  }
  requireSecretValue(name, secret.value)
  credentialsState.configuredSecretNames.add(name)
  recordSecretSave(name, note)
}

function removeSampleWorkflowSecret(name: string): void {
  credentialsState.configuredSecretNames.delete(name)
  credentialsState.savedSecrets.delete(name)
}

function emptySecretOverview(name: string, required: boolean): WorkflowSecretOverview {
  return { name, description: null, isSecret: true, required, configured: false, agents: [], mcpServers: [], note: null, createdAt: null, updatedAt: null }
}

/**
 * The sample agents' workflows declare no `env` values, so this is empty; tests that
 * need secrets stub it.
 */
function listSampleWorkflowSecrets(_agentId: string): WorkflowSecretStatus[] {
  return []
}

/**
 * Every sample secret name with its status: the agents' secrets, the sample MCP servers'
 * ones and the ones saved in the app.
 */
function listAllSampleWorkflowSecrets(): WorkflowSecretOverview[] {
  const secretsByName = new Map<string, WorkflowSecretOverview>()
  for (const agentSecret of sampleAgentSecrets) {
    secretsByName.set(agentSecret.name, { ...emptySecretOverview(agentSecret.name, agentSecret.required), ...agentSecret, agents: [...agentSecret.agents] })
  }
  for (const server of readSampleMcpServers()) {
    const serverSecretNames = [...server.secretEnv, ...(server.bearerTokenSecret ? [server.bearerTokenSecret] : [])]
    for (const secretName of serverSecretNames) {
      const secret = secretsByName.get(secretName) ?? emptySecretOverview(secretName, true)
      secret.mcpServers.push(server.name)
      secretsByName.set(secretName, secret)
    }
  }
  for (const [secretName, savedSecret] of credentialsState.savedSecrets) {
    const secret = secretsByName.get(secretName) ?? emptySecretOverview(secretName, false)
    secretsByName.set(secretName, { ...secret, ...savedSecret })
  }
  return [...secretsByName.values()]
    .map((secret) => ({ ...secret, configured: credentialsState.configuredSecretNames.has(secret.name) }))
    .sort((first, second) => first.name.localeCompare(second.name))
}

/** Whether a sample workflow secret was set (tests read this after saving). */
export function isSampleWorkflowSecretConfigured(name: string): boolean {
  return credentialsState.configuredSecretNames.has(name)
}

/** What each provider's model list looks like, for the browser preview. */
const sampleModelIdsByProvider: Record<ModelProvider, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  anthropic: ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.2', 'qwen2.5:14b'],
}

/** Sample lists for every provider that is set up (Ollama included, as if it were running). */
function listSampleAvailableModels(): ProviderModels[] {
  return listStatuses()
    .filter((status) => status.configured)
    .map((status) => ({
      provider: status.provider,
      models: sampleModelIdsByProvider[status.provider].map((id) => ({ id, displayName: null })),
      error: null,
    }))
}

export const sampleCredentialsBackend = {
  setApiKey: (provider: ModelProvider, apiKey: string): Promise<void> => respondWith(() => storeApiKey(provider, apiKey)),
  deleteApiKey: (provider: ModelProvider): Promise<void> => respondWith(() => removeApiKey(provider)),
  listProviderStatuses: (): Promise<ProviderStatus[]> => respondWith(listStatuses),
  getDefaultModel: (): Promise<ModelChoice> => respondWith(readSampleDefaultModel),
  setDefaultModel: (choice: ModelChoice): Promise<void> => respondWith(() => storeDefaultModel(choice)),
  setOllamaBaseUrl: (baseUrl: string): Promise<void> => respondWith(() => storeOllamaBaseUrl(baseUrl)),
  listAvailableModels: (_refresh: boolean): Promise<ProviderModels[]> => respondWith(listSampleAvailableModels),
  listWorkflowSecrets: (agentId: string): Promise<WorkflowSecretStatus[]> => respondWith(() => listSampleWorkflowSecrets(agentId)),
  listAllWorkflowSecrets: (): Promise<WorkflowSecretOverview[]> => respondWith(listAllSampleWorkflowSecrets),
  setWorkflowSecret: (name: string, value: string): Promise<void> => respondWith(() => storeWorkflowSecret(name, value)),
  addWorkflowSecret: (secret: NewWorkflowSecret): Promise<void> => respondWith(() => addSampleWorkflowSecret(secret)),
  deleteWorkflowSecret: (name: string): Promise<void> => respondWith(() => removeSampleWorkflowSecret(name)),
}

/** Restores the sample keys and default model (use in test `beforeEach`). */
export function resetSampleCredentials(): void {
  credentialsState = createInitialState()
}
