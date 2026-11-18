import { callBackend, isDesktopApp } from './client'
import type { McpServerDefinition, McpServerInput } from './connectionTypes'
import { sampleMcpServersBackend } from './sampleBackend/mcpServers'

/**
 * MCP servers (Connections > Advanced). Their tools are available to every run's `tool`
 * and `agent` nodes as `<name>/<tool>`; the app connects only when a node uses them.
 */

export function listMcpServers(): Promise<McpServerDefinition[]> {
  if (!isDesktopApp()) return sampleMcpServersBackend.listMcpServers()
  return callBackend('list_mcp_servers')
}

/** Stores a server; nothing connects until `testMcpServer` or a run uses it. */
export function addMcpServer(server: McpServerInput): Promise<McpServerDefinition> {
  if (!isDesktopApp()) return sampleMcpServersBackend.addMcpServer(server)
  return callBackend('add_mcp_server', { server })
}

export function removeMcpServer(name: string): Promise<void> {
  if (!isDesktopApp()) return sampleMcpServersBackend.removeMcpServer(name)
  return callBackend('remove_mcp_server', { name })
}

/** Connects, lists the tools and disconnects; a failure is reported in `lastCheck`, not thrown. */
export function testMcpServer(name: string): Promise<McpServerDefinition> {
  if (!isDesktopApp()) return sampleMcpServersBackend.testMcpServer(name)
  return callBackend('test_mcp_server', { name })
}
