import type { AgentKind, AgentStatus, ModelProvider } from '@/api/types'
import type { StatusDotTone } from '@/components/ui'

/** How agents, statuses and providers from the backend are labelled across screens. */

const statusDotTones: Record<AgentStatus, StatusDotTone> = {
  active: 'ok',
  paused: 'paused',
  draft: 'brand',
  tested: 'brand',
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
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  'claude-code-cli': 'Claude Code (on this computer)',
  'codex-cli': 'Codex (on this computer)',
  'gemini-cli': 'Gemini CLI (on this computer)',
  'cursor-cli': 'Cursor CLI (on this computer)',
  'copilot-cli': 'GitHub Copilot CLI (on this computer)',
  'opencode-cli': 'OpenCode (on this computer)',
  'qwen-code-cli': 'Qwen Code (on this computer)',
}

/** Sidebar dot colour for an agent status (active → ok, paused → paused, draft/tested → brand). */
export function getStatusDotTone(status: AgentStatus): StatusDotTone {
  return statusDotTones[status]
}

/** "Chatbot", "Chain", "Team", or undefined for task agents. */
export function getKindLabel(kind: AgentKind): string | undefined {
  return kindLabels[kind]
}

/** Display name of a model provider, e.g. "Google Gemini". Unknown names are returned as is. */
export function getProviderName(provider: ModelProvider | string): string {
  return provider in providerNames ? providerNames[provider as ModelProvider] : provider
}

/** Message to show for a failed load or action. Same as {@link toErrorMessage}; kept as the name most screens use. */
export { toErrorMessage as describeError } from './errors'
