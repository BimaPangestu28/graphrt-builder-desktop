import { BackendError } from '../client'
import type { McpServerDefinition, McpServerInput, McpServerTransport } from '../connectionTypes'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample MCP servers for the browser preview and tests, kept in module memory. Starts with
 * the one filesystem server the Connections design (screen 21) counts as "1 added".
 */

const serverNamePattern = /^[a-z0-9][a-z0-9_-]{0,39}$/
const reservedServerNames = ['agents', 'builtin']

function createInitialServers(): McpServerDefinition[] {
  return [
    {
      name: 'files',
      transport: { kind: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '[FOLDER]'] },
      secretEnv: [],
      bearerTokenSecret: null,
      knownTools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File to read' } }, required: ['path'] } },
        { name: 'list_directory', description: 'List a folder' },
        { name: 'search_files', description: 'Find files by name', inputSchema: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string', description: 'Name pattern, e.g. *.pdf' }, max_results: { type: 'integer', minimum: 1 } }, required: ['path', 'pattern'] } },
      ],
      lastCheck: { connected: true, error: null, checkedAt: '2026-11-17T09:00:00Z' },
    },
  ]
}

let storedServers = createInitialServers()

function copyServer(server: McpServerDefinition): McpServerDefinition {
  return structuredClone(server)
}

/** @throws BackendError - `invalid_input` like the backend's checks */
function validateTransport(transport: McpServerTransport): McpServerTransport {
  if (transport.kind === 'stdio') {
    const command = requireText(transport.command, 'enter the command that starts the server')
    return { kind: 'stdio', command, args: transport.args.map((arg) => arg.trim()).filter(Boolean) }
  }
  const url = transport.url.trim()
  if (!/^https?:\/\/\S+$/.test(url)) throw new BackendError('invalid_input', 'the server address must start with https:// or http://')
  return { kind: 'http', url }
}

/** @throws BackendError - `invalid_input` for a bad name, a taken name or a bad transport */
function storeServer(input: McpServerInput): McpServerDefinition {
  const name = input.name.trim()
  if (!serverNamePattern.test(name)) {
    throw new BackendError('invalid_input', 'MCP server names use lowercase letters, digits, - and _')
  }
  if (reservedServerNames.includes(name)) throw new BackendError('invalid_input', `\`${name}\` is reserved; pick another name`)
  if (storedServers.some((server) => server.name === name)) {
    throw new BackendError('invalid_input', `an MCP server named \`${name}\` is already added`)
  }
  const server: McpServerDefinition = {
    name,
    transport: validateTransport(input.transport),
    secretEnv: input.secretEnv.map((secretName) => secretName.trim()).filter(Boolean),
    bearerTokenSecret: input.bearerTokenSecret?.trim() || null,
    knownTools: [],
    lastCheck: null,
  }
  storedServers = [...storedServers, server]
  return copyServer(server)
}

function findServer(name: string): McpServerDefinition {
  const server = storedServers.find((candidate) => candidate.name === name)
  if (!server) throw new BackendError('not_found', `MCP server ${name} not found`)
  return server
}

/** The preview cannot start programs: a check succeeds with the tools the server already lists. */
function checkServer(name: string): McpServerDefinition {
  const server = findServer(name)
  server.lastCheck = { connected: true, error: null, checkedAt: new Date().toISOString() }
  return copyServer(server)
}

export const sampleMcpServersBackend = {
  listMcpServers: (): Promise<McpServerDefinition[]> => respondWith(() => storedServers.map(copyServer)),
  addMcpServer: (server: McpServerInput): Promise<McpServerDefinition> => respondWith(() => storeServer(server)),
  removeMcpServer: (name: string): Promise<void> =>
    respondWith(() => {
      findServer(name)
      storedServers = storedServers.filter((server) => server.name !== name)
    }),
  testMcpServer: (name: string): Promise<McpServerDefinition> => respondWith(() => checkServer(name)),
}

/** The stored sample servers (the sample secrets list reads which secrets they need). */
export function readSampleMcpServers(): McpServerDefinition[] {
  return storedServers.map(copyServer)
}

/** Restores the sample server list (use in test `beforeEach`). */
export function resetSampleMcpServers(): void {
  storedServers = createInitialServers()
}
