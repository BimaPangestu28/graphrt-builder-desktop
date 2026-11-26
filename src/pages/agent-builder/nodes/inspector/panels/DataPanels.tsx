import type { JsonValue } from '@/api/agentGraphTypes'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { ConditionsEditor } from '../ConditionsEditor'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RemoveButton, SelectInput, TextArea, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { readSelector } from '../references'
import { SelectorChip, SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'
import { messages } from '@/i18n'

/**
 * Remember a value (`assigner`), Filter a list (`list-operator`), Format text
 * (`template-transform`), Combine results (`variable-aggregator`), Reply (`answer`)
 * and End (`end` outputs), per spec B14 / B16.
 */

/** Assigner operations in graphrt's spelling, with the words the spec shows. */
export const assignOperations = [
  { value: 'over-write', label: 'overwrite' },
  { value: 'clear', label: 'clear' },
  { value: 'set', label: 'set' },
  { value: 'append', label: 'append' },
  { value: 'extend', label: 'extend' },
  { value: 'remove-first', label: 'remove first' },
  { value: 'remove-last', label: 'remove last' },
  { value: '+=', label: '+=' },
  { value: '-=', label: '−=' },
  { value: '*=', label: '×=' },
  { value: '/=', label: '÷=' },
]

const operationsWithoutValue = new Set(['clear', 'remove-first', 'remove-last'])

/** Settings of Remember a value: one row per change. */
export function AssignerPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const items = readConfigList(node.config, ['items']).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(['items'], next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item)), what)
  return (
    <InspectorSection title={messages().nodes.changes}>
      {items.map((item, index) => {
        const operation = readConfigText(item, ['operation']) || 'over-write'
        const fromStep = readConfigText(item, ['input_type']) === 'variable'
        const target = readSelector(item.variable_selector)
        const writesReserved = target?.[0] === 'sys' || target?.[0] === 'env'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <SelectorChip ariaLabel={messages().nodes.changeValueValueToChange(index + 1)} path={target} emptyLabel={messages().nodes.pickTheValueToChange} onChange={(path) => update(index, { variable_selector: path ?? [] }, messages().nodes.changedWhatToRemember)} />
              </div>
              <RemoveButton label={messages().nodes.removeChangeValue(index + 1)} disabled={readOnly} onClick={() => write(items.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedAChange)} />
            </div>
            {writesReserved && <p role="alert" className="m-0 text-[12px] text-danger">{messages().nodes.runValuesSysAndSecretsEnv}</p>}
            <div className="flex items-center gap-1.5">
              <SelectInput ariaLabel={messages().nodes.changeValueOperation(index + 1)} className="w-32 shrink-0" value={operation === 'overwrite' ? 'over-write' : operation} disabled={readOnly} options={assignOperations} onChange={(nextOperation) => update(index, { operation: nextOperation }, messages().nodes.changedAnOperation)} />
              {!operationsWithoutValue.has(operation) && (
                <SelectInput
                  ariaLabel={messages().nodes.changeValueWith(index + 1)}
                  value={fromStep ? 'variable' : 'constant'}
                  disabled={readOnly}
                  options={[
                    { value: 'constant', label: messages().nodes.aFixedValue },
                    { value: 'variable', label: messages().nodes.aValueFromAStep },
                  ]}
                  onChange={(inputType) => update(index, { input_type: inputType, value: inputType === 'variable' ? [] : '' }, messages().nodes.changedWhereTheValueComesFrom)}
                />
              )}
            </div>
            {!operationsWithoutValue.has(operation) &&
              (fromStep ? (
                <SelectorChip compact ariaLabel={messages().nodes.changeValueNewValue(index + 1)} path={readSelector(item.value)} onChange={(path) => update(index, { value: path ?? [] }, messages().nodes.setTheNewValue)} />
              ) : (
                <TextInput ariaLabel={messages().nodes.changeValueNewValue(index + 1)} placeholder={messages().nodes.value} value={typeof item.value === 'string' ? item.value : item.value === undefined ? '' : JSON.stringify(item.value)} disabled={readOnly} onCommit={(value) => update(index, { value }, messages().nodes.setTheNewValue)} />
              ))}
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...items, { variable_selector: [], operation: 'over-write', input_type: 'constant', value: '' }], messages().nodes.addedAChange)}>
        {items.length === 0 ? messages().nodes.addAChange : messages().nodes.changeAnotherValue}
      </AddButton>
      <p className={hintClassName}>{messages().nodes.allChangesAreCheckedBeforeAny}</p>
    </InspectorSection>
  )
}

/** Settings of Filter a list. */
export function ListOperatorPanel() {
  const { node, readOnly, setConfigValue, updateConfig } = useInspector()
  const config = node.config
  const filterOn = readConfigFlag(config, ['filter_by', 'enabled'])
  const sortOn = readConfigFlag(config, ['order_by', 'enabled'])
  const pickOn = readConfigFlag(config, ['extract_by', 'enabled'])
  const limitOn = readConfigFlag(config, ['limit', 'enabled'])
  return (
    <>
      <InspectorSection title={messages().nodes.list}>
        <SelectorField label={messages().nodes.list} required path={readSelector(config.variable)} onChange={(path) => setConfigValue(['variable'], path ?? undefined, messages().nodes.setTheList)} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.keepItemsWhere}>
        <ToggleRow label={messages().nodes.filter} checked={filterOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['filter_by', 'enabled'], enabled, enabled ? messages().nodes.turnedOnTheFilter : messages().nodes.turnedOffTheFilter)} />
        {filterOn && <ConditionsEditor label={messages().nodes.filterConditions} subject="key" conditions={readConfigList(config, ['filter_by', 'conditions'])} onChange={(conditions, what) => updateConfig((current) => writeConfigValue(current, ['filter_by', 'conditions'], conditions), what)} />}
      </InspectorSection>
      <InspectorSection title={messages().nodes.sortPickAndLimit}>
        <ToggleRow label={messages().nodes.sort} checked={sortOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['order_by', 'enabled'], enabled, enabled ? messages().nodes.turnedOnSorting : messages().nodes.turnedOffSorting)} />
        {sortOn && (
          <div className="grid grid-cols-2 gap-1.5">
            <TextInput ariaLabel={messages().nodes.sortByKey} placeholder={messages().nodes.keyEGRating} value={readConfigText(config, ['order_by', 'key'])} disabled={readOnly} onCommit={(key) => setConfigValue(['order_by', 'key'], key, messages().nodes.setTheSortKey)} />
            <SelectInput
              ariaLabel={messages().nodes.sortOrder}
              value={readConfigText(config, ['order_by', 'value']) || 'asc'}
              disabled={readOnly}
              options={[
                { value: 'desc', label: messages().nodes.highToLow },
                { value: 'asc', label: messages().nodes.lowToHigh },
              ]}
              onChange={(order) => setConfigValue(['order_by', 'value'], order, messages().nodes.setTheSortOrder)}
            />
          </div>
        )}
        <ToggleRow label={messages().nodes.pickOne} checked={pickOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['extract_by', 'enabled'], enabled, enabled ? messages().nodes.pickedOneItem : messages().nodes.stoppedPickingOneItem)} />
        {pickOn && (
          <Field label={messages().nodes.takeItemNumber} hint={messages().nodes.n1IsTheFirst}>
            <NumberInput ariaLabel={messages().nodes.takeItemNumber} value={readConfigNumber(config, ['extract_by', 'serial'])} min={1} step={1} disabled={readOnly} onCommit={(serial) => setConfigValue(['extract_by', 'serial'], serial === null ? undefined : Math.round(serial), messages().nodes.setTheItemNumber)} />
          </Field>
        )}
        <ToggleRow label={messages().nodes.limit} checked={limitOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['limit', 'enabled'], enabled, enabled ? messages().nodes.turnedOnTheLimit : messages().nodes.turnedOffTheLimit)} />
        {limitOn && (
          <Field label={messages().nodes.keepAtMost}>
            <NumberInput ariaLabel={messages().nodes.limit} value={readConfigNumber(config, ['limit', 'size'])} min={1} step={1} suffix="items" disabled={readOnly} onCommit={(size) => setConfigValue(['limit', 'size'], size === null ? undefined : Math.round(size), messages().nodes.setTheLimit)} />
          </Field>
        )}
      </InspectorSection>
    </>
  )
}

/** `[{variable, value_selector}]` rows (Format text values, End outputs). */
function BindingsEditor({ path, label, addLabel, nameLabel }: { path: string[]; label: string; addLabel: string; nameLabel: string }) {
  const { node, readOnly, setConfigValue } = useInspector()
  const bindings = readConfigList(node.config, path).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(path, next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(bindings.map((binding, itemIndex) => (itemIndex === index ? { ...binding, ...changes } : binding)), what)
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {bindings.map((binding, index) => (
        <div key={index} className="grid grid-cols-[96px_minmax(0,1fr)_24px] items-start gap-1.5">
          <TextInput ariaLabel={`${nameLabel} ${index + 1}`} monospace value={readConfigText(binding, ['variable'])} disabled={readOnly} onCommit={(variable) => update(index, { variable: variable.trim() }, messages().nodes.renamedLowercase(nameLabel.toLowerCase()))} />
          <SelectorChip compact ariaLabel={messages().nodes.namelabelValueValue(nameLabel, index + 1)} path={readSelector(binding.value_selector)} onChange={(selector) => update(index, { value_selector: selector ?? [] }, messages().nodes.setLowercase(nameLabel.toLowerCase()))} />
          <RemoveButton label={messages().nodes.removeLowercaseValue(nameLabel.toLowerCase(), index + 1)} disabled={readOnly} onClick={() => write(bindings.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedLowercase(nameLabel.toLowerCase()))} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => write([...bindings, { variable: `value_${bindings.length + 1}`, value_selector: [] }], messages().nodes.addedLowercase(nameLabel.toLowerCase()))}>
        {addLabel}
      </AddButton>
    </div>
  )
}

/** Settings of Format text: named values and a Jinja template. */
export function TemplateTransformPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const template = readConfigText(node.config, ['template'])
  const names = readConfigList(node.config, ['variables']).filter(isJsonObject).map((binding) => readConfigText(binding, ['variable']))
  return (
    <>
      <InspectorSection title={messages().nodes.values}>
        <BindingsEditor path={['variables']} label={messages().nodes.values} addLabel={messages().nodes.addAValue} nameLabel={messages().nodes.value} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.template}>
        <Field label={messages().nodes.template} required error={template.trim() ? null : messages().nodes.required2} hint={messages().nodes.jinjaHint(names.map((name) => `{{ ${name} }}`).join(', '))}>
          <TextArea ariaLabel={messages().nodes.template} monospace rows={6} value={template} disabled={readOnly} onCommit={(nextTemplate) => setConfigValue(['template'], nextTemplate, messages().nodes.changedTheTemplate)} />
        </Field>
      </InspectorSection>
    </>
  )
}

/** Settings of Combine results: one list of values, or named groups. */
export function AggregatorPanel() {
  const { node, readOnly, setConfigValue, updateConfig } = useInspector()
  const isGrouped = readConfigValue(node.config, ['advanced_settings', 'group_enabled']) === true
  const variables = readConfigList(node.config, ['variables'])
  const groups = readConfigList(node.config, ['advanced_settings', 'groups']).filter(isJsonObject)
  const selectorList = (list: JsonValue[], onChange: (next: JsonValue[], what: string) => void, label: string) => (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {list.map((selector, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <SelectorChip ariaLabel={`${label} ${index + 1}`} path={readSelector(selector)} onChange={(path) => onChange(list.map((item, itemIndex) => (itemIndex === index ? (path ?? []) : item)), messages().nodes.changedACombinedValue)} />
          </div>
          <RemoveButton label={messages().nodes.removeLowercaseValue(label.toLowerCase(), index + 1)} disabled={readOnly} onClick={() => onChange(list.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedACombinedValue)} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...list, []], messages().nodes.addedACombinedValue)}>
        {messages().nodes.addAValue}
      </AddButton>
    </div>
  )
  return (
    <>
      <InspectorSection title={messages().nodes.mode}>
        <ToggleRow
          label={messages().nodes.combineInGroups}
          description={messages().nodes.offOneOutputTheFirstValue}
          checked={isGrouped}
          disabled={readOnly}
          onChange={(enabled) =>
            updateConfig((config) => {
              const withFlag = writeConfigValue(config, ['advanced_settings', 'group_enabled'], enabled)
              return enabled && readConfigList(config, ['advanced_settings', 'groups']).length === 0
                ? writeConfigValue(withFlag, ['advanced_settings', 'groups'], [{ group_name: 'output_group', variables: readConfigList(config, ['variables']) }])
                : withFlag
            }, enabled ? messages().nodes.combinedInGroups : messages().nodes.combinedIntoOneValue)
          }
        />
      </InspectorSection>
      {isGrouped ? (
        <InspectorSection title={messages().nodes.groups}>
          {groups.map((group, index) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
              <div className="flex items-center gap-1.5">
                <TextInput ariaLabel={messages().nodes.groupValueName(index + 1)} monospace value={readConfigText(group, ['group_name'])} disabled={readOnly} onCommit={(name) => setConfigValue(['advanced_settings', 'groups', index, 'group_name'], name.trim(), messages().nodes.renamedAGroup)} />
                <RemoveButton label={messages().nodes.removeGroupValue(index + 1)} disabled={readOnly} onClick={() => setConfigValue(['advanced_settings', 'groups'], groups.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedAGroup)} />
              </div>
              {selectorList(readConfigList(group, ['variables']), (next, what) => setConfigValue(['advanced_settings', 'groups', index, 'variables'], next, what), messages().nodes.groupValueValue(index + 1))}
            </div>
          ))}
          <AddButton disabled={readOnly} onClick={() => setConfigValue(['advanced_settings', 'groups'], [...groups, { group_name: `group_${groups.length + 1}`, variables: [] }], messages().nodes.addedAGroup)}>
            {messages().nodes.addAGroup}
          </AddButton>
          <p className={hintClassName}>{messages().nodes.usuallyOneValuePerBranchOnly}</p>
        </InspectorSection>
      ) : (
        <InspectorSection title={messages().nodes.values}>
          {selectorList(variables, (next, what) => setConfigValue(['variables'], next, what), messages().nodes.value)}
          <p className={hintClassName}>{messages().nodes.takesTheFirstValueThatIs}</p>
        </InspectorSection>
      )}
    </>
  )
}

/** Settings of Reply. */
export function AnswerPanel() {
  const { node, setConfigValue } = useInspector()
  return (
    <InspectorSection title={messages().nodes.reply}>
      <TemplateField label={messages().nodes.reply} required multiline value={readConfigText(node.config, ['answer'])} onCommit={(answer) => setConfigValue(['answer'], answer, messages().nodes.changedTheReply)} hint={messages().nodes.forChatbotsValuesThatStreamLike} />
    </InspectorSection>
  )
}

/** Settings of End: the values a run shows. */
export function EndPanel() {
  return (
    <InspectorSection title={messages().nodes.results2}>
      <BindingsEditor path={['outputs']} label={messages().nodes.results2} addLabel={messages().nodes.addAResult} nameLabel={messages().nodes.result} />
      <p className={hintClassName}>{messages().nodes.theValuesTheAppShowsAfter}</p>
    </InspectorSection>
  )
}
