import { useState, type FormEvent } from 'react'
import type { McpServerDefinition, McpServerInput } from '@/api/connectionTypes'
import { addMcpServer, removeMcpServer, testMcpServer } from '@/api/mcpServers'
import { describeError } from '@/lib/agentDisplay'
import type { AsyncDataState } from '@/hooks/useAsyncData'

const inputClassNames = 'box-border h-9 min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink'
const smallButtonClassNames =
  'h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

/** "npx -y server" or the URL. */
export function describeTransport(server: McpServerDefinition): string {
  return server.transport.kind === 'stdio' ? [server.transport.command, ...server.transport.args].join(' ') : server.transport.url
}

/** "Connected · 3 tools: a, b, c", "Could not connect: …" or "Not tested yet". */
export function describeCheck(server: McpServerDefinition): string {
  const { lastCheck, knownTools } = server
  if (!lastCheck) return 'Not tested yet'
  if (!lastCheck.connected) return `Could not connect: ${lastCheck.error ?? 'unknown error'}`
  const toolsText = knownTools.length === 1 ? '1 tool' : `${knownTools.length} tools`
  const toolNames = knownTools.map((tool) => tool.name).join(', ')
  return knownTools.length > 0 ? `Connected · ${toolsText}: ${toolNames}` : 'Connected · no tools'
}

function splitNames(text: string, separator: RegExp): string[] {
  return text.split(separator).map((part) => part.trim()).filter(Boolean)
}

interface McpServerCardProps {
  server: McpServerDefinition
  onChanged: () => Promise<void>
}

function McpServerCard({ server, onChanged }: McpServerCardProps) {
  const [pendingAction, setPendingAction] = useState<'test' | 'remove' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const secretNames = [...server.secretEnv, ...(server.bearerTokenSecret ? [server.bearerTokenSecret] : [])]

  async function runAction(action: 'test' | 'remove') {
    setPendingAction(action)
    setErrorMessage(null)
    try {
      if (action === 'test') await testMcpServer(server.name)
      else await removeMcpServer(server.name)
      await onChanged()
    } catch (actionError) {
      setErrorMessage(`Could not ${action === 'test' ? 'test' : 'remove'} ${server.name}: ${describeError(actionError)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const isConnected = server.lastCheck?.connected === true
  const hasFailed = server.lastCheck?.connected === false
  return (
    <article aria-label={server.name} className="flex flex-col gap-1.5 rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="font-semibold">{server.name}</b>
        <span className="flex gap-2">
          <button type="button" aria-label={`Test ${server.name}`} disabled={pendingAction !== null} onClick={() => void runAction('test')} className={smallButtonClassNames}>
            {pendingAction === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" aria-label={`Remove ${server.name}`} disabled={pendingAction !== null} onClick={() => void runAction('remove')} className={smallButtonClassNames}>
            {pendingAction === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        </span>
      </div>
      <span className="break-all font-mono text-[12px] text-body">{describeTransport(server)}</span>
      {secretNames.length > 0 && <span className="text-[12px] text-muted">Secrets: {secretNames.join(', ')}</span>}
      <span className={`text-[13px] ${isConnected ? 'text-ok-strong' : hasFailed ? 'text-danger' : 'text-muted'}`}>{describeCheck(server)}</span>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
    </article>
  )
}

type TransportKind = McpServerInput['transport']['kind']

interface AddFormValues {
  name: string
  transportKind: TransportKind
  command: string
  argumentsText: string
  url: string
  secretsText: string
}

const emptyFormValues: AddFormValues = { name: '', transportKind: 'stdio', command: '', argumentsText: '', url: '', secretsText: '' }

/** The backend input for the form (arguments split on spaces, secret names on commas). */
export function buildServerInput(values: AddFormValues): McpServerInput {
  const secretNames = splitNames(values.secretsText, /[,\s]+/)
  if (values.transportKind === 'stdio') {
    return {
      name: values.name,
      transport: { kind: 'stdio', command: values.command, args: splitNames(values.argumentsText, /\s+/) },
      secretEnv: secretNames,
      bearerTokenSecret: null,
    }
  }
  return { name: values.name, transport: { kind: 'http', url: values.url }, secretEnv: [], bearerTokenSecret: secretNames[0] ?? null }
}

function AddMcpServerForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [formValues, setFormValues] = useState<AddFormValues>(emptyFormValues)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isStdio = formValues.transportKind === 'stdio'
  const target = isStdio ? formValues.command : formValues.url
  const canSave = formValues.name.trim().length > 0 && target.trim().length > 0 && !isSaving

  function updateField<Key extends keyof AddFormValues>(key: Key, value: AddFormValues[Key]) {
    setFormValues((previousValues) => ({ ...previousValues, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await addMcpServer(buildServerInput(formValues))
      setFormValues(emptyFormValues)
      await onAdded()
    } catch (addError) {
      setErrorMessage(`Could not add the server: ${describeError(addError)}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add an MCP server" className="flex flex-col gap-2.5 rounded-xl border border-dashed border-line-strong p-3.5">
      <b className="font-semibold">Add a server</b>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-[1_1_160px] flex-col gap-1 text-[13px] font-medium">
          Name
          <input value={formValues.name} placeholder="github" onChange={(event) => updateField('name', event.target.value)} className={inputClassNames} />
        </label>
        <label className="flex flex-[1_1_160px] flex-col gap-1 text-[13px] font-medium">
          How graphrt reaches it
          <select value={formValues.transportKind} onChange={(event) => updateField('transportKind', event.target.value === 'http' ? 'http' : 'stdio')} className={inputClassNames}>
            <option value="stdio">Start a command on this computer</option>
            <option value="http">Connect to a URL</option>
          </select>
        </label>
      </div>
      {isStdio ? (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-[1_1_140px] flex-col gap-1 text-[13px] font-medium">
            Command
            <input value={formValues.command} placeholder="npx" onChange={(event) => updateField('command', event.target.value)} className={inputClassNames} />
          </label>
          <label className="flex flex-[3_1_260px] flex-col gap-1 text-[13px] font-medium">
            Arguments
            <input value={formValues.argumentsText} placeholder="-y @modelcontextprotocol/server-github" onChange={(event) => updateField('argumentsText', event.target.value)} className={inputClassNames} />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Server URL
          <input type="url" value={formValues.url} placeholder="https://mcp.example.com/mcp" onChange={(event) => updateField('url', event.target.value)} className={inputClassNames} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[13px] font-medium">
        {isStdio ? 'Secrets it needs (names, given as environment variables)' : 'Secret sent as the bearer token (name)'}
        <input value={formValues.secretsText} placeholder={isStdio ? 'GITHUB_TOKEN' : 'MCP_TOKEN'} onChange={(event) => updateField('secretsText', event.target.value)} className={inputClassNames} />
      </label>
      <span className="text-[12px] text-muted">Set the secret values in the Secrets list above after adding the server</span>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      <span>
        <button type="submit" disabled={!canSave} className="h-8 cursor-pointer rounded-lg border-0 bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50">
          {isSaving ? 'Adding…' : 'Add server'}
        </button>
      </span>
    </form>
  )
}

interface McpServersPanelProps {
  servers: AsyncDataState<McpServerDefinition[]>
  /** Called after a change, so the Secrets list picks up new or removed secret names. */
  onServersChanged: () => Promise<void>
}

/**
 * Connections > Advanced > MCP servers: add a server (a command or a URL), test it and
 * remove it. Agents use its tools as `<name>/<tool>`; graphrt connects only while a run uses them.
 */
export function McpServersPanel({ servers, onServersChanged }: McpServersPanelProps) {
  async function handleChanged() {
    await Promise.all([servers.reload(), onServersChanged()])
  }

  return (
    <section aria-labelledby="connections-mcp-h" className="flex flex-col gap-2.5">
      <h3 id="connections-mcp-h" className="m-0 text-[15px] font-semibold">
        MCP servers
      </h3>
      <p className="m-0 text-[13px] text-body">
        Agents use a server's tools as <code className="font-mono">name/tool</code>. graphrt starts or connects to it only while a run uses it
      </p>
      {servers.error && <p className="m-0 text-[13px] text-danger">Could not load MCP servers: {describeError(servers.error)}</p>}
      {!servers.error && !servers.data && <p className="m-0 text-[13px] text-muted">Loading MCP servers…</p>}
      {servers.data?.length === 0 && <p className="m-0 text-[13px] text-muted">No MCP servers yet</p>}
      {servers.data?.map((server) => (
        <McpServerCard key={server.name} server={server} onChanged={handleChanged} />
      ))}
      <AddMcpServerForm onAdded={handleChanged} />
    </section>
  )
}
