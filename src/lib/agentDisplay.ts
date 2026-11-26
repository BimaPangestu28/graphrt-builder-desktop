import type { AgentKind, AgentStatus, ModelProvider } from '@/api/types'
import type { StatusDotTone } from '@/components/ui'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'
import { modelProviderNames } from '@/lib/settings'

/** How agents, statuses and providers from the backend are labelled across screens. */

const statusDotTones: Record<AgentStatus, StatusDotTone> = {
  active: 'ok',
  paused: 'paused',
  draft: 'brand',
  tested: 'brand',
}

/** Kind tag shown next to an agent name; plain task agents have none. */
const kindLabels: Readonly<Record<AgentKind, string | undefined>> = localizedRecord(() => ({ task: undefined, ...messages().lib.kindLabels }))

/** The same names as Settings and Connections, local CLIs marked "(on this computer)". */
const providerNames: Readonly<Record<ModelProvider, string>> = modelProviderNames

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
