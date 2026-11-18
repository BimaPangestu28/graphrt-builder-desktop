import type { AgentKind, AgentStatus, ModelProvider } from '@/api/types'
import type { StatusDotTone } from '@/components/ui'

/** How agents, statuses and providers from the backend are labelled across screens. */

const statusDotTones: Record<AgentStatus, StatusDotTone> = {
  active: 'ok',
  paused: 'paused',
  draft: 'brand',
  tested: 'brand',
}

const statusLabels: Record<AgentStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  draft: 'Draft',
  tested: 'Tested',
}

/** Kind tag shown next to an agent name; plain task agents have none. */
const kindLabels: Record<AgentKind, string | undefined> = {
  task: undefined,
  chatbot: 'Chatbot',
  chain: 'Chain',
  team: 'Team',
}

const providerNames: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  ollama: 'Ollama',
}

/** Sidebar dot colour for an agent status (active → ok, paused → paused, draft/tested → brand). */
export function getStatusDotTone(status: AgentStatus): StatusDotTone {
  return statusDotTones[status]
}

/** "Active", "Paused", "Draft" or "Tested". */
export function getStatusLabel(status: AgentStatus): string {
  return statusLabels[status]
}

/** "Chatbot", "Chain", "Team", or undefined for task agents. */
export function getKindLabel(kind: AgentKind): string | undefined {
  return kindLabels[kind]
}

/** Display name of a model provider, e.g. "Google Gemini". Unknown names are returned as is. */
export function getProviderName(provider: ModelProvider | string): string {
  return provider in providerNames ? providerNames[provider as ModelProvider] : provider
}

/** Message to show for a failed load or action; falls back to a generic sentence. */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong'
}
