import type { ToolInputSchema } from '../agentGraphTypes'
import { readSampleMcpServers } from './mcpServers'
import { samplePluginsBackend } from './plugins'
import { respondWith } from './sampleResponse'

/**
 * Sample `get_tool_input_schemas`: the installed sample plugins' tools with the schemas
 * their manifests would declare, and the sample MCP servers' tools with the schema of
 * their last connection test (a tool without one stays unknown, like an older check).
 */

const samplePluginToolSchemas: Record<string, Record<string, unknown>> = {
  send_whatsapp_text: {
    type: 'object',
    properties: { phone: { type: 'string', description: 'Phone number with country code' }, text: { type: 'string' } },
    required: ['phone', 'text'],
  },
  search_google_maps: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to search, e.g. cafes in Bandung' }, max_results: { type: 'integer', minimum: 1, maximum: 100 } },
    required: ['query'],
  },
}

export async function listSampleToolInputSchemas(): Promise<ToolInputSchema[]> {
  const plugins = await samplePluginsBackend.listInstalledPlugins()
  return respondWith(() => [
    ...plugins.flatMap((plugin) =>
      plugin.tools.map((tool): ToolInputSchema => ({ provider: plugin.name, name: tool, description: '', source: 'plugin', inputSchema: samplePluginToolSchemas[tool] ?? null })),
    ),
    ...readSampleMcpServers().flatMap((server) =>
      server.knownTools.map((tool): ToolInputSchema => ({ provider: server.name, name: tool.name, description: tool.description, source: 'mcp', inputSchema: tool.inputSchema ?? null })),
    ),
  ])
}
