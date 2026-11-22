import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { updateGraphNode } from '../../graphEdits'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigObject, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, SegmentedChoice, SelectInput, SupportNote, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { ModelField } from '../ModelField'
import { formatReference, readSelector, singleReference, templateReferences } from '../references'
import { propertyLabel, schemaProperties, schemaRequired } from '../SchemaForm'
import { SecretPicker, withSecretDeclared } from '../SecretPicker'
import { SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'
import { describeSchemaInputs, looksLikeSendingTool, useToolSources, type ToolChoice, type ToolSources } from '../toolSources'

/**
 * HTTP request (`http-request`, B9), Run an agent (`agent`, B10) and Use a tool
 * (`tool`, B15).
 */

/** One `key: value` pair of headers, query parameters or a form body. */
export interface KeyValueRow {
  key: string
  value: string
}

/**
 * Headers / params in any of graphrt's three shapes (`k: v` lines, `[{key, value}]`, a
 * map) as rows. Editing writes the list form.
 *
 * @example
 * readKeyValueRows('Accept: application/json') // [{ key: 'Accept', value: 'application/json' }]
 */
export function readKeyValueRows(value: JsonValue | undefined): KeyValueRow[] {
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':')
        return separator < 0 ? { key: line, value: '' } : { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }
      })
  }
  if (Array.isArray(value)) return value.filter(isJsonObject).map((item) => ({ key: readConfigText(item, ['key']), value: readConfigText(item, ['value']) }))
  if (isJsonObject(value)) return Object.entries(value).map(([key, rowValue]) => ({ key, value: typeof rowValue === 'string' ? rowValue : JSON.stringify(rowValue) }))
  return []
}

function KeyValueEditor({ label, rows, onChange, addLabel }: { label: string; rows: KeyValueRow[]; onChange: (rows: KeyValueRow[], what: string) => void; addLabel: string }) {
  const { readOnly } = useInspector()
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_24px] items-center gap-1.5">
          <TextInput ariaLabel={`${label} ${index + 1} name`} placeholder="Name" value={row.key} disabled={readOnly} onCommit={(key) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, key } : item)), `changed ${label.toLowerCase()}`)} />
          <TextInput ariaLabel={`${label} ${index + 1} value`} placeholder="Value or {{#step.field#}}" value={row.value} disabled={readOnly} onCommit={(value) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)), `changed ${label.toLowerCase()}`)} />
          <RemoveButton label={`Remove ${label.toLowerCase()} ${index + 1}`} disabled={readOnly} onClick={() => onChange(rows.filter((_unused, itemIndex) => itemIndex !== index), `removed from ${label.toLowerCase()}`)} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...rows, { key: '', value: '' }], `added to ${label.toLowerCase()}`)}>
        {addLabel}
      </AddButton>
    </div>
  )
}

const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head']
const bodyTypes = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'raw-text', label: 'Raw text' },
  { value: 'form-data', label: 'Form data' },
  { value: 'x-www-form-urlencoded', label: 'Form URL-encoded' },
  { value: 'binary', label: 'File' },
]

function HttpBodyEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const bodyType = readConfigText(node.config, ['body', 'type']) || 'none'
  const data = readConfigValue(node.config, ['body', 'data'])
  const setBody = (body: JsonObject, what: string) => setConfigValue(['body'], body, what)
  const formRows = Array.isArray(data) ? data.filter(isJsonObject).map((item) => ({ key: readConfigText(item, ['key']), value: readConfigText(item, ['value']) })) : []
  const changeType = (type: string) => {
    const keepsText = (type === 'json' || type === 'raw-text') && typeof data === 'string'
    const keepsRows = (type === 'form-data' || type === 'x-www-form-urlencoded') && Array.isArray(data)
    setBody(type === 'none' ? { type } : { type, data: keepsText || keepsRows ? (data as JsonValue) : type === 'json' || type === 'raw-text' ? '' : [] }, `set the body to ${type}`)
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="Body">
        <SelectInput ariaLabel="Body type" value={bodyType} disabled={readOnly} options={bodyTypes} onChange={changeType} />
      </Field>
      {(bodyType === 'json' || bodyType === 'raw-text') && (
        <TemplateField label={bodyType === 'json' ? 'JSON body' : 'Text body'} multiline value={typeof data === 'string' ? data : data === undefined ? '' : JSON.stringify(data)} onCommit={(text) => setBody({ type: bodyType, data: text }, 'changed the body')} />
      )}
      {(bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') && (
        <KeyValueEditor label="Form fields" rows={formRows} addLabel="Add a field" onChange={(rows, what) => setBody({ type: bodyType, data: rows.map((row) => ({ key: row.key, type: 'text', value: row.value })) }, what)} />
      )}
      {bodyType === 'binary' && (
        <SelectorField
          label="File to send"
          required
          path={Array.isArray(data) && isJsonObject(data[0]) ? readSelector(data[0].file) : null}
          onChange={(path) => setBody({ type: 'binary', data: path ? [{ key: '', type: 'file', file: path }] : [] }, 'set the file to send')}
        />
      )}
    </div>
  )
}

function HttpAuthEditor() {
  const { node, graph, readOnly, controller, setConfigValue } = useInspector()
  const auth = readConfigObject(node.config, ['authorization'])
  const usesKey = readConfigText(auth, ['type']) === 'api-key'
  const keyType = readConfigText(auth, ['config', 'type']) || 'bearer'
  const apiKey = readConfigText(auth, ['config', 'api_key'])
  const secretName = singleReference(apiKey)?.[0] === 'env' ? singleReference(apiKey)?.[1] ?? '' : ''
  const writeAuth = (nextAuth: JsonObject, what: string) => setConfigValue(['authorization'], nextAuth, what)
  const writeKeyConfig = (changes: JsonObject, what: string) => writeAuth({ ...auth, type: 'api-key', config: { ...readConfigObject(auth, ['config']), ...changes } }, what)
  return (
    <div className="flex flex-col gap-2">
      <SegmentedChoice
        label="Sign-in"
        value={usesKey ? 'api-key' : 'no-auth'}
        disabled={readOnly}
        options={[
          { value: 'no-auth', label: 'No sign-in' },
          { value: 'api-key', label: 'API key' },
        ]}
        onChange={(type) => writeAuth(type === 'no-auth' ? { type } : { ...auth, type, config: { type: keyType, ...readConfigObject(auth, ['config']) } }, type === 'no-auth' ? 'removed the sign-in' : 'signed in with an API key')}
      />
      {usesKey && (
        <>
          <SelectInput
            ariaLabel="How the key is sent"
            value={keyType}
            disabled={readOnly}
            options={[
              { value: 'bearer', label: 'Bearer' },
              { value: 'basic', label: 'Basic' },
              { value: 'custom', label: 'Custom header' },
            ]}
            onChange={(type) => writeKeyConfig({ type }, 'changed how the key is sent')}
          />
          {keyType === 'custom' && <TextInput ariaLabel="Header name" placeholder="Header name, e.g. X-Api-Key" value={readConfigText(auth, ['config', 'header'])} disabled={readOnly} onCommit={(header) => writeKeyConfig({ header }, 'set the key header')} />}
          <Field label="Secret" fieldPath="authorization.config.api_key" error={apiKey && !secretName ? 'Use a saved secret, not a typed key' : null} hint="Keys come from Secrets; the value is never shown or stored in the agent">
            <SecretPicker
              graph={graph}
              value={secretName}
              disabled={readOnly}
              onPick={(name) => {
                if (readOnly) return
                const nextAuth = { ...auth, type: 'api-key', config: { ...readConfigObject(auth, ['config']), type: keyType, api_key: formatReference(['env', name]) } }
                // One undo step: the reference and the env declaration together.
                controller.applyEdit((current) => withSecretDeclared(updateGraphNode(current, node.id, { config: writeConfigValue(node.config, ['authorization'], nextAuth) }), name), `used secret ${name} on ${node.displayTitle}`)
              }}
            />
          </Field>
        </>
      )}
    </div>
  )
}

/** Settings of HTTP request. */
export function HttpRequestPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const config = node.config
  const method = (readConfigText(config, ['method']) || 'get').toLowerCase()
  const maxBytes = readConfigNumber(config, ['max_response_bytes'])
  const setTimeoutPart = (part: string, seconds: number | null) => setConfigValue(['timeout', part], seconds ?? undefined, `set the ${part} time limit`)
  return (
    <>
      <InspectorSection title="Request">
        <div className="flex items-start gap-2">
          <SelectInput ariaLabel="Method" className="w-24 shrink-0" value={method} disabled={readOnly} options={httpMethods.map((name) => ({ value: name, label: name.toUpperCase() }))} onChange={(nextMethod) => setConfigValue(['method'], nextMethod, `set the method to ${nextMethod.toUpperCase()}`)} />
          <div className="min-w-0 flex-1">
            <TemplateField label="URL" fieldPath="url" required placeholder="https://api.example.com/leads" value={readConfigText(config, ['url'])} onCommit={(url) => setConfigValue(['url'], url, 'set the URL')} />
          </div>
        </div>
        <KeyValueEditor label="Query parameters" addLabel="Add a parameter" rows={readKeyValueRows(config.params)} onChange={(rows, what) => setConfigValue(['params'], rows.map((row) => ({ ...row })), what)} />
        <KeyValueEditor label="Headers" addLabel="Add a header" rows={readKeyValueRows(config.headers)} onChange={(rows, what) => setConfigValue(['headers'], rows.map((row) => ({ ...row })), what)} />
        <HttpBodyEditor />
      </InspectorSection>
      <InspectorSection title="Sign-in" sectionKey="sign-in" defaultOpen={readConfigText(config, ['authorization', 'type']) === 'api-key'}>
        <HttpAuthEditor />
      </InspectorSection>
      <InspectorSection title="Time limits" defaultOpen={false}>
        <div className="flex flex-wrap gap-2">
          {['connect', 'read', 'write'].map((part) => (
            <NumberInput key={part} ariaLabel={part[0].toUpperCase() + part.slice(1)} value={readConfigNumber(config, ['timeout', part])} min={0} max={3600} suffix={`s ${part}`} disabled={readOnly} onCommit={(seconds) => setTimeoutPart(part, seconds)} />
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="Advanced" defaultOpen={false}>
        <ToggleRow label="Treat error responses as a failure" description="A 4xx or 5xx status fails the step (then “When this step fails” applies). Off: the step succeeds and you check status_code" checked={readConfigFlag(config, ['fail_on_error_status'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['fail_on_error_status'], checked, checked ? 'failed on error responses' : 'kept going on error responses')} />
        <ToggleRow label="Retry POST and PATCH too" description="Off by default because sending twice can create duplicates" checked={readConfigFlag(config, ['retry_non_idempotent'])} disabled={readOnly} onChange={(checked) => setConfigValue(['retry_non_idempotent'], checked, checked ? 'retried POST and PATCH' : 'stopped retrying POST and PATCH')} />
        <ToggleRow label="Check SSL certificates" description="Turn off only for a server you control" checked={readConfigFlag(config, ['ssl_verify'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['ssl_verify'], checked, checked ? 'checked SSL certificates' : 'stopped checking SSL certificates')} />
        <Field label="Largest response to read" hint="Can only lower the 10 MB limit, never raise it">
          <NumberInput ariaLabel="Largest response" value={maxBytes === null ? null : Number((maxBytes / 1_000_000).toFixed(2))} min={0.01} max={10} step={0.5} suffix="MB" disabled={readOnly} onCommit={(megabytes) => setConfigValue(['max_response_bytes'], megabytes === null ? undefined : Math.round(megabytes * 1_000_000), 'set the largest response')} />
        </Field>
        <Field label="Read JSON">
          <SelectInput
            ariaLabel="Read JSON"
            value={readConfigText(config, ['parse_json']) || 'lenient'}
            disabled={readOnly}
            options={[
              { value: 'lenient', label: 'leniently (default)' },
              { value: 'strict', label: 'strictly' },
            ]}
            onChange={(mode) => setConfigValue(['parse_json'], mode, 'set how JSON is read')}
          />
        </Field>
        <p className={hintClassName}>Private networks are blocked and sign-in headers are removed when a redirect goes to another site</p>
      </InspectorSection>
    </>
  )
}

/** The `provider/name` reference of a `tools` entry (string or `{provider, name}`). */
export function toolReference(entry: JsonValue): string | null {
  if (typeof entry === 'string') return entry
  if (isJsonObject(entry) && typeof entry.provider === 'string' && typeof entry.name === 'string') return `${entry.provider}/${entry.name}`
  return null
}

const sourceTitles: Record<keyof ToolSources, string> = { agents: 'Your agents', plugins: 'Plugins', mcp: 'MCP servers' }
const emptySourceNotes: Record<keyof ToolSources, string> = { agents: 'No other agents yet', plugins: 'No installed plugin has tools', mcp: 'None set up · Connections › Advanced › MCP servers' }

function AgentToolsPicker() {
  const { node, graph, readOnly, updateConfig } = useInspector()
  const sources = useToolSources(graph.agentId)
  const tools = readConfigList(node.config, ['tools'])
  const chosen = tools.map(toolReference).filter((reference): reference is string => reference !== null)
  const approvals = readConfigList(node.config, ['require_approval']).filter((name): name is string => typeof name === 'string')
  const asksFirst = (reference: string) => approvals.includes('*') || approvals.includes(reference) || approvals.includes(reference.split('/')[1] ?? '')
  const toggleTool = (choice: ToolChoice, isOn: boolean) =>
    updateConfig((config) => {
      const nextTools = isOn ? [...tools, choice.reference] : tools.filter((entry) => toolReference(entry) !== choice.reference)
      const nextApprovals = isOn ? approvals : approvals.filter((name) => name !== choice.reference)
      return writeConfigValue(writeConfigValue(config, ['tools'], nextTools), ['require_approval'], nextApprovals.length > 0 ? nextApprovals : undefined)
    }, `${isOn ? 'allowed' : 'removed'} tool ${choice.label}`)
  const toggleApproval = (reference: string, isOn: boolean) => {
    const nextApprovals = isOn ? [...approvals, reference] : approvals.filter((name) => name !== reference && name !== reference.split('/')[1])
    updateConfig((config) => writeConfigValue(config, ['require_approval'], nextApprovals.length > 0 ? nextApprovals : undefined), `${isOn ? 'asked first for' : 'stopped asking for'} ${reference}`)
  }
  const knownReferences = new Set([...sources.agents, ...sources.plugins, ...sources.mcp].map((choice) => choice.reference))
  const otherChosen = chosen.filter((reference) => !knownReferences.has(reference))
  const row = (choice: ToolChoice) => {
    const isOn = chosen.includes(choice.reference)
    return (
      <li key={choice.reference} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
        <input type="checkbox" aria-label={`Use ${choice.reference}`} checked={isOn} disabled={readOnly} onChange={(event) => toggleTool(choice, event.target.checked)} className="accent-ink" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px]">
            <span className="text-muted">{choice.provider} › </span>
            {choice.label}
          </span>
          {choice.note && <span className="truncate text-[11px] text-muted">{choice.note}</span>}
          {describeSchemaInputs(choice.inputSchema) && <span className="truncate text-[11px] text-muted">Inputs: {describeSchemaInputs(choice.inputSchema)}</span>}
        </span>
        <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-2">
          <input type="checkbox" aria-label={`Ask me first before ${choice.reference}`} checked={isOn && asksFirst(choice.reference)} disabled={readOnly || !isOn} onChange={(event) => toggleApproval(choice.reference, event.target.checked)} className="accent-ink" />
          Ask me first
        </label>
      </li>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {(Object.keys(sourceTitles) as Array<keyof ToolSources>).map((sourceKey) => (
        <div key={sourceKey} role="group" aria-label={sourceTitles[sourceKey]} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{sourceTitles[sourceKey]}</span>
          {sources[sourceKey].length === 0 ? <span className={hintClassName}>{sources.isLoading ? 'Loading…' : emptySourceNotes[sourceKey]}</span> : <ul className="m-0 flex list-none flex-col gap-1 p-0">{sources[sourceKey].map(row)}</ul>}
        </div>
      ))}
      {otherChosen.length > 0 && (
        <div role="group" aria-label="Other tools" className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">Named in the agent</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {otherChosen.map((reference) => row({ reference, provider: reference.split('/')[0], name: reference.split('/')[1] ?? '*', label: reference.split('/')[1] ?? reference, source: 'plugins', inputs: [], inputSchema: null, note: null }))}
          </ul>
        </div>
      )}
      {chosen.some((reference) => looksLikeSendingTool(reference) && !asksFirst(reference)) && <p className="m-0 text-[12px] text-amber-strong">Tools that send, post, create, update or delete should ask first</p>}
      {approvals.length > 0 && <p className={hintClassName}>Before a tool marked “Ask me first” runs, the run pauses for your OK.</p>}
    </div>
  )
}

/** Settings of Run an agent. */
export function AgentPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const config = node.config
  return (
    <>
      <InspectorSection title="Model and task">
        <ModelField />
        <TemplateField label="Instructions" multiline value={readConfigText(config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, 'changed the instructions')} />
        <TemplateField label="Task" multiline placeholder="Empty uses the chat message (sys.query)" hint="Empty uses the chat message (sys.query)" value={readConfigText(config, ['query'])} onCommit={(query) => setConfigValue(['query'], query || undefined, 'changed the task')} />
      </InspectorSection>
      <InspectorSection title="Tools it may use" sectionKey="tools">
        <AgentToolsPicker />
      </InspectorSection>
      <InspectorSection title="Limits" defaultOpen={false}>
        <Field label="Tool rounds" hint="Stops with stopped_reason max_iterations">
          <NumberInput ariaLabel="Max rounds" value={readConfigNumber(config, ['max_iterations']) ?? 10} min={1} max={100} step={1} suffix="at most (1 to 100)" disabled={readOnly} onCommit={(rounds) => setConfigValue(['max_iterations'], rounds === null ? undefined : Math.round(rounds), 'set the tool rounds')} />
        </Field>
        <ToggleRow label="Run several tool calls at once" description="When the model asks for more than one in a round" checked={readConfigFlag(config, ['parallel_tool_calls'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['parallel_tool_calls'], checked, checked ? 'ran tool calls together' : 'ran tool calls one by one')} />
        <Field label="Tool calls per round">
          <NumberInput ariaLabel="Per round" value={readConfigNumber(config, ['max_tool_calls_per_turn'])} min={1} step={1} suffix="empty = no limit" disabled={readOnly} onCommit={(count) => setConfigValue(['max_tool_calls_per_turn'], count === null ? undefined : Math.round(count), 'set the tool calls per round')} />
        </Field>
        <Field label="Longest tool result passed back">
          <NumberInput ariaLabel="Characters" wide value={readConfigNumber(config, ['max_tool_output_chars']) ?? 32000} min={1} step={1000} suffix="characters" disabled={readOnly} onCommit={(chars) => setConfigValue(['max_tool_output_chars'], chars === null ? undefined : Math.round(chars), 'set the longest tool result')} />
        </Field>
      </InspectorSection>
    </>
  )
}

/** A tool input typed as template text → graphrt's `tool_parameters` value. */
export function toToolParameter(text: string): JsonObject {
  const single = singleReference(text)
  if (single) return { type: 'variable', value: single }
  if (templateReferences(text).length > 0) return { type: 'mixed', value: text }
  return { type: 'constant', value: text }
}

/**
 * Like {@link toToolParameter}, typed by the tool's schema: fixed text for a number,
 * integer or boolean input is sent as that type (`"5"` → `5`), so the tool gets what its
 * schema asks for. Text with values in it stays text.
 */
export function toSchemaToolParameter(text: string, property: Record<string, unknown> | undefined): JsonObject {
  const parameter = toToolParameter(text)
  if (parameter.type !== 'constant' || !property) return parameter
  const type = Array.isArray(property.type) ? (property.type as unknown[]).find((candidate) => candidate !== 'null') : property.type
  const trimmed = text.trim()
  if ((type === 'number' || type === 'integer') && trimmed !== '' && Number.isFinite(Number(trimmed))) return { type: 'constant', value: Number(trimmed) }
  if (type === 'boolean' && (trimmed === 'true' || trimmed === 'false')) return { type: 'constant', value: trimmed === 'true' }
  return parameter
}

function describeSchemaType(property: Record<string, unknown>): string {
  const type = Array.isArray(property.type) ? (property.type as unknown[]).filter((candidate) => candidate !== 'null').join(' or ') : property.type
  const description = typeof property.description === 'string' ? property.description : ''
  return [typeof type === 'string' && type ? type : 'value', description].filter(Boolean).join(' · ')
}

/** A `tool_parameters` value as template text for the field. */
export function readToolParameter(parameter: JsonValue | undefined): string {
  if (!isJsonObject(parameter)) return typeof parameter === 'string' ? parameter : ''
  const value = parameter.value
  if (parameter.type === 'variable') {
    const path = readSelector(value)
    return path ? formatReference(path) : ''
  }
  if (typeof value === 'string') return value
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

function ToolChoiceList({ sources, current, onPick }: { sources: ToolSources & { isLoading: boolean }; current: string; onPick: (choice: ToolChoice) => void }) {
  const { readOnly } = useInspector()
  return (
    <div className="flex flex-col gap-1.5">
      {(Object.keys(sourceTitles) as Array<keyof ToolSources>).map((sourceKey) => (
        <div key={sourceKey} role="group" aria-label={sourceTitles[sourceKey]} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{sourceKey === 'plugins' ? 'Plugin tools' : sourceTitles[sourceKey]}</span>
          {sources[sourceKey].length === 0 && <span className={hintClassName}>{sources.isLoading ? 'Loading…' : sourceKey === 'mcp' ? 'None set up' : emptySourceNotes[sourceKey]}</span>}
          {sources[sourceKey].map((choice) => (
            <label key={choice.reference} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-[13px]">
              <input type="radio" name="tool-choice" checked={current === choice.reference} disabled={readOnly} onChange={() => onPick(choice)} className="accent-ink" />
              <span className="min-w-0 flex-1 truncate">
                {choice.source !== 'agents' && <span className="text-muted">{choice.provider} › </span>}
                {choice.label}
              </span>
              {choice.note && <span className="shrink-0 text-[11px] text-muted">{choice.note}</span>}
            </label>
          ))}
        </div>
      ))}
      <p className={hintClassName}>Plugin actions are better added as their own steps; tools are for agents and MCP servers</p>
    </div>
  )
}

interface SchemaInput {
  name: string
  property: Record<string, unknown>
  required: boolean
}

/** A tool schema's inputs, required ones first. */
function toolSchemaInputs(schema: Record<string, unknown> | null): SchemaInput[] {
  if (!schema) return []
  const required = schemaRequired(schema)
  const inputs = schemaProperties(schema).map(([name, property]) => ({ name, property, required: required.includes(name) }))
  return [...inputs.filter((input) => input.required), ...inputs.filter((input) => !input.required)]
}

function describeNoInputs(choice: ToolChoice | undefined): string {
  if (!choice) return 'Pick a tool to see its inputs.'
  if (choice.source === 'agents') return 'This agent takes no inputs.'
  if (choice.inputSchema) return 'This tool takes no inputs.'
  return 'The app does not know this tool’s inputs yet (test the MCP server in Connections to read them). Add them by name.'
}

function readToolProvider(config: NodeConfig): { key: string; value: string } {
  for (const key of ['provider_id', 'provider', 'provider_name']) {
    if (typeof config[key] === 'string' && config[key]) return { key, value: config[key] as string }
  }
  return { key: 'provider_id', value: '' }
}

/** What the Inputs section knows about one input: the agent's Start input and/or the tool schema's. */
interface ToolInputInfo {
  name: string
  input: ToolChoice['inputs'][number] | undefined
  schemaInput: SchemaInput | undefined
}

/** The hint under an input: its type and origin, or that the tool does not declare it. */
function describeToolInput({ input, schemaInput }: ToolInputInfo, choice: ToolChoice | undefined): string | undefined {
  if (input) return `${input.valueType} · from the agent's Start`
  if (schemaInput) return describeSchemaType(schemaInput.property)
  return choice?.inputSchema ? 'Not in the tool’s inputs' : undefined
}

function ToolInputRow({ info, choice, parameters }: { info: ToolInputInfo; choice: ToolChoice | undefined; parameters: JsonObject }) {
  const { readOnly, setConfigValue } = useInspector()
  const { name, input, schemaInput } = info
  const required = input?.required ?? schemaInput?.required ?? false
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <TemplateField
          label={input?.label || (schemaInput ? propertyLabel(name, schemaInput.property) : name)}
          ariaLabel={`Input ${name}`}
          fieldPath={`tool_parameters.${name}`}
          required={required}
          hint={describeToolInput(info, choice)}
          value={readToolParameter(parameters[name])}
          onCommit={(text) => setConfigValue(['tool_parameters', name], text === '' && !required ? undefined : toSchemaToolParameter(text, schemaInput?.property), `set input ${name}`)}
        />
      </div>
      {!input && !schemaInput && <RemoveButton label={`Remove input ${name}`} disabled={readOnly} onClick={() => setConfigValue(['tool_parameters', name], undefined, `removed input ${name}`)} />}
    </div>
  )
}

/**
 * The inputs to show: the tool's declared ones (Start inputs of an agent, schema
 * properties of a plugin or MCP tool) first, then any extra ones already in the config.
 */
function listToolInputs(choice: ToolChoice | undefined, parameters: JsonObject): ToolInputInfo[] {
  const schemaInputs = toolSchemaInputs(choice?.inputSchema ?? null)
  const declaredNames = [...(choice?.inputs.map((input) => input.name) ?? []), ...schemaInputs.map((input) => input.name)]
  const inputNames = [...declaredNames, ...Object.keys(parameters).filter((name) => !declaredNames.includes(name))]
  return inputNames.map((name) => ({
    name,
    input: choice?.inputs.find((candidate) => candidate.name === name),
    schemaInput: schemaInputs.find((candidate) => candidate.name === name),
  }))
}

function ToolInputsSection({ choice }: { choice: ToolChoice | undefined }) {
  const { node, readOnly, setConfigValue } = useInspector()
  const parameters = readConfigObject(node.config, ['tool_parameters'])
  const inputs = listToolInputs(choice, parameters)
  const acceptsOtherInputs = choice?.source !== 'agents' && choice?.inputSchema?.additionalProperties !== false
  return (
    <InspectorSection title="Inputs" sectionKey="inputs">
      {inputs.length === 0 && <p className={hintClassName}>{describeNoInputs(choice)}</p>}
      {inputs.map((info) => (
        <ToolInputRow key={info.name} info={info} choice={choice} parameters={parameters} />
      ))}
      {acceptsOtherInputs && (
        <TextInput
          ariaLabel="Add an input"
          placeholder={choice?.inputSchema ? 'Add another input by name' : 'Add an input by name'}
          value=""
          disabled={readOnly}
          onCommit={(name) => name.trim() && setConfigValue(['tool_parameters', name.trim()], { type: 'constant', value: '' }, `added input ${name.trim()}`)}
        />
      )}
      <p className={hintClassName}>Each input can be a value from a step, fixed text, or text with values in it. A value that doesn’t resolve is sent empty</p>
    </InspectorSection>
  )
}

function ToolTimeLimitSection({ providerValue }: { providerValue: string }) {
  const { node, readOnly, updateNode } = useInspector()
  const minutes = node.timeoutMs === null ? null : Number((node.timeoutMs / 60_000).toFixed(2))
  return (
    <InspectorSection title="Time limit" sectionKey="time-limit" defaultOpen={node.timeoutMs !== null}>
      <Field label="Wait for it at most" hint={providerValue === 'agents' ? 'Agents run as tools get 10 minutes' : 'Empty uses the app default, 2 minutes'}>
        <NumberInput ariaLabel="Minutes" value={minutes} min={0.1} max={1440} step={1} suffix="minutes" disabled={readOnly} onCommit={(nextMinutes) => updateNode({ timeoutMs: nextMinutes === null ? null : Math.round(nextMinutes * 60_000) }, nextMinutes === null ? 'cleared the tool time limit' : `set the tool time limit to ${nextMinutes} min`)} />
      </Field>
    </InspectorSection>
  )
}

function ToolErrorSection() {
  const { node, readOnly, setConfigValue } = useInspector()
  return (
    <InspectorSection title="If the tool reports an error">
      <RadioCards
        legend="If the tool reports an error"
        name="ignore-tool-errors"
        value={readConfigFlag(node.config, ['ignore_tool_errors']) ? 'keep-going' : 'fail'}
        disabled={readOnly}
        onChange={(choiceValue) => setConfigValue(['ignore_tool_errors'], choiceValue === 'keep-going' ? true : undefined, choiceValue === 'keep-going' ? 'kept going on tool errors' : 'failed on tool errors')}
        options={[
          { value: 'fail', title: 'The step fails', description: 'Then “When this step fails” applies' },
          { value: 'keep-going', title: 'Keep going', description: 'It succeeds with is_error and error so a later step can check them' },
        ]}
      />
    </InspectorSection>
  )
}

/** Settings of Use a tool: which tool, its inputs, time limit and tool errors. */
export function ToolPanel() {
  const { node, graph, updateConfig } = useInspector()
  const sources = useToolSources(graph.agentId)
  const provider = readToolProvider(node.config)
  const toolName = readConfigText(node.config, ['tool_name'])
  const current = provider.value && toolName ? `${provider.value}/${toolName}` : ''
  const choice = [...sources.agents, ...sources.plugins, ...sources.mcp].find((candidate) => candidate.reference === current)
  const pickTool = (picked: ToolChoice) =>
    updateConfig((config) => {
      const { provider: _provider, provider_name: _providerName, ...rest } = config
      return { ...rest, provider_id: picked.provider, tool_name: picked.name }
    }, `used tool ${picked.label}`)
  return (
    <>
      <InspectorSection title="Tool" sectionKey="tool">
        <ToolChoiceList sources={sources} current={current} onPick={pickTool} />
        {!current && <p className="m-0 text-[12px] text-danger">Pick a tool</p>}
        {current && !choice && !sources.isLoading && <p className="m-0 text-[12px] text-amber-strong">{current} is not on this computer; it fails until it is set up.</p>}
      </InspectorSection>
      <ToolInputsSection choice={choice} />
      <ToolTimeLimitSection providerValue={provider.value} />
      <ToolErrorSection />
      <SupportNote>an agent used as a tool can’t ask for approval (“agents used as steps cannot ask for approval yet”). Use an Ask me before continuing step before it.</SupportNote>
    </>
  )
}
