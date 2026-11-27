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
import { messages } from '@/i18n'

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
      <InspectorSection title={messages().nodes.paths}>
        {cases.map((item, index) => {
          const caseId = readConfigText(item, ['case_id'])
          const isAny = readConfigText(item, ['logical_operator']) === 'or'
          return (
            <div key={caseId || index} className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{messages().nodes.case}{' '}{index + 1}</span>
                <ExitRemoveButton handleId={caseId} itemName={messages().nodes.caseValue(index + 1)} nextConfig={writeIfElseCases(node.config, cases.filter((_unused, itemIndex) => itemIndex !== index))} />
              </div>
              <span className={hintClassName}>{messages().nodes.takesThisPathWhen}{' '}{isAny ? 'any' : 'all'} {messages().nodes.ofTheseHold}</span>
              <ConditionsEditor label={messages().nodes.caseValueConditions(index + 1)} subject="selector" conditions={readConfigList(item, ['conditions'])} onChange={(conditions, what) => updateCase(index, { conditions }, what)} />
              <MatchChoice value={readConfigText(item, ['logical_operator'])} onChange={(operator) => updateCase(index, { logical_operator: operator }, messages().nodes.setTheCaseMatch)} />
            </div>
          )
        })}
        <AddButton disabled={readOnly} onClick={() => writeCases([...cases, { case_id: uniqueBranchId(cases.map((item) => readConfigText(item, ['case_id'])), 'case'), logical_operator: 'and', conditions: [] }], messages().nodes.addedACase)}>
          {messages().nodes.addACase}
        </AddButton>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-dashed border-line-heavy px-2.5 py-2">
          <span className="text-[13px] font-semibold">{messages().nodes.else}</span>
          <span className={hintClassName}>{messages().nodes.alwaysThereTakenWhenNoCase}</span>
        </div>
        <p className={hintClassName}>{messages().nodes.casesAreCheckedFromTheTop}</p>
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
      <InspectorSection title={messages().nodes.items}>
        <SelectorField label={messages().nodes.runTheStepsInsideOnceFor} required path={itemsPath} onChange={(path) => setConfigValue(['iterator_selector'], path ?? undefined, messages().nodes.setTheItems)} hint={messages().nodes.mustBeList(itemsSource ? itemsSource.typeHint : null)} />
        <Field label={messages().nodes.collectFromEachItem} hint={messages().nodes.becomesTheLoopsOutputListIn}>
          <SelectorChip ariaLabel={messages().nodes.collectFromEachItem} groups={bodyGroups} path={readSelector(config.output_selector)} emptyLabel={messages().nodes.pickAValueFromTheSteps} onChange={(path) => setConfigValue(['output_selector'], path ?? undefined, messages().nodes.setWhatToCollect)} />
        </Field>
      </InspectorSection>
      <InspectorSection title={messages().nodes.speed}>
        <RadioCards
          legend={messages().nodes.howItemsRun}
          name="parallel"
          value={isParallel && !mustRunInOrder ? 'parallel' : 'sequential'}
          disabled={readOnly}
          onChange={(choice) => updateConfig((current) => writeConfigValue(current, ['is_parallel'], choice === 'parallel'), choice === 'parallel' ? messages().nodes.ranItemsSeveralAtOnce : messages().nodes.ranItemsOneAtATime)}
          options={[
            { value: 'sequential', title: messages().nodes.oneAtATime2, description: mustRunInOrder ? messages().nodes.requiredHereThisLoopAsksYou : undefined },
            { value: 'parallel', title: messages().nodes.severalAtOnce, description: messages().nodes.upToTheNumberBelowRun, disabled: mustRunInOrder },
          ]}
        />
        {isParallel && !mustRunInOrder && (
          <Field label={messages().nodes.atMostAtOnce}>
            <NumberInput ariaLabel={messages().nodes.atMostAtOnce} value={readConfigNumber(config, ['parallel_nums']) ?? 10} min={1} max={100} step={1} suffix={messages().nodes.atOnce1To100} disabled={readOnly} onCommit={(count) => setConfigValue(['parallel_nums'], count === null ? undefined : Math.round(count), messages().nodes.setHowManyRunAtOnce)} />
          </Field>
        )}
      </InspectorSection>
      <InspectorSection title={messages().nodes.ifOneItemFails}>
        <RadioCards
          legend={messages().nodes.ifOneItemFails}
          name="error-handle-mode"
          value={errorMode}
          disabled={readOnly}
          onChange={(mode) => setConfigValue(['error_handle_mode'], mode, messages().nodes.setIfOneItemFails)}
          options={[
            { value: 'terminated', title: messages().nodes.stopTheLoop, description: messages().nodes.defaultItemsStillRunningAreCancelled },
            { value: 'continue-on-error', title: messages().nodes.skipItAndContinue, description: messages().nodes.itsPlaceInTheOutputStays },
            { value: 'remove-abnormal-output', title: messages().nodes.dropItsResult, description: messages().nodes.itLeavesNoEntryInThe },
          ]}
        />
      </InspectorSection>
      <InspectorSection title={messages().nodes.output} defaultOpen={false}>
        <ToggleRow label={messages().nodes.flattenLists} description={messages().nodes.whenEachItemReturnsAList} checked={readConfigFlag(config, ['flatten_output'], true)} disabled={readOnly} onChange={(flatten) => setConfigValue(['flatten_output'], flatten, flatten ? messages().nodes.turnedOnFlattenLists : messages().nodes.turnedOffFlattenLists)} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.availableInsideTheLoop} defaultOpen={false}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
          <li className="flex justify-between gap-2">
            <span className="font-mono">{messages().nodes.item}</span>
            <span className="text-muted">{itemsSource?.typeHint.startsWith('list of ') ? itemsSource.typeHint.slice(8).replace(/s$/, '') : messages().nodes.oneItemOfTheList}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="font-mono">{messages().nodes.index}</span>
            <span className="text-muted">{messages().nodes.number0ForTheFirstItem}</span>
          </li>
        </ul>
        <p className={hintClassName}>{messages().nodes.afterTheLoopOutputListAnd}</p>
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
              <TextInput ariaLabel={messages().nodes.valueValueName(index + 1)} monospace value={readConfigText(variable, ['label'])} disabled={readOnly} onCommit={(label) => update(index, { label: label.trim() }, messages().nodes.renamedALoopValue)} />
              <SelectInput ariaLabel={messages().nodes.valueValueType(index + 1)} value={readConfigText(variable, ['var_type']) || 'string'} disabled={readOnly} options={loopVariableTypes} onChange={(varType) => update(index, { var_type: varType }, messages().nodes.changedALoopValueType)} />
              <RemoveButton label={messages().nodes.removeValueValue(index + 1)} disabled={readOnly} onClick={() => write(variables.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedALoopValue)} />
            </div>
            <div className="flex items-center gap-1.5">
              <SelectInput
                ariaLabel={messages().nodes.valueValueStartsAs(index + 1)}
                className="w-32 shrink-0"
                value={fromStep ? 'variable' : 'constant'}
                disabled={readOnly}
                options={[
                  { value: 'constant', label: messages().nodes.aFixedValue },
                  { value: 'variable', label: messages().nodes.fromAStep },
                ]}
                onChange={(valueType) => update(index, { value_type: valueType, value: valueType === 'variable' ? [] : '' }, messages().nodes.changedHowALoopValueStarts)}
              />
              <div className="min-w-0 flex-1">
                {fromStep ? (
                  <SelectorChip compact ariaLabel={messages().nodes.valueValueStart(index + 1)} path={readSelector(variable.value)} onChange={(path) => update(index, { value: path ?? [] }, messages().nodes.setALoopValueStart)} />
                ) : (
                  <TextInput ariaLabel={messages().nodes.valueValueStart(index + 1)} placeholder={messages().nodes.startsAs} value={typeof variable.value === 'string' ? variable.value : variable.value === undefined ? '' : JSON.stringify(variable.value)} disabled={readOnly} onCommit={(value) => update(index, { value }, messages().nodes.setALoopValueStart)} />
                )}
              </div>
            </div>
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...variables, { label: `value_${variables.length + 1}`, var_type: 'string', value_type: 'constant', value: '' }], messages().nodes.addedALoopValue)}>
        {messages().nodes.addAValue}
      </AddButton>
      <p className={hintClassName}>{messages().nodes.changeThemInsideWithRememberA}</p>
    </div>
  )
}

/** Settings of Repeat. */
export function LoopPanel() {
  const { node, graph, readOnly, setConfigValue, updateConfig } = useInspector()
  const hasStopStep = graph.nodes.some((candidate) => candidate.parent === node.id && candidate.kind === 'loop-end')
  return (
    <>
      <InspectorSection title={messages().nodes.rounds}>
        <Field label={messages().nodes.repeatAtMost} hint={messages().nodes.theBodyRunsAgainUntilA}>
          <NumberInput ariaLabel={messages().nodes.rounds} value={readConfigNumber(node.config, ['loop_count']) ?? 1} min={1} max={10000} step={1} suffix={messages().nodes.rounds1To10000} disabled={readOnly} onCommit={(count) => setConfigValue(['loop_count'], Math.round(count ?? 1), messages().nodes.setRepeatAtMostValueRounds(Math.round(count ?? 1)))} />
        </Field>
      </InspectorSection>
      <InspectorSection title={messages().nodes.stopWhen}>
        <ConditionsEditor label={messages().nodes.stopConditions} subject="selector" conditions={readConfigList(node.config, ['break_conditions'])} onChange={(conditions, what) => updateConfig((config) => writeConfigValue(config, ['break_conditions'], conditions), what)} />
        <MatchChoice value={readConfigText(node.config, ['logical_operator'])} onChange={(operator) => setConfigValue(['logical_operator'], operator, messages().nodes.setTheStopMatch)} />
        <p className={hintClassName}>{hasStopStep ? messages().nodes.aStopRepeatingStepInsideAlso : messages().nodes.addAStopRepeatingStepInside}</p>
      </InspectorSection>
      <InspectorSection title={messages().nodes.valuesKeptBetweenRounds}>
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
              <TextInput ariaLabel={messages().nodes.fieldValueName(index + 1)} monospace value={readConfigText(field, [nameKey])} disabled={readOnly} onCommit={(name) => update(index, { [nameKey]: name.trim() }, messages().nodes.renamedAnApprovalField)} />
              <SelectInput ariaLabel={messages().nodes.fieldValueType(index + 1)} value={readConfigText(field, ['type']) || 'text'} disabled={readOnly} options={fieldTypes} onChange={(type) => update(index, { type }, messages().nodes.changedAnApprovalFieldType)} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2">
                <input type="checkbox" aria-label={messages().nodes.fieldValueMustBeFilled(index + 1)} checked={field.required === true} disabled={readOnly} onChange={(event) => update(index, { required: event.target.checked }, messages().nodes.changedARequiredField)} className="accent-ink" />
                {messages().nodes.must}
              </label>
              <RemoveButton label={messages().nodes.removeFieldValue(index + 1)} disabled={readOnly} onClick={() => write(fields.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedAnApprovalField)} />
            </div>
            <TextInput ariaLabel={messages().nodes.fieldValueLabel(index + 1)} placeholder={messages().nodes.label} value={readConfigText(field, ['label'])} disabled={readOnly} onCommit={(label) => update(index, { label }, messages().nodes.labelledAnApprovalField)} />
            <TextInput ariaLabel={messages().nodes.fieldValueStartsWith(index + 1)} placeholder={messages().nodes.startsWithEGWriteMessage} value={readConfigText(field, ['default'])} disabled={readOnly} onCommit={(value) => update(index, { default: value }, messages().nodes.setAnApprovalFieldDefault)} />
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...fields, { name: `field_${fields.length + 1}`, label: '', type: 'paragraph', required: false }], messages().nodes.addedAnApprovalField)}>
        {messages().nodes.addAField}
      </AddButton>
      <p className={hintClassName}>{messages().nodes.eachFieldBecomesAnOutputOf}</p>
    </div>
  )
}

const millisecondsPerHour = 3_600_000

/** `on_expire` as a select value: `stop` or `action:<id>`. */
export function readOnExpire(config: NodeConfig): string {
  const onExpire = config.on_expire
  if (isJsonObject(onExpire) && typeof onExpire.action === 'string') return `action:${onExpire.action}`
  return 'stop'
}

function toOnExpire(choice: string): JsonValue {
  return choice.startsWith('action:') ? { action: choice.slice(7) } : 'stop'
}

/** The step's time limit (`expire_after_ms`), or null when it waits until answered. */
function readExpireAfterMs(config: NodeConfig): number | null {
  const value = config.expire_after_ms
  return typeof value === 'number' && value > 0 ? value : null
}

/** Settings of Ask me before continuing: question, fields, buttons (ports) and time limit. */
export function HumanInputPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const promptKey = node.config.prompt === undefined && typeof node.config.content === 'string' ? 'content' : 'prompt'
  const actions = readConfigList(node.config, ['actions']).filter(isJsonObject)
  const writeActions = (next: JsonObject[], what: string) => setConfigValue(['actions'], next, what)
  const expireAfterMs = readExpireAfterMs(node.config)
  const hours = expireAfterMs === null ? null : Number((expireAfterMs / millisecondsPerHour).toFixed(2))
  const timeoutChoice = readOnExpire(node.config)
  return (
    <>
      <InspectorSection title={messages().nodes.question}>
        <TemplateField label={messages().nodes.question} required multiline value={readConfigText(node.config, [promptKey])} onCommit={(prompt) => setConfigValue([promptKey], prompt, messages().nodes.changedTheQuestion)} hint={messages().nodes.firstLineIsTheTitleOf} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.fieldsYouCanCheckOrEdit} defaultOpen={readConfigList(node.config, fieldsPath(node.config)).length > 0}>
        <ApprovalFieldsEditor />
      </InspectorSection>
      <InspectorSection title={messages().nodes.buttons}>
        {actions.map((action, index) => {
          const id = readConfigText(action, ['id'])
          return (
            <div key={id || index} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] font-semibold text-muted">{index === 0 ? '1st' : `${index + 1}.`}</span>
              <TextInput ariaLabel={messages().nodes.buttonValueTitle(index + 1)} value={readConfigText(action, ['title'])} disabled={readOnly} onCommit={(title) => writeActions(actions.map((item, itemIndex) => (itemIndex === index ? { ...item, title } : item)), messages().nodes.renamedAButton)} />
              <span className="shrink-0 font-mono text-[11px] text-muted" title={messages().nodes.portId}>
                {id}
              </span>
              <ExitRemoveButton handleId={id} itemName={messages().nodes.buttonItem(readConfigText(action, ['title']) || id)} nextConfig={writeConfigValue(node.config, ['actions'], actions.filter((_unused, itemIndex) => itemIndex !== index))} />
            </div>
          )
        })}
        <AddButton
          disabled={readOnly}
          onClick={() => {
            const taken = actions.map((action) => readConfigText(action, ['id']))
            const base = slugifyBranchId(actions.length === 0 ? 'send' : 'option') || 'option'
            const id = taken.includes(base) ? uniqueBranchId(taken, base) : base
            writeActions([...actions, { id, title: actions.length === 0 ? messages().nodes.send : messages().nodes.optionValue(actions.length + 1) }], messages().nodes.addedAButton)
          }}
        >
          {messages().nodes.addAButton}
        </AddButton>
        <p className={hintClassName}>{messages().nodes.eachButtonIsAPortThe}</p>
      </InspectorSection>
      <InspectorSection title={messages().nodes.timeLimit} defaultOpen={expireAfterMs !== null}>
        <Field label={messages().nodes.expireTheRequestAfter}>
          <NumberInput ariaLabel={messages().nodes.hours} value={hours} min={0.01} max={8760} step={0.5} suffix={messages().nodes.hoursEmptyWaitsUntilYouAnswer} disabled={readOnly} onCommit={(nextHours) => setConfigValue(['expire_after_ms'], nextHours === null ? undefined : Math.round(nextHours * millisecondsPerHour), nextHours === null ? messages().nodes.removedTheApprovalTimeLimit : messages().nodes.setTheApprovalToExpireAfter(nextHours))} />
        </Field>
        <Field label={messages().nodes.whenItExpires}>
          <SelectInput
            ariaLabel={messages().nodes.whenItExpires}
            value={timeoutChoice}
            disabled={readOnly || expireAfterMs === null}
            options={[{ value: 'stop', label: messages().nodes.stopTheRunDefault }, ...actions.map((action) => ({ value: `action:${readConfigText(action, ['id'])}`, label: messages().nodes.answerWith(readConfigText(action, ['title']) || readConfigText(action, ['id'])) }))]}
            onChange={(choice) => setConfigValue(['on_expire'], choice === 'stop' ? undefined : toOnExpire(choice), choice === 'stop' ? messages().nodes.stoppedTheRunWhenTheApproval : messages().nodes.answeredAButtonWhenTheApproval)}
          />
        </Field>
        <p className={hintClassName}>{messages().nodes.aButtonAnswerUsesTheFields}</p>
      </InspectorSection>
    </>
  )
}

