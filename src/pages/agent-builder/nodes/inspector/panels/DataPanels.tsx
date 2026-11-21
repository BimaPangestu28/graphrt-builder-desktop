import type { JsonValue } from '@/api/agentGraphTypes'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { ConditionsEditor } from '../ConditionsEditor'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RemoveButton, SelectInput, TextArea, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { readSelector } from '../references'
import { SelectorChip, SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'

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
    <InspectorSection title="Changes">
      {items.map((item, index) => {
        const operation = readConfigText(item, ['operation']) || 'over-write'
        const fromStep = readConfigText(item, ['input_type']) === 'variable'
        const target = readSelector(item.variable_selector)
        const writesReserved = target?.[0] === 'sys' || target?.[0] === 'env'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <SelectorChip ariaLabel={`Change ${index + 1} value to change`} path={target} emptyLabel="Pick the value to change" onChange={(path) => update(index, { variable_selector: path ?? [] }, 'changed what to remember')} />
              </div>
              <RemoveButton label={`Remove change ${index + 1}`} disabled={readOnly} onClick={() => write(items.filter((_unused, itemIndex) => itemIndex !== index), 'removed a change')} />
            </div>
            {writesReserved && <p role="alert" className="m-0 text-[12px] text-danger">Run values (sys) and secrets (env) can’t be changed</p>}
            <div className="flex items-center gap-1.5">
              <SelectInput ariaLabel={`Change ${index + 1} operation`} className="w-32 shrink-0" value={operation === 'overwrite' ? 'over-write' : operation} disabled={readOnly} options={assignOperations} onChange={(nextOperation) => update(index, { operation: nextOperation }, 'changed an operation')} />
              {!operationsWithoutValue.has(operation) && (
                <SelectInput
                  ariaLabel={`Change ${index + 1} with`}
                  value={fromStep ? 'variable' : 'constant'}
                  disabled={readOnly}
                  options={[
                    { value: 'constant', label: 'a fixed value' },
                    { value: 'variable', label: 'a value from a step' },
                  ]}
                  onChange={(inputType) => update(index, { input_type: inputType, value: inputType === 'variable' ? [] : '' }, 'changed where the value comes from')}
                />
              )}
            </div>
            {!operationsWithoutValue.has(operation) &&
              (fromStep ? (
                <SelectorChip compact ariaLabel={`Change ${index + 1} new value`} path={readSelector(item.value)} onChange={(path) => update(index, { value: path ?? [] }, 'set the new value')} />
              ) : (
                <TextInput ariaLabel={`Change ${index + 1} new value`} placeholder="Value" value={typeof item.value === 'string' ? item.value : item.value === undefined ? '' : JSON.stringify(item.value)} disabled={readOnly} onCommit={(value) => update(index, { value }, 'set the new value')} />
              ))}
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => write([...items, { variable_selector: [], operation: 'over-write', input_type: 'constant', value: '' }], 'added a change')}>
        {items.length === 0 ? 'Add a change' : 'Change another value'}
      </AddButton>
      <p className={hintClassName}>All changes are checked before any is made. Run values (sys) and secrets (env) can’t be changed</p>
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
      <InspectorSection title="List">
        <SelectorField label="List" required path={readSelector(config.variable)} onChange={(path) => setConfigValue(['variable'], path ?? undefined, 'set the list')} />
      </InspectorSection>
      <InspectorSection title="Keep items where">
        <ToggleRow label="Filter" checked={filterOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['filter_by', 'enabled'], enabled, enabled ? 'turned on the filter' : 'turned off the filter')} />
        {filterOn && <ConditionsEditor label="Filter conditions" subject="key" conditions={readConfigList(config, ['filter_by', 'conditions'])} onChange={(conditions, what) => updateConfig((current) => writeConfigValue(current, ['filter_by', 'conditions'], conditions), what)} />}
      </InspectorSection>
      <InspectorSection title="Sort, pick and limit">
        <ToggleRow label="Sort" checked={sortOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['order_by', 'enabled'], enabled, enabled ? 'turned on sorting' : 'turned off sorting')} />
        {sortOn && (
          <div className="grid grid-cols-2 gap-1.5">
            <TextInput ariaLabel="Sort by key" placeholder="Key, e.g. rating" value={readConfigText(config, ['order_by', 'key'])} disabled={readOnly} onCommit={(key) => setConfigValue(['order_by', 'key'], key, 'set the sort key')} />
            <SelectInput
              ariaLabel="Sort order"
              value={readConfigText(config, ['order_by', 'value']) || 'asc'}
              disabled={readOnly}
              options={[
                { value: 'desc', label: 'high to low' },
                { value: 'asc', label: 'low to high' },
              ]}
              onChange={(order) => setConfigValue(['order_by', 'value'], order, 'set the sort order')}
            />
          </div>
        )}
        <ToggleRow label="Pick one" checked={pickOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['extract_by', 'enabled'], enabled, enabled ? 'picked one item' : 'stopped picking one item')} />
        {pickOn && (
          <Field label="Take item number" hint="1 is the first">
            <NumberInput ariaLabel="Take item number" value={readConfigNumber(config, ['extract_by', 'serial'])} min={1} step={1} disabled={readOnly} onCommit={(serial) => setConfigValue(['extract_by', 'serial'], serial === null ? undefined : Math.round(serial), 'set the item number')} />
          </Field>
        )}
        <ToggleRow label="Limit" checked={limitOn} disabled={readOnly} onChange={(enabled) => setConfigValue(['limit', 'enabled'], enabled, enabled ? 'turned on the limit' : 'turned off the limit')} />
        {limitOn && (
          <Field label="Keep at most">
            <NumberInput ariaLabel="Limit" value={readConfigNumber(config, ['limit', 'size'])} min={1} step={1} suffix="items" disabled={readOnly} onCommit={(size) => setConfigValue(['limit', 'size'], size === null ? undefined : Math.round(size), 'set the limit')} />
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
          <TextInput ariaLabel={`${nameLabel} ${index + 1}`} monospace value={readConfigText(binding, ['variable'])} disabled={readOnly} onCommit={(variable) => update(index, { variable: variable.trim() }, `renamed ${nameLabel.toLowerCase()}`)} />
          <SelectorChip compact ariaLabel={`${nameLabel} ${index + 1} value`} path={readSelector(binding.value_selector)} onChange={(selector) => update(index, { value_selector: selector ?? [] }, `set ${nameLabel.toLowerCase()}`)} />
          <RemoveButton label={`Remove ${nameLabel.toLowerCase()} ${index + 1}`} disabled={readOnly} onClick={() => write(bindings.filter((_unused, itemIndex) => itemIndex !== index), `removed ${nameLabel.toLowerCase()}`)} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => write([...bindings, { variable: `value_${bindings.length + 1}`, value_selector: [] }], `added ${nameLabel.toLowerCase()}`)}>
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
      <InspectorSection title="Values">
        <BindingsEditor path={['variables']} label="Values" addLabel="Add a value" nameLabel="Value" />
      </InspectorSection>
      <InspectorSection title="Template">
        <Field label="Template" required error={template.trim() ? null : 'Required'} hint={`Jinja template, run in a sandbox with time and size limits${names.length > 0 ? `. Use ${names.map((name) => `{{ ${name} }}`).join(', ')}` : ''}`}>
          <TextArea ariaLabel="Template" monospace rows={6} value={template} disabled={readOnly} onCommit={(nextTemplate) => setConfigValue(['template'], nextTemplate, 'changed the template')} />
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
            <SelectorChip ariaLabel={`${label} ${index + 1}`} path={readSelector(selector)} onChange={(path) => onChange(list.map((item, itemIndex) => (itemIndex === index ? (path ?? []) : item)), 'changed a combined value')} />
          </div>
          <RemoveButton label={`Remove ${label.toLowerCase()} ${index + 1}`} disabled={readOnly} onClick={() => onChange(list.filter((_unused, itemIndex) => itemIndex !== index), 'removed a combined value')} />
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...list, []], 'added a combined value')}>
        Add a value
      </AddButton>
    </div>
  )
  return (
    <>
      <InspectorSection title="Mode">
        <ToggleRow
          label="Combine in groups"
          description="Off: one output, the first value that is set. On: one output object per group"
          checked={isGrouped}
          disabled={readOnly}
          onChange={(enabled) =>
            updateConfig((config) => {
              const withFlag = writeConfigValue(config, ['advanced_settings', 'group_enabled'], enabled)
              return enabled && readConfigList(config, ['advanced_settings', 'groups']).length === 0
                ? writeConfigValue(withFlag, ['advanced_settings', 'groups'], [{ group_name: 'output_group', variables: readConfigList(config, ['variables']) }])
                : withFlag
            }, enabled ? 'combined in groups' : 'combined into one value')
          }
        />
      </InspectorSection>
      {isGrouped ? (
        <InspectorSection title="Groups">
          {groups.map((group, index) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
              <div className="flex items-center gap-1.5">
                <TextInput ariaLabel={`Group ${index + 1} name`} monospace value={readConfigText(group, ['group_name'])} disabled={readOnly} onCommit={(name) => setConfigValue(['advanced_settings', 'groups', index, 'group_name'], name.trim(), 'renamed a group')} />
                <RemoveButton label={`Remove group ${index + 1}`} disabled={readOnly} onClick={() => setConfigValue(['advanced_settings', 'groups'], groups.filter((_unused, itemIndex) => itemIndex !== index), 'removed a group')} />
              </div>
              {selectorList(readConfigList(group, ['variables']), (next, what) => setConfigValue(['advanced_settings', 'groups', index, 'variables'], next, what), `Group ${index + 1} value`)}
            </div>
          ))}
          <AddButton disabled={readOnly} onClick={() => setConfigValue(['advanced_settings', 'groups'], [...groups, { group_name: `group_${groups.length + 1}`, variables: [] }], 'added a group')}>
            Add a group
          </AddButton>
          <p className={hintClassName}>Usually one value per branch: only the branch that ran has a value</p>
        </InspectorSection>
      ) : (
        <InspectorSection title="Values">
          {selectorList(variables, (next, what) => setConfigValue(['variables'], next, what), 'Value')}
          <p className={hintClassName}>Takes the first value that is set, e.g. after a branch</p>
        </InspectorSection>
      )}
    </>
  )
}

/** Settings of Reply. */
export function AnswerPanel() {
  const { node, setConfigValue } = useInspector()
  return (
    <InspectorSection title="Reply">
      <TemplateField label="Reply" required multiline value={readConfigText(node.config, ['answer'])} onCommit={(answer) => setConfigValue(['answer'], answer, 'changed the reply')} hint="For chatbots. Values that stream (like a model answer) are sent as they arrive, in this order" />
    </InspectorSection>
  )
}

/** Settings of End: the values a run shows. */
export function EndPanel() {
  return (
    <InspectorSection title="Results">
      <BindingsEditor path={['outputs']} label="Results" addLabel="Add a result" nameLabel="Result" />
      <p className={hintClassName}>The values the app shows after a run</p>
    </InspectorSection>
  )
}
