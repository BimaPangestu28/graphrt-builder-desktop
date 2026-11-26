import type { JsonValue } from '@/api/agentGraphTypes'
import { isJsonObject, type JsonObject } from './configPaths'
import { AddButton, RemoveButton, SegmentedChoice, SelectInput, TextInput, type ChoiceOption } from './fields'
import { useInspector } from './InspectorContext'
import { readSelector } from './references'
import { SelectorChip } from './SelectorField'
import { messages } from '@/i18n'

/**
 * Condition rows shared by Check a condition (cases), Repeat (stop when), Filter a list
 * (keep items where) and Knowledge retrieval (metadata filter). graphrt's condition
 * shape: `{variable_selector | key | name, comparison_operator, value}` plus a
 * `logical_operator` (`and` / `or`) for the group. Operators use graphrt's spellings.
 */

/** Operators of Check a condition and Repeat (format guide). */
export const valueOperators = ['contains', 'not contains', 'is', 'is not', 'empty', 'not empty', '=', '≠', '>', '<', '≥', '≤']
/** Operators of the knowledge metadata filter (spec B16). */
export const metadataOperators = ['is', 'is not', 'contains', 'not contains', 'starts with', 'ends with', 'empty', 'not empty', 'in', 'not in', '>', '<', '≥', '≤']
/** Details the app writes on each knowledge chunk. */
export const knowledgeMetadataNames = ['source_name', 'source_id', 'heading', 'chunk_index']

const unaryOperators = new Set(['empty', 'not empty', 'not_empty', 'null', 'not null', 'exists', 'not exists'])

/** What a condition compares: a value selector, a list item key, or a metadata name. */
export type ConditionSubject = 'selector' | 'key' | 'metadata'

const subjectKeys: Record<ConditionSubject, string> = { selector: 'variable_selector', key: 'key', metadata: 'name' }

/** A new condition row of the given subject. */
export function newCondition(subject: ConditionSubject, operator = 'contains'): JsonObject {
  const subjectValue: JsonValue = subject === 'selector' ? [] : subject === 'metadata' ? knowledgeMetadataNames[0] : ''
  return { [subjectKeys[subject]]: subjectValue, comparison_operator: operator, value: '' }
}

function conditionText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

interface ConditionsEditorProps {
  conditions: JsonValue[]
  onChange: (conditions: JsonValue[], what: string) => void
  subject: ConditionSubject
  operators?: string[]
  /** Accessible name of the group ("Case 1 conditions"). */
  label: string
  addLabel?: string
}

/** Editable condition rows. */
export function ConditionsEditor({ conditions, onChange, subject, operators = valueOperators, label, addLabel = messages().nodes.addACondition }: ConditionsEditorProps) {
  const { readOnly } = useInspector()
  const operatorOptions: ChoiceOption[] = operators.map((operator) => ({ value: operator, label: operator }))
  const updateRow = (index: number, changes: JsonObject, what: string) =>
    onChange(
      conditions.map((condition, rowIndex) => (rowIndex === index && isJsonObject(condition) ? { ...condition, ...changes } : condition)),
      what,
    )
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      {conditions.map((condition, index) => {
        const row = isJsonObject(condition) ? condition : {}
        const operator = typeof row.comparison_operator === 'string' ? row.comparison_operator : operators[0]
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                {subject === 'selector' && (
                  <SelectorChip compact ariaLabel={messages().nodes.conditionValueValue(index + 1)} path={readSelector(row.variable_selector)} onChange={(path) => updateRow(index, { variable_selector: path ?? [] }, messages().nodes.changedACondition)} />
                )}
                {subject === 'key' && (
                  <TextInput ariaLabel={messages().nodes.conditionValueItemKey(index + 1)} placeholder={messages().nodes.itemKeyEGRatingEmpty} value={conditionText(row.key)} disabled={readOnly} onCommit={(key) => updateRow(index, { key }, messages().nodes.changedAFilter)} />
                )}
                {subject === 'metadata' && (
                  <SelectInput
                    ariaLabel={messages().nodes.conditionValueDetail(index + 1)}
                    value={conditionText(row.name)}
                    disabled={readOnly}
                    options={knowledgeMetadataNames.map((name) => ({ value: name, label: name }))}
                    onChange={(name) => updateRow(index, { name }, messages().nodes.changedAMetadataFilter)}
                  />
                )}
              </div>
              <RemoveButton label={messages().nodes.removeConditionValue(index + 1)} disabled={readOnly} onClick={() => onChange(conditions.filter((_unused, rowIndex) => rowIndex !== index), messages().nodes.removedACondition)} />
            </div>
            <div className="flex items-center gap-1.5">
              <SelectInput ariaLabel={messages().nodes.conditionValueOperator(index + 1)} className="w-[118px] shrink-0" value={operator} disabled={readOnly} options={operatorOptions} onChange={(nextOperator) => updateRow(index, { comparison_operator: nextOperator }, messages().nodes.changedACondition)} />
              {!unaryOperators.has(operator) && (
                <TextInput ariaLabel={messages().nodes.conditionValueCompareWith(index + 1)} placeholder={messages().nodes.valueOrStepField} value={conditionText(row.value)} disabled={readOnly} onCommit={(value) => updateRow(index, { value }, messages().nodes.changedACondition)} />
              )}
            </div>
          </div>
        )
      })}
      <AddButton disabled={readOnly} onClick={() => onChange([...conditions, newCondition(subject, operators[0] === 'contains' ? 'contains' : operators[0])], messages().nodes.addedACondition)}>
        {addLabel}
      </AddButton>
    </div>
  )
}

/** "Match all (and) / any (or)". */
export function MatchChoice({ value, onChange }: { value: string; onChange: (value: 'and' | 'or') => void }) {
  const { readOnly } = useInspector()
  return (
    <div className="flex items-center gap-2 text-[12px] text-ink-2">
      {messages().nodes.match}
      <SegmentedChoice
        label={messages().nodes.match}
        value={value === 'or' ? 'or' : 'and'}
        disabled={readOnly}
        options={[
          { value: 'and', label: messages().nodes.allAnd },
          { value: 'or', label: messages().nodes.anyOr },
        ]}
        onChange={(choice) => onChange(choice === 'or' ? 'or' : 'and')}
      />
    </div>
  )
}
