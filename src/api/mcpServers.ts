import { callBackend, isDesktopApp } from './client'
import type { McpServerDefinition, McpServerInput } from './connectionTypes'
import { sampleMcpServersBackend } from './sampleBackend/mcpServers'

/**
 * MCP servers (Connections, MCP servers tab). Their tools are available to every run's `tool`
 * and `agent` nodes as `<name>/<tool>`; the app connects only when a node uses them.
 */

export function listMcpServers(): Promise<McpServerDefinition[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.listMcpServers()
  return callBackend('list_mcp_servers')
}

/** Stores a server; nothing connects until `testMcpServer` or a run uses it. */
export function addMcpServer(server: McpServerInput): Promise<McpServerDefinition> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.addMcpServer(server)
  return callBackend('add_mcp_server', { server })
}

/** Removes a server; a signed-in server is signed out first. */
export function removeMcpServer(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.removeMcpServer(name)
  return callBackend('remove_mcp_server', { name })
}

/** Connects, lists the tools and disconnects; a failure is reported in `lastCheck`, not thrown. */
export function testMcpServer(name: string): Promise<McpServerDefinition> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.testMcpServer(name)
  return callBackend('test_mcp_server', { name })
}

/**
 * Opens the server's sign-in page in the browser and resolves when the user finished (up to
 * 5 minutes); then the connection is tested. Rejects when the sign-in failed or was cancelled.
 */
export function signInMcpServer(name: string): Promise<McpServerDefinition> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.signInMcpServer(name)
  return callBackend('sign_in_mcp_server', { name })
}

/** Stops a sign-in that is waiting for the browser. */
export function cancelMcpSignIn(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.cancelMcpSignIn(name)
  return callBackend('cancel_mcp_sign_in', { name })
}

/** Revokes the tokens (when the server supports it) and forgets the sign-in. */
export function signOutMcpServer(name: string): Promise<McpServerDefinition> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.signOutMcpServer(name)
  return callBackend('sign_out_mcp_server', { name })
}

/** `ask: false` lets the tool run without asking first; `ask: true` makes it ask again. */
export function setMcpToolApproval(name: string, tool: string, ask: boolean): Promise<McpServerDefinition> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleMcpServersBackend.setMcpToolApproval(name, tool, ask)
  return callBackend('set_mcp_tool_approval', { name, tool, ask })
}
