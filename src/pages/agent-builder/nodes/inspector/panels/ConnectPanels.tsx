import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { updateGraphNode } from '../../graphEdits'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigObject, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, SegmentedChoice, SelectInput, SupportNote, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { ModelField } from '../ModelField'
import { RequestCheckSection } from '../RequestCheckSection'
import { formatReference, readSelector, singleReference, templateReferences } from '../references'
import { propertyLabel, schemaProperties, schemaRequired } from '../SchemaForm'
import { SecretPicker, withSecretDeclared } from '../SecretPicker'
import { SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'
import { describeSchemaInputs, looksLikeSendingTool, useToolSources, type ToolChoice, type ToolSources } from '../toolSources'
import { messages } from '@/i18n'
import { localizedRecord, withLocalizedLabels } from '@/i18n/localized'

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
          <TextInput ariaLabel={messages().nodes.labelValueName(label, index + 1)} placeholder={messages().nodes.name} value={row.key} disabled={readOnly} onCommit={(key) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, key } : item)), messages().nodes.changedLowercase(label.toLowerCase()))} />
          <TextInput ariaLabel={messages().nodes.labelValueValue(label, index + 1)} placeholder={messages().nodes.valueOrStepField} value={row.value} disabled={readOnly} onCommit={(value) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)), messages().nodes.changedLowercase(label.toLowerCase()))} />
          <RemoveButton label={messages().nodes.removeLowercaseValue(label.toLowerCase(), index + 1)} disabled={readOnly} onClick={() => onChange(rows.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedFromLowercase(label.toLowerCase()))} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...rows, { key: '', value: '' }], messages().nodes.addedToLowercase(label.toLowerCase()))}>
        {addLabel}
      </AddButton>
    </div>
  )
}

const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head']
const bodyTypes = withLocalizedLabels(
  ['none', 'json', 'raw-text', 'form-data', 'x-www-form-urlencoded', 'binary'].map((value) => ({ value })),
  (option) => messages().nodes.bodyTypes[option.value] ?? option.value,
)

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
      <Field label={messages().nodes.body}>
        <SelectInput ariaLabel={messages().nodes.bodyType} value={bodyType} disabled={readOnly} options={bodyTypes} onChange={changeType} />
      </Field>
      {(bodyType === 'json' || bodyType === 'raw-text') && (
        <TemplateField label={bodyType === 'json' ? messages().nodes.jsonBody : messages().nodes.textBody} multiline value={typeof data === 'string' ? data : data === undefined ? '' : JSON.stringify(data)} onCommit={(text) => setBody({ type: bodyType, data: text }, messages().nodes.changedTheBody)} />
      )}
      {(bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') && (
        <KeyValueEditor label={messages().nodes.formFields} rows={formRows} addLabel={messages().nodes.addAField} onChange={(rows, what) => setBody({ type: bodyType, data: rows.map((row) => ({ key: row.key, type: 'text', value: row.value })) }, what)} />
      )}
      {bodyType === 'binary' && (
        <SelectorField
          label={messages().nodes.fileToSend}
          required
          path={Array.isArray(data) && isJsonObject(data[0]) ? readSelector(data[0].file) : null}
          onChange={(path) => setBody({ type: 'binary', data: path ? [{ key: '', type: 'file', file: path }] : [] }, messages().nodes.setTheFileToSend)}
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
        label={messages().nodes.signIn}
        value={usesKey ? 'api-key' : 'no-auth'}
        disabled={readOnly}
        options={[
          { value: 'no-auth', label: messages().nodes.noSignIn },
          { value: 'api-key', label: messages().nodes.apiKey },
        ]}
        onChange={(type) => writeAuth(type === 'no-auth' ? { type } : { ...auth, type, config: { type: keyType, ...readConfigObject(auth, ['config']) } }, type === 'no-auth' ? messages().nodes.removedTheSignIn : messages().nodes.signedInWithAnApiKey)}
      />
      {usesKey && (
        <>
          <SelectInput
            ariaLabel={messages().nodes.howTheKeyIsSent}
            value={keyType}
            disabled={readOnly}
            options={[
              { value: 'bearer', label: messages().nodes.bearer },
              { value: 'basic', label: messages().nodes.basic },
              { value: 'custom', label: messages().nodes.customHeader },
            ]}
            onChange={(type) => writeKeyConfig({ type }, messages().nodes.changedHowTheKeyIsSent)}
          />
          {keyType === 'custom' && <TextInput ariaLabel={messages().nodes.headerName} placeholder={messages().nodes.headerNameEGXApi} value={readConfigText(auth, ['config', 'header'])} disabled={readOnly} onCommit={(header) => writeKeyConfig({ header }, messages().nodes.setTheKeyHeader)} />}
          <Field label={messages().nodes.secret} fieldPath="authorization.config.api_key" error={apiKey && !secretName ? messages().nodes.useASavedSecretNotA : null} hint={messages().nodes.keysComeFromSecretsTheValue}>
            <SecretPicker
              graph={graph}
              value={secretName}
              disabled={readOnly}
              onPick={(name) => {
                if (readOnly) return
                const nextAuth = { ...auth, type: 'api-key', config: { ...readConfigObject(auth, ['config']), type: keyType, api_key: formatReference(['env', name]) } }
                // One undo step: the reference and the env declaration together.
                controller.applyEdit((current) => withSecretDeclared(updateGraphNode(current, node.id, { config: writeConfigValue(node.config, ['authorization'], nextAuth) }), name), messages().nodes.usedSecretNameOnDisplaytitle(name, node.displayTitle))
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
  const setTimeoutPart = (part: string, seconds: number | null) => setConfigValue(['timeout', part], seconds ?? undefined, messages().nodes.setThePartTimeLimit(part))
  return (
    <>
      <InspectorSection title={messages().nodes.request}>
        <div className="flex items-start gap-2">
          <SelectInput ariaLabel={messages().nodes.method} className="w-24 shrink-0" value={method} disabled={readOnly} options={httpMethods.map((name) => ({ value: name, label: name.toUpperCase() }))} onChange={(nextMethod) => setConfigValue(['method'], nextMethod, messages().nodes.setTheMethodToUppercase(nextMethod.toUpperCase()))} />
          <div className="min-w-0 flex-1">
            <TemplateField label={messages().nodes.url} fieldPath="url" required placeholder={messages().nodes.httpsApiExampleComLeads} value={readConfigText(config, ['url'])} onCommit={(url) => setConfigValue(['url'], url, messages().nodes.setTheUrl)} />
          </div>
        </div>
        <KeyValueEditor label={messages().nodes.queryParameters} addLabel={messages().nodes.addAParameter} rows={readKeyValueRows(config.params)} onChange={(rows, what) => setConfigValue(['params'], rows.map((row) => ({ ...row })), what)} />
        <KeyValueEditor label={messages().nodes.headers} addLabel={messages().nodes.addAHeader} rows={readKeyValueRows(config.headers)} onChange={(rows, what) => setConfigValue(['headers'], rows.map((row) => ({ ...row })), what)} />
        <HttpBodyEditor />
      </InspectorSection>
      <RequestCheckSection />
      <InspectorSection title={messages().nodes.signIn} sectionKey="sign-in" defaultOpen={readConfigText(config, ['authorization', 'type']) === 'api-key'}>
        <HttpAuthEditor />
      </InspectorSection>
      <InspectorSection title={messages().nodes.timeLimits} defaultOpen={false}>
        <div className="flex flex-wrap gap-2">
          {['connect', 'read', 'write'].map((part) => (
            <NumberInput key={part} ariaLabel={part[0].toUpperCase() + part.slice(1)} value={readConfigNumber(config, ['timeout', part])} min={0} max={3600} suffix={`s ${part}`} disabled={readOnly} onCommit={(seconds) => setTimeoutPart(part, seconds)} />
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title={messages().nodes.advanced} defaultOpen={false}>
        <ToggleRow label={messages().nodes.treatErrorResponsesAsAFailure} description={messages().nodes.a4xxOr5xxStatusFails} checked={readConfigFlag(config, ['fail_on_error_status'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['fail_on_error_status'], checked, checked ? messages().nodes.failedOnErrorResponses : messages().nodes.keptGoingOnErrorResponses)} />
        <ToggleRow label={messages().nodes.retryPostAndPatchToo} description={messages().nodes.offByDefaultBecauseSendingTwice} checked={readConfigFlag(config, ['retry_non_idempotent'])} disabled={readOnly} onChange={(checked) => setConfigValue(['retry_non_idempotent'], checked, checked ? messages().nodes.retriedPostAndPatch : messages().nodes.stoppedRetryingPostAndPatch)} />
        <ToggleRow label={messages().nodes.checkSslCertificates} description={messages().nodes.turnOffOnlyForAServer} checked={readConfigFlag(config, ['ssl_verify'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['ssl_verify'], checked, checked ? messages().nodes.checkedSslCertificates : messages().nodes.stoppedCheckingSslCertificates)} />
        <Field label={messages().nodes.largestResponseToRead} hint={messages().nodes.canOnlyLowerThe10Mb}>
          <NumberInput ariaLabel={messages().nodes.largestResponse} value={maxBytes === null ? null : Number((maxBytes / 1_000_000).toFixed(2))} min={0.01} max={10} step={0.5} suffix="MB" disabled={readOnly} onCommit={(megabytes) => setConfigValue(['max_response_bytes'], megabytes === null ? undefined : Math.round(megabytes * 1_000_000), messages().nodes.setTheLargestResponse)} />
        </Field>
        <Field label={messages().nodes.readJson}>
          <SelectInput
            ariaLabel={messages().nodes.readJson}
            value={readConfigText(config, ['parse_json']) || 'lenient'}
            disabled={readOnly}
            options={[
              { value: 'lenient', label: messages().nodes.lenientlyDefault },
              { value: 'strict', label: 'strictly' },
            ]}
            onChange={(mode) => setConfigValue(['parse_json'], mode, messages().nodes.setHowJsonIsRead)}
          />
        </Field>
        <p className={hintClassName}>{messages().nodes.privateNetworksAreBlockedAndSign}</p>
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

const sourceTitles: Readonly<Record<keyof ToolSources, string>> = localizedRecord(() => messages().nodes.toolSourceTitles)
const emptySourceNotes: Readonly<Record<keyof ToolSources, string>> = localizedRecord(() => messages().nodes.toolSourceEmpty)

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
    }, messages().nodes.toolToggled(isOn, choice.label))
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
        <input type="checkbox" aria-label={messages().nodes.useReference(choice.reference)} checked={isOn} disabled={readOnly} onChange={(event) => toggleTool(choice, event.target.checked)} className="accent-ink" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px]">
            <span className="text-muted">{choice.provider} › </span>
            {choice.label}
          </span>
          {choice.note && <span className="truncate text-[11px] text-muted">{choice.note}</span>}
          {describeSchemaInputs(choice.inputSchema) && <span className="truncate text-[11px] text-muted">{messages().nodes.inputs2}{' '}{describeSchemaInputs(choice.inputSchema)}</span>}
        </span>
        <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-2">
          <input type="checkbox" aria-label={messages().nodes.askMeFirstBeforeReference(choice.reference)} checked={isOn && asksFirst(choice.reference)} disabled={readOnly || !isOn} onChange={(event) => toggleApproval(choice.reference, event.target.checked)} className="accent-ink" />
          {messages().nodes.askMeFirst}
        </label>
      </li>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {(Object.keys(sourceTitles) as Array<keyof ToolSources>).map((sourceKey) => (
        <div key={sourceKey} role="group" aria-label={sourceTitles[sourceKey]} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{sourceTitles[sourceKey]}</span>
          {sources[sourceKey].length === 0 ? <span className={hintClassName}>{sources.isLoading ? messages().nodes.loading : emptySourceNotes[sourceKey]}</span> : <ul className="m-0 flex list-none flex-col gap-1 p-0">{sources[sourceKey].map(row)}</ul>}
        </div>
      ))}
      {otherChosen.length > 0 && (
        <div role="group" aria-label={messages().nodes.otherTools} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{messages().nodes.namedInTheAgent}</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {otherChosen.map((reference) => row({ reference, provider: reference.split('/')[0], name: reference.split('/')[1] ?? '*', label: reference.split('/')[1] ?? reference, source: 'plugins', inputs: [], inputSchema: null, note: null }))}
          </ul>
        </div>
      )}
      {chosen.some((reference) => looksLikeSendingTool(reference) && !asksFirst(reference)) && <p className="m-0 text-[12px] text-amber-strong">{messages().nodes.toolsThatSendPostCreateUpdate}</p>}
      {approvals.length > 0 && <p className={hintClassName}>{messages().nodes.beforeAToolMarkedAskMe}</p>}
    </div>
  )
}

/** Settings of Run an agent. */
export function AgentPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const config = node.config
  return (
    <>
      <InspectorSection title={messages().nodes.modelAndTask}>
        <ModelField />
        <TemplateField label={messages().nodes.instructions} multiline value={readConfigText(config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, messages().nodes.changedTheInstructions)} />
        <TemplateField label={messages().nodes.task} multiline placeholder={messages().nodes.emptyUsesTheChatMessageSys} hint={messages().nodes.emptyUsesTheChatMessageSys} value={readConfigText(config, ['query'])} onCommit={(query) => setConfigValue(['query'], query || undefined, messages().nodes.changedTheTask)} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.toolsItMayUse} sectionKey="tools">
        <AgentToolsPicker />
      </InspectorSection>
      <InspectorSection title={messages().nodes.limits} defaultOpen={false}>
        <Field label={messages().nodes.toolRounds} hint={messages().nodes.stopsWithStoppedReasonMaxIterations}>
          <NumberInput ariaLabel={messages().nodes.maxRounds} value={readConfigNumber(config, ['max_iterations']) ?? 10} min={1} max={100} step={1} suffix={messages().nodes.atMost1To100} disabled={readOnly} onCommit={(rounds) => setConfigValue(['max_iterations'], rounds === null ? undefined : Math.round(rounds), messages().nodes.setTheToolRounds)} />
        </Field>
        <ToggleRow label={messages().nodes.runSeveralToolCallsAtOnce} description={messages().nodes.whenTheModelAsksForMore} checked={readConfigFlag(config, ['parallel_tool_calls'], true)} disabled={readOnly} onChange={(checked) => setConfigValue(['parallel_tool_calls'], checked, checked ? messages().nodes.ranToolCallsTogether : messages().nodes.ranToolCallsOneByOne)} />
        <Field label={messages().nodes.toolCallsPerRound}>
          <NumberInput ariaLabel={messages().nodes.perRound} value={readConfigNumber(config, ['max_tool_calls_per_turn'])} min={1} step={1} suffix={messages().nodes.emptyNoLimit} disabled={readOnly} onCommit={(count) => setConfigValue(['max_tool_calls_per_turn'], count === null ? undefined : Math.round(count), messages().nodes.setTheToolCallsPerRound)} />
        </Field>
        <Field label={messages().nodes.longestToolResultPassedBack}>
          <NumberInput ariaLabel={messages().nodes.characters} wide value={readConfigNumber(config, ['max_tool_output_chars']) ?? 32000} min={1} step={1000} suffix="characters" disabled={readOnly} onCommit={(chars) => setConfigValue(['max_tool_output_chars'], chars === null ? undefined : Math.round(chars), messages().nodes.setTheLongestToolResult)} />
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
          <span className="text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{sourceKey === 'plugins' ? messages().nodes.pluginTools : sourceTitles[sourceKey]}</span>
          {sources[sourceKey].length === 0 && <span className={hintClassName}>{sources.isLoading ? messages().nodes.loading : sourceKey === 'mcp' ? messages().nodes.noneSetUp : emptySourceNotes[sourceKey]}</span>}
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
      <p className={hintClassName}>{messages().nodes.pluginActionsAreBetterAddedAs}</p>
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
  if (!choice) return messages().nodes.pickAToolToSeeIts
  if (choice.source === 'agents') return messages().nodes.thisAgentTakesNoInputs
  if (choice.inputSchema) return messages().nodes.thisToolTakesNoInputs
  return messages().nodes.theAppDoesNotKnowThis
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
  if (input) return messages().nodes.valuetypeFromTheAgentsStart(input.valueType)
  if (schemaInput) return describeSchemaType(schemaInput.property)
  return choice?.inputSchema ? messages().nodes.notInTheToolsInputs : undefined
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
          ariaLabel={messages().nodes.inputName(name)}
          fieldPath={`tool_parameters.${name}`}
          required={required}
          hint={describeToolInput(info, choice)}
          value={readToolParameter(parameters[name])}
          onCommit={(text) => setConfigValue(['tool_parameters', name], text === '' && !required ? undefined : toSchemaToolParameter(text, schemaInput?.property), messages().nodes.setInputName(name))}
        />
      </div>
      {!input && !schemaInput && <RemoveButton label={messages().nodes.removeInputName(name)} disabled={readOnly} onClick={() => setConfigValue(['tool_parameters', name], undefined, messages().nodes.removedInputName(name))} />}
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
    <InspectorSection title={messages().nodes.inputs} sectionKey="inputs">
      {inputs.length === 0 && <p className={hintClassName}>{describeNoInputs(choice)}</p>}
      {inputs.map((info) => (
        <ToolInputRow key={info.name} info={info} choice={choice} parameters={parameters} />
      ))}
      {acceptsOtherInputs && (
        <TextInput
          ariaLabel={messages().nodes.addAnInput}
          placeholder={choice?.inputSchema ? messages().nodes.addAnotherInputByName : messages().nodes.addAnInputByName}
          value=""
          disabled={readOnly}
          onCommit={(name) => name.trim() && setConfigValue(['tool_parameters', name.trim()], { type: 'constant', value: '' }, messages().nodes.addedInputValue(name.trim()))}
        />
      )}
      <p className={hintClassName}>{messages().nodes.eachInputCanBeAValue}</p>
    </InspectorSection>
  )
}

function ToolTimeLimitSection({ providerValue }: { providerValue: string }) {
  const { node, readOnly, updateNode } = useInspector()
  const minutes = node.timeoutMs === null ? null : Number((node.timeoutMs / 60_000).toFixed(2))
  return (
    <InspectorSection title={messages().nodes.timeLimit} sectionKey="time-limit" defaultOpen={node.timeoutMs !== null}>
      <Field label={messages().nodes.waitForItAtMost} hint={providerValue === 'agents' ? messages().nodes.agentsRunAsToolsGet10 : messages().nodes.emptyUsesTheAppDefault2}>
        <NumberInput ariaLabel={messages().nodes.minutes} value={minutes} min={0.1} max={1440} step={1} suffix="minutes" disabled={readOnly} onCommit={(nextMinutes) => updateNode({ timeoutMs: nextMinutes === null ? null : Math.round(nextMinutes * 60_000) }, nextMinutes === null ? messages().nodes.clearedTheToolTimeLimit : messages().nodes.setTheToolTimeLimitTo(nextMinutes))} />
      </Field>
    </InspectorSection>
  )
}

function ToolErrorSection() {
  const { node, readOnly, setConfigValue } = useInspector()
  return (
    <InspectorSection title={messages().nodes.ifTheToolReportsAnError}>
      <RadioCards
        legend={messages().nodes.ifTheToolReportsAnError}
        name="ignore-tool-errors"
        value={readConfigFlag(node.config, ['ignore_tool_errors']) ? 'keep-going' : 'fail'}
        disabled={readOnly}
        onChange={(choiceValue) => setConfigValue(['ignore_tool_errors'], choiceValue === 'keep-going' ? true : undefined, choiceValue === 'keep-going' ? messages().nodes.keptGoingOnToolErrors : messages().nodes.failedOnToolErrors)}
        options={[
          { value: 'fail', title: messages().nodes.theStepFails, description: messages().nodes.thenWhenThisStepFailsApplies },
          { value: 'keep-going', title: messages().nodes.keepGoing, description: messages().nodes.itSucceedsWithIsErrorAnd },
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
    }, messages().nodes.usedToolLabel(picked.label))
  return (
    <>
      <InspectorSection title={messages().nodes.tool} sectionKey="tool">
        <ToolChoiceList sources={sources} current={current} onPick={pickTool} />
        {!current && <p className="m-0 text-[12px] text-danger">{messages().nodes.pickATool}</p>}
        {current && !choice && !sources.isLoading && <p className="m-0 text-[12px] text-amber-strong">{current} {messages().nodes.isNotOnThisComputerIt}</p>}
      </InspectorSection>
      <ToolInputsSection choice={choice} />
      <ToolTimeLimitSection providerValue={provider.value} />
      <ToolErrorSection />
      <SupportNote>{messages().nodes.anAgentUsedAsATool}</SupportNote>
    </>
  )
}
