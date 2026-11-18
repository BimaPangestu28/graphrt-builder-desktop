import type { AgentKind, BuildRequest } from '@/api/types'

/** Router state that screen 02 passes to screen 03: `navigate(path, { state: { buildRequest } })`. */
export interface BuildRequestLocationState {
  buildRequest: BuildRequest
}

const agentKinds: AgentKind[] = ['task', 'chatbot', 'chain', 'team']

function isAgentKindOrNull(value: unknown): value is AgentKind | null {
  return value === null || agentKinds.includes(value as AgentKind)
}

/**
 * Reads the build request from router state, or null when the screen was opened
 * directly (screen index, reload) or the state has an unexpected shape.
 *
 * @param locationState - `useLocation().state` (unknown)
 * @returns The request to build (BuildRequest | null)
 */
export function readBuildRequest(locationState: unknown): BuildRequest | null {
  if (!locationState || typeof locationState !== 'object' || !('buildRequest' in locationState)) return null
  const { buildRequest } = locationState as { buildRequest: unknown }
  if (!buildRequest || typeof buildRequest !== 'object') return null
  const { description, kind } = buildRequest as { description?: unknown; kind?: unknown }
  if (typeof description !== 'string' || !isAgentKindOrNull(kind ?? null)) return null
  return { description, kind: (kind ?? null) as AgentKind | null }
}
