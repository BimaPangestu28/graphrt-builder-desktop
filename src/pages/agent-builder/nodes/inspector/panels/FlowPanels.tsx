import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { listBodyValues } from '../availableValues'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigText, writeConfigValue, type JsonObject } from '../configPaths'
import { ConditionsEditor, MatchChoice } from '../ConditionsEditor'
import { slugifyBranchId, uniqueBranchId } from '../branchEdits'
import { ExitRemoveButton } from '../ExitRemoveButton'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, SelectInput, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { readSelector } from '../references'
import { SelectorChip, SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'

/**
 * Check a condition (`if-else`, B5), For each item (`iteration`, B4), Repeat (`loop`,
 * B12) and Ask me before continuing (`human-input`, B17): the steps whose settings
 * change ports or a loop body.
 */

/** if-else cases; a legacy single-case config (top-level `conditions`) reads as case `true`. */
export function readIfElseCases(config: NodeConfig): JsonObject[] {
  const cases = readConfigList(config, ['cases']).filter(isJsonObject)
  if (cases.length > 0 || !Array.isArray(config.conditions)) return cases
  return [{ case_id: 'true', logical_operator: readConfigText(config, ['logical_operator']) || 'and', conditions: config.conditions }]
}

/** The config with `cases` written (legacy top-level conditions dropped). */
export function writeIfElseCases(config: NodeConfig, cases: JsonObject[]): NodeConfig {
  const { conditions: _legacyConditions, logical_operator: _legacyOperator, ...rest } = config
  return { ...rest, cases }
}

/** Settings of Check a condition: one port per case plus Else. */
export function IfElsePanel() {
  const { node, readOnly, updateConfig } = useInspector()
  const cases = readIfElseCases(node.config)
  const writeCases = (next: JsonObject[], what: string) => updateConfig((config) => writeIfElseCases(config, next), what)
  const updateCase = (index: number, changes: JsonObject, what: string) => writeCases(cases.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item)), what)
  return (
    <>
      <InspectorSection title="Paths">
        {cases.map((item, index) => {
          const caseId = readConfigText(item, ['case_id'])
          const isAny = readConfigText(item, ['logical_operator']) === 'or'
          return (
            <div key={caseId || index} className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">Case {index + 1}</span>
                <ExitRemoveButton handleId={caseId} itemName={`Case ${index + 1}`} nextConfig={writeIfElseCases(node.config, cases.filter((_unused, itemIndex) => itemIndex !== index))} />
              </div>
              <span className={hintClassName}>Takes this path when {isAny ? 'any' : 'all'} of these hold</span>
              <ConditionsEditor label={`Case ${index + 1} conditions`} subject="selector" conditions={readConfigList(item, ['conditions'])} onChange={(conditions, what) => updateCase(index, { conditions }, what)} />
              <MatchChoice value={readConfigText(item, ['logical_operator'])} onChange={(operator) => updateCase(index, { logical_operator: operator }, 'set the case match')} />
            </div>
          )
        })}
        <AddButton disabled={readOnly} onClick={() => writeCases([...cases, { case_id: uniqueBranchId(cases.map((item) => readConfigText(item, ['case_id'])), 'case'), logical_operator: 'and', conditions: [] }], 'added a case')}>
          Add a case
        </AddButton>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-dashed border-line-heavy px-2.5 py-2">
          <span className="text-[13px] font-semibold">Else</span>
          <span className={hintClassName}>Always there. Taken when no case matches</span>
        </div>
        <p className={hintClassName}>Cases are checked from the top; the first that matches wins. Drag from a path’s port to connect it</p>
      </InspectorSection>
    </>
  )
}

/** True when a container's body holds an approval step (then items must run one at a time). */
function bodyHasApproval(nodes: Array<{ parent: string | null; kind: string; id: string }>, containerId: string): boolean {
  const childIds = new Set([containerId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parent && childIds.has(node.parent) && !childIds.has(node.id)) {
        childIds.add(node.id)
        grew = true
      }
    }
  }
  return nodes.some((node) => node.kind === 'human-input' && node.id !== containerId && childIds.has(node.id))
}

/** Settings of For each item. */
export function IterationPanel() {
  const { node, graph, readOnly, setConfigValue, updateConfig, valueGroups, kindsByKind } = useInspector()
  const bodyGroups = listBodyValues(graph, node.id, kindsByKind)
  const config = node.config
  const isParallel = readConfigFlag(config, ['is_parallel'])
  const mustRunInOrder = bodyHasApproval(graph.nodes, node.id)
  const errorMode = readConfigText(config, ['error_handle_mode']) || 'terminated'
  const itemsPath = readSelector(config.iterator_selector)
  const itemsSource = itemsPath ? valueGroups.flatMap((group) => group.options).find((option) => option.path.join('.') === itemsPath.join('.')) : undefined
  return (
    <>
      <InspectorSection title="Items">
        <SelectorField label="Run the steps inside once for each item in" required path={itemsPath} onChange={(path) => setConfigValue(['iterator_selector'], path ?? undefined, 'set the items')} hint={`Must be a list${itemsSource ? ` · ${itemsSource.typeHint}` : ''}`} />
        <Field label="Collect from each item" hint="Becomes the loop’s output list, in the same order as the items">
          <SelectorChip ariaLabel="Collect from each item" groups={bodyGroups} path={readSelector(config.output_selector)} emptyLabel="Pick a value from the steps inside" onChange={(path) => setConfigValue(['output_selector'], path ?? undefined, 'set what to collect')} />
        </Field>
      </InspectorSection>
      <InspectorSection title="Speed">
        <RadioCards
          legend="How items run"
          name="parallel"
          value={isParallel && !mustRunInOrder ? 'parallel' : 'sequential'}
          disabled={readOnly}
          onChange={(choice) => updateConfig((current) => writeConfigValue(current, ['is_parallel'], choice === 'parallel'), choice === 'parallel' ? 'ran items several at once' : 'ran items one at a time')}
          options={[
            { value: 'sequential', title: 'One at a time', description: mustRunInOrder ? 'Required here: this loop asks you before continuing' : undefined },
            { value: 'parallel', title: 'Several at once', description: 'Up to the number below run together; the output keeps the item order', disabled: mustRunInOrder },
          ]}
        />
        {isParallel && !mustRunInOrder && (
          <Field label="At most at once">
            <NumberInput ariaLabel="At most at once" value={readConfigNumber(config, ['parallel_nums']) ?? 10} min={1} max={100} step={1} suffix="at once (1 to 100)" disabled={readOnly} onCommit={(count) => setConfigValue(['parallel_nums'], count === null ? undefined : Math.round(count), 'set how many run at once')} />
          </Field>
        )}
      </InspectorSection>
      <InspectorSection title="If one item fails">
        <RadioCards
          legend="If one item fails"
          name="error-handle-mode"
          value={errorMode}
          disabled={readOnly}
          onChange={(mode) => setConfigValue(['error_handle_mode'], mode, 'set “If one item fails”')}
          options={[
            { value: 'terminated', title: 'Stop the loop', description: 'Default. Items still running are cancelled and the loop fails' },
            { value: 'continue-on-error', title: 'Skip it and continue', description: 'Its place in the output stays empty; the failure is listed in errors' },
            { value: 'remove-abnormal-output', title: 'Drop its result', description: 'It leaves no entry in the output' },
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Output" defaultOpen={false}>
        <ToggleRow label="Flatten lists" description="When each item returns a list, join them into one list" checked={readConfigFlag(config, ['flatten_output'], true)} disabled={readOnly} onChange={(flatten) => setConfigValue(['flatten_output'], flatten, flatten ? 'turned on Flatten lists' : 'turned off Flatten lists')} />
      </InspectorSection>
      <InspectorSection title="Available inside the loop" defaultOpen={false}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
          <li className="flex justify-between gap-2">
            <span className="font-mono">item</span>
            <span className="text-muted">{itemsSource?.typeHint.startsWith('list of ') ? itemsSource.typeHint.slice(8).replace(/s$/, '') : 'one item of the list'}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="font-mono">index</span>
            <span className="text-muted">number · 0 for the first item</span>
          </li>
        </ul>
        <p className={hintClassName}>After the loop: output (list) and errors (list of index and error)</p>
      </InspectorSection>
    </>
  )
}

const loopVariableTypes = [
  { value: 'string', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'yes/no' },
  { value: 'object', label: 'object' },
  { value: 'array[any]', label: 'list' },
]

function LoopVariablesEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const variables = readConfigList(node.config, ['loop_variables']).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(['loop_variables'], next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(variables.map((variable, itemIndex) => (itemIndex === index ? { ...variable, ...changes } : variable)), what)
  return (
    <div className="flex flex-col gap-2">
      {variables.map((variable, index) => {
        const fromStep = readConfigText(variable, ['value_type']) === 'variable'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-1.5">
              <TextInput ariaLabel={`Value ${index + 1} name`} monospace value={readConfigText(variable, ['label'])} disabled={readOnly} onCommit={(label) => update(index, { label: label.trim() }, 'renamed a loop value')} />
              <SelectInput ariaLabel={`Value ${index + 1} type`} value={readConfigText(variable, ['var_type']) || 'string'} disabled={readOnly} options={loopVariableTypes} onChange={(varType) => update(index, { var_type: varType }, 'changed a loop value type')} />
              <RemoveButton label={`Remove value ${index + 1}`} disabled={readOnly} onClick={() => write(variables.filter((_unused, itemIndex) => itemIndex !== index), 'removed a loop value')} />
            </div>
            <div className="flex items-center gap-1.5">
              <SelectInput
                ariaLabel={`Value ${index + 1} starts as`}
                className="w-32 shrink-0"
                value={fromStep ? 'variable' : 'constant'}
                disabled={readOnly}
                options={[
                  { value: 'constant', label: 'a fixed value' },
                  { value: 'variable', label: 'from a step' },
                ]}
                onChange={(valueType) => update(index, { value_type: valueType, value: valueType === 'variable' ? [] : '' }, 'changed how a loop value starts')}
              />
              <div className="min-w-0 flex-1">
                {fromStep ? (
                  <SelectorChip compact ariaLabel={`Value ${index + 1} start`} path={readSelector(variable.value)} onChange={(path) => update(index, { value: path ?? [] }, 'set a loop value start')} />
                ) : (
                  <TextInput ariaLabel={`Value ${index + 1} start`} placeholder="Starts as" value={typeof variable.value === 'string' ? variable.value : variable.value === undefined ? '' : JSON.stringify(variable.value)} disabled={readOnly} onCommit={(value) => update(index, { value }, 'set a loop value start')} />
                )}
              </div>
            </div>
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...variables, { label: `value_${variables.length + 1}`, var_type: 'string', value_type: 'constant', value: '' }], 'added a loop value')}>
        Add a value
      </AddButton>
      <p className={hintClassName}>Change them inside with Remember a value. Each round sees the last value</p>
    </div>
  )
}

/** Settings of Repeat. */
export function LoopPanel() {
  const { node, graph, readOnly, setConfigValue, updateConfig } = useInspector()
  const hasStopStep = graph.nodes.some((candidate) => candidate.parent === node.id && candidate.kind === 'loop-end')
  return (
    <>
      <InspectorSection title="Rounds">
        <Field label="Repeat at most" hint="The body runs again until a stop condition holds, Stop repeating runs, or this many rounds are done">
          <NumberInput ariaLabel="Rounds" value={readConfigNumber(node.config, ['loop_count']) ?? 1} min={1} max={10000} step={1} suffix="rounds (1 to 10,000)" disabled={readOnly} onCommit={(count) => setConfigValue(['loop_count'], Math.round(count ?? 1), `set Repeat at most ${Math.round(count ?? 1)} rounds`)} />
        </Field>
      </InspectorSection>
      <InspectorSection title="Stop when">
        <ConditionsEditor label="Stop conditions" subject="selector" conditions={readConfigList(node.config, ['break_conditions'])} onChange={(conditions, what) => updateConfig((config) => writeConfigValue(config, ['break_conditions'], conditions), what)} />
        <MatchChoice value={readConfigText(node.config, ['logical_operator'])} onChange={(operator) => setConfigValue(['logical_operator'], operator, 'set the stop match')} />
        <p className={hintClassName}>{hasStopStep ? 'A Stop repeating step inside also ends it after its round.' : 'Add a Stop repeating step inside to end it from a branch.'}</p>
      </InspectorSection>
      <InspectorSection title="Values kept between rounds">
        <LoopVariablesEditor />
      </InspectorSection>
    </>
  )
}

const fieldTypes = [
  { value: 'paragraph', label: 'paragraph' },
  { value: 'text', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'select', label: 'select' },
  { value: 'checkbox', label: 'checkbox' },
]

/** Where the approval's fields live: `form.fields`, or the older `inputs`. */
function fieldsPath(config: NodeConfig): string[] {
  return readConfigList(config, ['form', 'fields']).length === 0 && readConfigList(config, ['inputs']).length > 0 ? ['inputs'] : ['form', 'fields']
}

function ApprovalFieldsEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const path = fieldsPath(node.config)
  const fields = readConfigList(node.config, path).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(path, next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(fields.map((field, itemIndex) => (itemIndex === index ? { ...field, ...changes } : field)), what)
  return (
    <div className="flex flex-col gap-2">
      {fields.map((field, index) => {
        const nameKey = typeof field.name === 'string' || field.variable === undefined ? 'name' : 'variable'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_96px_auto_24px] items-center gap-1.5">
              <TextInput ariaLabel={`Field ${index + 1} name`} monospace value={readConfigText(field, [nameKey])} disabled={readOnly} onCommit={(name) => update(index, { [nameKey]: name.trim() }, 'renamed an approval field')} />
              <SelectInput ariaLabel={`Field ${index + 1} type`} value={readConfigText(field, ['type']) || 'text'} disabled={readOnly} options={fieldTypes} onChange={(type) => update(index, { type }, 'changed an approval field type')} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2">
                <input type="checkbox" aria-label={`Field ${index + 1} must be filled`} checked={field.required === true} disabled={readOnly} onChange={(event) => update(index, { required: event.target.checked }, 'changed a required field')} className="accent-ink" />
                Must
              </label>
              <RemoveButton label={`Remove field ${index + 1}`} disabled={readOnly} onClick={() => write(fields.filter((_unused, itemIndex) => itemIndex !== index), 'removed an approval field')} />
            </div>
            <TextInput ariaLabel={`Field ${index + 1} label`} placeholder="Label" value={readConfigText(field, ['label'])} disabled={readOnly} onCommit={(label) => update(index, { label }, 'labelled an approval field')} />
            <TextInput ariaLabel={`Field ${index + 1} starts with`} placeholder="Starts with, e.g. {{#write_message.text#}}" value={readConfigText(field, ['default'])} disabled={readOnly} onCommit={(value) => update(index, { default: value }, 'set an approval field default')} />
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...fields, { name: `field_${fields.length + 1}`, label: '', type: 'paragraph', required: false }], 'added an approval field')}>
        Add a field
      </AddButton>
      <p className={hintClassName}>Each field becomes an output of this step</p>
    </div>
  )
}

const millisecondsPerHour = 3_600_000

/** `on_timeout` as a select value: `stop` or `action:<id>`. */
export function readOnTimeout(config: NodeConfig): string {
  const onTimeout = config.on_timeout
  if (isJsonObject(onTimeout) && typeof onTimeout.action === 'string') return `action:${onTimeout.action}`
  return 'stop'
}

function toOnTimeout(choice: string): JsonValue {
  return choice.startsWith('action:') ? { action: choice.slice(7) } : 'stop'
}

/** Settings of Ask me before continuing: question, fields, buttons (ports) and time limit. */
export function HumanInputPanel() {
  const { node, readOnly, setConfigValue, updateNode } = useInspector()
  const promptKey = node.config.prompt === undefined && typeof node.config.content === 'string' ? 'content' : 'prompt'
  const actions = readConfigList(node.config, ['actions']).filter(isJsonObject)
  const writeActions = (next: JsonObject[], what: string) => setConfigValue(['actions'], next, what)
  const hours = node.timeoutMs === null ? null : Number((node.timeoutMs / millisecondsPerHour).toFixed(2))
  const timeoutChoice = readOnTimeout(node.config)
  return (
    <>
      <InspectorSection title="Question">
        <TemplateField label="Question" required multiline value={readConfigText(node.config, [promptKey])} onCommit={(prompt) => setConfigValue([promptKey], prompt, 'changed the question')} hint="First line is the title of the approval card; the rest shows under it" />
      </InspectorSection>
      <InspectorSection title="Fields you can check or edit" defaultOpen={readConfigList(node.config, fieldsPath(node.config)).length > 0}>
        <ApprovalFieldsEditor />
      </InspectorSection>
      <InspectorSection title="Buttons">
        {actions.map((action, index) => {
          const id = readConfigText(action, ['id'])
          return (
            <div key={id || index} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] font-semibold text-muted">{index === 0 ? '1st' : `${index + 1}.`}</span>
              <TextInput ariaLabel={`Button ${index + 1} title`} value={readConfigText(action, ['title'])} disabled={readOnly} onCommit={(title) => writeActions(actions.map((item, itemIndex) => (itemIndex === index ? { ...item, title } : item)), 'renamed a button')} />
              <span className="shrink-0 font-mono text-[11px] text-muted" title="Port id">
                {id}
              </span>
              <ExitRemoveButton handleId={id} itemName={`Button ${readConfigText(action, ['title']) || id}`} nextConfig={writeConfigValue(node.config, ['actions'], actions.filter((_unused, itemIndex) => itemIndex !== index))} />
            </div>
          )
        })}
        <AddButton
          disabled={readOnly}
          onClick={() => {
            const taken = actions.map((action) => readConfigText(action, ['id']))
            const base = slugifyBranchId(actions.length === 0 ? 'send' : 'option') || 'option'
            const id = taken.includes(base) ? uniqueBranchId(taken, base) : base
            writeActions([...actions, { id, title: actions.length === 0 ? 'Send' : `Option ${actions.length + 1}` }], 'added a button')
          }}
        >
          Add a button
        </AddButton>
        <p className={hintClassName}>Each button is a port; the first is the primary button. With none, one Submit button</p>
      </InspectorSection>
      <InspectorSection title="Time limit" defaultOpen={node.timeoutMs !== null}>
        <Field label="Expire the request after">
          <NumberInput ariaLabel="Hours" value={hours} min={0.01} max={8760} step={0.5} suffix="hours · empty = waits until you answer" disabled={readOnly} onCommit={(nextHours) => updateNode({ timeoutMs: nextHours === null ? null : Math.round(nextHours * millisecondsPerHour) }, nextHours === null ? 'removed the approval time limit' : `set the approval to expire after ${nextHours} h`)} />
        </Field>
        <Field label="When it expires">
          <SelectInput
            ariaLabel="When it expires"
            value={timeoutChoice}
            disabled={readOnly || node.timeoutMs === null}
            options={[{ value: 'stop', label: 'Stop the run (default)' }, ...actions.map((action) => ({ value: `action:${readConfigText(action, ['id'])}`, label: `Answer “${readConfigText(action, ['title']) || readConfigText(action, ['id'])}”` }))]}
            onChange={(choice) => setConfigValue(['on_timeout'], choice === 'stop' ? undefined : toOnTimeout(choice), choice === 'stop' ? 'stopped the run when the approval expires' : 'answered a button when the approval expires')}
          />
        </Field>
        <p className={hintClassName}>A button answer uses the fields’ starting values</p>
      </InspectorSection>
    </>
  )
}

