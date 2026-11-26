import { BackendError } from '../client'
import type { McpServerDefinition, McpServerInput, McpServerTransport, McpToolApproval, McpToolInfo } from '../connectionTypes'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample MCP servers for the browser preview and tests, kept in module memory. Starts with
 * the one filesystem server the Connections design (screen 21) counts as "1 added".
 */

const serverNamePattern = /^[a-z0-9][a-z0-9_-]{0,39}$/
const reservedServerNames = ['agents', 'builtin']

/** A few of the Upwork server's tools, as a sample sign-in lists them. */
const sampleUpworkTools: McpToolInfo[] = [
  { name: 'list_accounts', description: 'Accounts you can act for' },
  { name: 'find_jobs', description: 'Search and read jobs' },
  { name: 'get_job_posting', description: 'Your job posts' },
  { name: 'manage_proposals', description: 'Create and answer proposals (preview first)' },
  { name: 'send_message', description: 'Send a message in a room' },
  { name: 'confirm_preview', description: 'Confirm a previewed action' },
]

const readingVerbs = ['get', 'list', 'search', 'find', 'read', 'fetch', 'check', 'view', 'show', 'describe']

function matchesPattern(pattern: string, tool: string): boolean {
  return pattern.endsWith('*') ? tool.startsWith(pattern.slice(0, -1)) : pattern === tool
}

/** Mirrors the backend's `McpApprovalPolicy::tool_sends` (the name rule is simplified for the preview). */
function asksFirst(server: McpServerDefinition, tool: string): boolean {
  const approval = server.approval ?? {}
  if (approval.withoutApproval?.includes(tool)) return false
  if ((approval.askFirst ?? []).some((pattern) => matchesPattern(pattern, tool))) return true
  const firstWord = tool.split(/[_\-.]/)[0]?.toLowerCase() ?? ''
  const nameSends = !readingVerbs.includes(firstWord)
  if ((approval.readOnly ?? []).some((pattern) => matchesPattern(pattern, tool))) return nameSends
  return approval.defaultAsks === true || nameSends
}

function toolApprovals(server: McpServerDefinition): McpToolApproval[] {
  return server.knownTools.map((tool) => ({ name: tool.name, asksFirst: asksFirst(server, tool.name) }))
}

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
  const copy = structuredClone(server)
  return { ...copy, auth: copy.auth ?? 'none', approval: copy.approval ?? {}, signIn: copy.auth === 'oauth' ? (copy.signIn ?? { state: 'signedOut' }) : null, toolApprovals: toolApprovals(copy) }
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
  const bearerTokenSecret = input.bearerTokenSecret?.trim() || null
  const auth = input.auth ?? (bearerTokenSecret ? 'bearer' : 'none')
  const transport = validateTransport(input.transport)
  if (auth === 'oauth' && transport.kind !== 'http') throw new BackendError('invalid_input', 'signing in only applies to servers reached by URL')
  if (auth === 'bearer' && !bearerTokenSecret) throw new BackendError('invalid_input', 'name the secret sent as the bearer token')
  if (auth !== 'bearer' && bearerTokenSecret) throw new BackendError('invalid_input', 'a bearer token secret only applies to bearer authentication')
  const server: McpServerDefinition = {
    name,
    transport,
    secretEnv: input.secretEnv.map((secretName) => secretName.trim()).filter(Boolean),
    bearerTokenSecret,
    auth,
    approval: {},
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
  if (server.auth === 'oauth' && server.signIn?.state !== 'signedIn') {
    server.lastCheck = { connected: false, error: `MCP server \`${name}\` is not ready: not set up yet: a sign-in to ${name}`, checkedAt: new Date().toISOString() }
    return copyServer(server)
  }
  server.lastCheck = { connected: true, error: null, checkedAt: new Date().toISOString() }
  return copyServer(server)
}

/** The preview has no browser sign-in: it signs in at once and lists sample tools. */
function signIn(name: string): McpServerDefinition {
  const server = findServer(name)
  if (server.auth !== 'oauth') throw new BackendError('invalid_input', `\`${name}\` does not use sign-in`)
  server.signIn = { state: 'signedIn', signedInAt: new Date().toISOString() }
  if (server.plugin === 'upwork') server.knownTools = sampleUpworkTools
  return checkServer(name)
}

function signOut(name: string): McpServerDefinition {
  const server = findServer(name)
  server.signIn = { state: 'signedOut' }
  return copyServer(server)
}

function setToolApproval(name: string, tool: string, ask: boolean): McpServerDefinition {
  const server = findServer(name)
  const allowed = (server.approval?.withoutApproval ?? []).filter((existing) => existing !== tool)
  server.approval = { ...server.approval, withoutApproval: ask ? allowed : [...allowed, tool].sort() }
  return copyServer(server)
}

export const sampleMcpServersBackend = {
  listMcpServers: (): Promise<McpServerDefinition[]> => respondWith(() => storedServers.map(copyServer)),
  addMcpServer: (server: McpServerInput): Promise<McpServerDefinition> => respondWith(() => storeServer(server)),
  removeMcpServer: (name: string): Promise<void> =>
    respondWith(() => {
      const server = findServer(name)
      if (server.plugin) throw new BackendError('invalid_input', `remove the ${server.plugin} plugin to remove this server`)
      storedServers = storedServers.filter((server) => server.name !== name)
    }),
  testMcpServer: (name: string): Promise<McpServerDefinition> => respondWith(() => checkServer(name)),
  signInMcpServer: (name: string): Promise<McpServerDefinition> => respondWith(() => signIn(name)),
  cancelMcpSignIn: (name: string): Promise<void> =>
    respondWith(() => {
      findServer(name)
    }),
  signOutMcpServer: (name: string): Promise<McpServerDefinition> => respondWith(() => signOut(name)),
  setMcpToolApproval: (name: string, tool: string, ask: boolean): Promise<McpServerDefinition> => respondWith(() => setToolApproval(name, tool, ask)),
}

/** The stored sample servers (the sample secrets list reads which secrets they need). */
export function readSampleMcpServers(): McpServerDefinition[] {
  return storedServers.map(copyServer)
}

/** Restores the sample server list (use in test `beforeEach`). */
export function resetSampleMcpServers(): void {
  storedServers = createInitialServers()
}

/** Adds the server an installed MCP preset plugin brings, as the backend does on install (tests and the preview). */
export function addSamplePluginMcpServer(plugin: string, url: string): McpServerDefinition {
  const added = storeServer({ name: plugin, transport: { kind: 'http', url }, secretEnv: [], bearerTokenSecret: null, auth: 'oauth' })
  const server = findServer(added.name)
  server.plugin = plugin
  server.approval = { readOnly: ['find_*', 'get_*', 'list_*', 'search_*'], defaultAsks: true }
  return copyServer(server)
}
