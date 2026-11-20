import { useState, type FormEvent } from 'react'
import type { McpServerDefinition, McpServerInput } from '@/api/connectionTypes'
import { addMcpServer, listMcpServers, removeMcpServer, testMcpServer } from '@/api/mcpServers'
import { Button, Icon, StatusDot, joinClassNames, type StatusDotTone } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { ConnectionsNotice, ConnectionsSection, connectionsCardClassNames, useIsLinkedSection, useScrollToLinkedSection } from './ConnectionsSection'

const inputClassNames = 'box-border h-9 min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-ink'
const fieldLabelClassNames = 'flex flex-col gap-1 text-[12px] font-medium text-muted'
const mcpSectionId = 'connections-mcp'

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

  const checkTone: StatusDotTone = server.lastCheck?.connected === true ? 'ok' : server.lastCheck?.connected === false ? 'danger' : 'paused'
  const checkTextClassName = checkTone === 'ok' ? 'text-ok-strong' : checkTone === 'danger' ? 'text-danger' : 'text-muted'
  return (
    <article aria-label={server.name} className={`flex min-w-0 flex-col gap-2 p-4 ${connectionsCardClassNames}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">{server.name}</b>
        <span className="flex gap-1">
          <Button variant="secondary" size="sm" aria-label={`Test ${server.name}`} disabled={pendingAction !== null} onClick={() => void runAction('test')}>
            {pendingAction === 'test' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${server.name}`}
            disabled={pendingAction !== null}
            onClick={() => void runAction('remove')}
            className="!text-danger hover:!bg-danger-tint"
          >
            {pendingAction === 'remove' ? 'Removing…' : 'Remove'}
          </Button>
        </span>
      </div>
      <code className="block self-start rounded-lg bg-subtle px-2.5 py-1.5 font-mono text-[12px] text-body [overflow-wrap:anywhere]">{describeTransport(server)}</code>
      <span className="flex items-start gap-2">
        <StatusDot tone={checkTone} className="mt-[5px]" />
        <span className={joinClassNames('text-[13px] leading-normal', checkTextClassName)}>{describeCheck(server)}</span>
      </span>
      {secretNames.length > 0 && <span className="text-[12px] text-muted [overflow-wrap:anywhere]">Secrets: {secretNames.join(', ')}</span>}
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

function AddMcpServerForm({ onAdded, onClose }: { onAdded: () => Promise<void>; onClose: () => void }) {
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
    <form onSubmit={handleSubmit} aria-label="Add an MCP server" className={`flex flex-col gap-3 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${connectionsCardClassNames}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold">Add an MCP server</span>
        <span className="text-[12px] leading-normal text-muted">
          Agents use its tools as <code className="font-mono">name/tool</code>. graphrt starts or connects to it only while a run uses it
        </span>
      </span>
      <div className="flex flex-wrap gap-3">
        <label className={`${fieldLabelClassNames} flex-[1_1_160px]`}>
          Name
          <input value={formValues.name} placeholder="github" onChange={(event) => updateField('name', event.target.value)} className={inputClassNames} />
        </label>
        <label className={`${fieldLabelClassNames} flex-[1_1_160px]`}>
          How graphrt reaches it
          <select value={formValues.transportKind} onChange={(event) => updateField('transportKind', event.target.value === 'http' ? 'http' : 'stdio')} className={inputClassNames}>
            <option value="stdio">Start a command on this computer</option>
            <option value="http">Connect to a URL</option>
          </select>
        </label>
      </div>
      {isStdio ? (
        <div className="flex flex-wrap gap-3">
          <label className={`${fieldLabelClassNames} flex-[1_1_140px]`}>
            Command
            <input value={formValues.command} placeholder="npx" onChange={(event) => updateField('command', event.target.value)} className={inputClassNames} />
          </label>
          <label className={`${fieldLabelClassNames} flex-[3_1_260px]`}>
            Arguments
            <input value={formValues.argumentsText} placeholder="-y @modelcontextprotocol/server-github" onChange={(event) => updateField('argumentsText', event.target.value)} className={inputClassNames} />
          </label>
        </div>
      ) : (
        <label className={fieldLabelClassNames}>
          Server URL
          <input type="url" value={formValues.url} placeholder="https://mcp.example.com/mcp" onChange={(event) => updateField('url', event.target.value)} className={inputClassNames} />
        </label>
      )}
      <label className={fieldLabelClassNames}>
        {isStdio ? 'Secrets it needs (names, given as environment variables)' : 'Secret sent as the bearer token (name)'}
        <input value={formValues.secretsText} placeholder={isStdio ? 'GITHUB_TOKEN' : 'MCP_TOKEN'} onChange={(event) => updateField('secretsText', event.target.value)} className={inputClassNames} />
      </label>
      <span className="text-[12px] text-muted">Set the secret values under Secrets after adding the server</span>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      <div className="flex justify-end gap-2 border-t border-chip pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {isSaving ? 'Adding…' : 'Add server'}
        </Button>
      </div>
    </form>
  )
}

interface McpServersSectionProps {
  /** Description from the search data, e.g. "Give agents tools from any MCP server". */
  description: string
  /** Called after a change, so the Secrets list picks up new or removed secret names. */
  onServersChanged: () => Promise<void>
}

/**
 * "MCP servers" on screen 21: every added server (a command or a URL) with Test and
 * Remove, and "Add server" on the right, which unfolds the form. `?section=mcp` opens the
 * form and scrolls here. Agents use the tools as `<name>/<tool>`.
 */
export function McpServersSection({ description, onServersChanged }: McpServersSectionProps) {
  const servers = useAsyncData(listMcpServers, [])
  const isLinked = useIsLinkedSection('mcp')
  const [isAdding, setIsAdding] = useState(isLinked)
  useScrollToLinkedSection('mcp', mcpSectionId)
  const countText = servers.data ? ` · ${servers.data.length} added` : ''

  async function handleChanged() {
    await Promise.all([servers.reload(), onServersChanged()])
  }

  return (
    <ConnectionsSection
      id={mcpSectionId}
      title="MCP servers"
      description={`${description}${countText}`}
      action={
        !isAdding && (
          <Button variant="secondary" size="sm" onClick={() => setIsAdding(true)}>
            <Icon name="plus" size={14} />
            Add server
          </Button>
        )
      }
    >
      {isAdding && <AddMcpServerForm onAdded={handleChanged} onClose={() => setIsAdding(false)} />}
      {servers.error && <ConnectionsNotice tone="danger">Could not load MCP servers: {describeError(servers.error)}</ConnectionsNotice>}
      {!servers.error && !servers.data && <ConnectionsNotice>Loading MCP servers…</ConnectionsNotice>}
      {servers.data?.length === 0 && <ConnectionsNotice>No MCP servers yet. Add one to give your agents its tools</ConnectionsNotice>}
      {servers.data && servers.data.length > 0 && (
        <div className="flex flex-col gap-3">
          {servers.data.map((server) => (
            <McpServerCard key={server.name} server={server} onChanged={handleChanged} />
          ))}
        </div>
      )}
    </ConnectionsSection>
  )
}
