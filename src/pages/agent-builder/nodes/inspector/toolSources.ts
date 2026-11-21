import { listAgentSteps } from '@/api/chains'
import { listMcpServers } from '@/api/mcpServers'
import { listInstalledPlugins } from '@/api/plugins'
import type { AgentInput } from '@/api/chainTypes'
import { useAsyncData } from '@/hooks/useAsyncData'

/**
 * Tools a "Run an agent" or "Use a tool" step can call on this computer (spec B10 /
 * B15): your other agents (`agents/<agent id>`), each installed plugin's tools
 * (`<plugin>/<tool>`) and MCP servers (`<server>/<tool>`). A source that cannot be read
 * is left out; the others still show.
 */

export type ToolSourceKind = 'agents' | 'plugins' | 'mcp'

export interface ToolChoice {
  /** `provider/name`, the form `tools` and `require_approval` use. */
  reference: string
  provider: string
  name: string
  /** What people see ("Morning email digest", "search_places"). */
  label: string
  source: ToolSourceKind
  /** An agent's Start inputs (agents only). */
  inputs: AgentInput[]
  note: string | null
}

export interface ToolSources {
  agents: ToolChoice[]
  plugins: ToolChoice[]
  mcp: ToolChoice[]
}

async function readOrEmpty<Item>(load: () => Promise<Item[]>, what: string): Promise<Item[]> {
  try {
    return await load()
  } catch (rawError) {
    console.warn(`Could not list ${what} for the tool picker`, rawError)
    return []
  }
}

/**
 * Loads every tool source once.
 *
 * @param currentAgentId - The agent being edited (left out of "your agents") (string)
 * @returns The tool lists, empty while loading (ToolSources)
 */
export async function loadToolSources(currentAgentId: string): Promise<ToolSources> {
  const [agentSteps, plugins, servers] = await Promise.all([readOrEmpty(listAgentSteps, 'agents'), readOrEmpty(listInstalledPlugins, 'plugins'), readOrEmpty(listMcpServers, 'MCP servers')])
  return {
    agents: agentSteps
      .filter((agentStep) => agentStep.agentId !== currentAgentId)
      .map((agentStep) => ({
        reference: `agents/${agentStep.agentId}`,
        provider: 'agents',
        name: agentStep.agentId,
        label: agentStep.name,
        source: 'agents' as const,
        inputs: agentStep.inputs,
        note: agentStep.usableAsStep ? `${agentStep.inputs.length === 0 ? 'no' : agentStep.inputs.length} input${agentStep.inputs.length === 1 ? '' : 's'}` : agentStep.unusableReason,
      })),
    plugins: plugins.flatMap((plugin) => plugin.tools.map((tool) => ({ reference: `${plugin.name}/${tool}`, provider: plugin.name, name: tool, label: tool, source: 'plugins' as const, inputs: [], note: null }))),
    mcp: servers.flatMap((server) => server.knownTools.map((tool) => ({ reference: `${server.name}/${tool.name}`, provider: server.name, name: tool.name, label: tool.name, source: 'mcp' as const, inputs: [], note: tool.description || null }))),
  }
}

const emptySources: ToolSources = { agents: [], plugins: [], mcp: [] }

/** {@link loadToolSources} as a hook. */
export function useToolSources(currentAgentId: string): ToolSources & { isLoading: boolean } {
  const { data, isLoading } = useAsyncData(() => loadToolSources(currentAgentId), [currentAgentId])
  return { ...(data ?? emptySources), isLoading }
}

/** Plain words for tools that send or change things ("Tools that send … should ask first"). */
export function looksLikeSendingTool(name: string): boolean {
  return /(send|post|create|update|delete|remove|write|publish|reply|message)/i.test(name)
}
