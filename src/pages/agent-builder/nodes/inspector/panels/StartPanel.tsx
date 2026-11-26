import { useEffect, useId, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { AgentGraph, JsonValue } from '@/api/agentGraphTypes'
import { Icon, joinClassNames, StrokeIcon } from '@/components/ui'
import { AddButton, Field, hintClassName, InspectorSection, linkButtonClassName, NumberInput, RemoveButton, SelectInput, TextArea, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { formatReference } from '../references'
import { JsonBox } from '../SchemaForm'
import {
  addStartVariable,
  changeVariableOptions,
  changeVariableType,
  defaultControlFor,
  describeStartInputType,
  duplicateStartVariable,
  findInputUsages,
  moveStartVariable,
  readStartVariables,
  relabelStartVariable,
  removeStartVariable,
  renameStartVariable,
  startInputTypes,
  takesMaxLength,
  updateStartVariable,
  validateVariableName,
  variableLabelOf,
  variableNameOf,
  variableOptionsOf,
  variableTypeOf,
  writeStartVariables,
  type InputUsage,
  type StartVariable,
} from '../startInputs'
import { messages } from '@/i18n'

/**
 * Settings of the Start step: the inputs a person fills in when the agent runs (the
 * Test form shows them the same way). Each input is a row with its label, type,
 * required toggle and where it is used; expanding a row shows its variable name,
 * default value and the type's options. Rows can be added, duplicated, reordered (drag
 * the handle, or arrow keys on it) and deleted (with a warning when steps read it).
 * Renaming a variable rewrites the `{{#start.x#}}` references in the same undo step.
 * "Edit as JSON" stays as an escape hatch for keys the form does not cover.
 */

const iconButtonClassNames =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-chip hover:text-ink disabled:cursor-not-allowed disabled:opacity-50'

/** "Used by 2 steps" / "Not used yet". */
export function describeUsageCount(count: number): string {
  if (count === 0) return messages().nodes.notUsedYet
  return messages().nodes.usedBySteps(count)
}

/** "Search Google Maps and Write message" / "A, B and C". */
function joinTitles(usages: InputUsage[]): string {
  const titles = usages.map((usage) => usage.title)
  if (titles.length <= 1) return titles[0] ?? ''
  return messages().nodes.valueAndValue2(titles.slice(0, -1).join(', '), titles.at(-1))
}

interface RowEditing {
  /** Applies one graph change as one undo step, with words for the version summary. */
  edit: (change: (graph: AgentGraph) => AgentGraph, what: string) => void
  startId: string
  readOnly: boolean
}

function DefaultValueField({ variable, index, editing }: { variable: StartVariable; index: number; editing: RowEditing }) {
  const type = variableTypeOf(variable)
  const label = variableLabelOf(variable) || messages().nodes.inputValue(index + 1)
  const setDefault = (value: JsonValue | undefined) =>
    editing.edit((graph) => updateStartVariable(graph, editing.startId, index, (current) => {
      const next = { ...current }
      if (value === undefined) delete next.default
      else next.default = value
      return next
    }), messages().nodes.setTheDefaultOfLabel(label))
  const current = variable.default
  switch (defaultControlFor(type)) {
    case 'none':
      return <p className={hintClassName}>{messages().nodes.filesHaveNoDefaultThePerson}</p>
    case 'checkbox':
      return <ToggleRow label={messages().nodes.checkedByDefault} checked={current === true} disabled={editing.readOnly} onChange={(checked) => setDefault(checked)} />
    case 'number':
      return (
        <Field label={messages().nodes.defaultValue} hint={messages().nodes.usedWhenItIsLeftEmpty}>
          <NumberInput ariaLabel={messages().nodes.defaultValue} wide value={typeof current === 'number' ? current : null} disabled={editing.readOnly} onCommit={(next) => setDefault(next ?? undefined)} />
        </Field>
      )
    case 'select':
      return (
        <Field label={messages().nodes.defaultChoice}>
          <SelectInput
            ariaLabel={messages().nodes.defaultChoice}
            value={typeof current === 'string' ? current : ''}
            disabled={editing.readOnly}
            options={[{ value: '', label: messages().nodes.noDefault }, ...variableOptionsOf(variable).map((option) => ({ value: option, label: option }))]}
            onChange={(choice) => setDefault(choice === '' ? undefined : choice)}
          />
        </Field>
      )
    case 'textarea':
      return (
        <Field label={messages().nodes.defaultValue} hint={messages().nodes.usedWhenItIsLeftEmpty}>
          <TextArea ariaLabel={messages().nodes.defaultValue} rows={2} value={typeof current === 'string' ? current : ''} disabled={editing.readOnly} onCommit={(text) => setDefault(text === '' ? undefined : text)} />
        </Field>
      )
    case 'text':
      return (
        <Field label={messages().nodes.defaultValue} hint={messages().nodes.usedWhenItIsLeftEmpty}>
          <TextInput ariaLabel={messages().nodes.defaultValue} value={typeof current === 'string' ? current : ''} disabled={editing.readOnly} onCommit={(text) => setDefault(text === '' ? undefined : text)} />
        </Field>
      )
    default:
      return <JsonBox label={messages().nodes.defaultValue} value={current} hint={messages().nodes.jsonUsedWhenItIsLeft} onCommit={setDefault} />
  }
}

function ChoicesEditor({ variable, index, editing }: { variable: StartVariable; index: number; editing: RowEditing }) {
  const options = variableOptionsOf(variable)
  const label = variableLabelOf(variable) || messages().nodes.inputValue(index + 1)
  const write = (next: string[], what: string) => editing.edit((graph) => updateStartVariable(graph, editing.startId, index, (current) => changeVariableOptions(current, next)), `${what} of ${label}`)
  const duplicates = options.filter((option, optionIndex) => options.indexOf(option) !== optionIndex)
  return (
    <div role="group" aria-label={messages().nodes.choices} className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{messages().nodes.choices}</span>
      {options.map((option, optionIndex) => (
        <div key={optionIndex} className="flex items-center gap-1.5">
          <TextInput
            ariaLabel={messages().nodes.choiceValue(optionIndex + 1)}
            value={option}
            disabled={editing.readOnly}
            invalid={duplicates.includes(option)}
            onCommit={(text) => {
              const trimmed = text.trim()
              write(trimmed === '' ? options.filter((_unused, itemIndex) => itemIndex !== optionIndex) : options.map((item, itemIndex) => (itemIndex === optionIndex ? trimmed : item)), messages().nodes.changedTheChoices)
            }}
          />
          <RemoveButton label={messages().nodes.removeChoiceValue(optionIndex + 1)} disabled={editing.readOnly || options.length <= 1} onClick={() => write(options.filter((_unused, itemIndex) => itemIndex !== optionIndex), messages().nodes.removedAChoice)} />
        </div>
      ))}
      {duplicates.length > 0 && <p className="m-0 text-[12px] text-danger">{messages().nodes.eachChoiceNeedsADifferentText}</p>}
      <AddButton disabled={editing.readOnly} onClick={() => write([...options, messages().nodes.optionValue(options.length + 1)], messages().nodes.addedAChoice)}>
        {messages().nodes.addAChoice}
      </AddButton>
    </div>
  )
}

function VariableNameField({ variable, index, otherNames, editing, startId }: { variable: StartVariable; index: number; otherNames: string[]; editing: RowEditing; startId: string }) {
  const id = useId()
  const name = variableNameOf(variable)
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const problem = validateVariableName(draft, otherNames)
  const commit = () => {
    if (draft === name || problem) return
    editing.edit((graph) => renameStartVariable(graph, editing.startId, index, draft), messages().nodes.renamedInputValueToDraft(name || index + 1, draft))
  }
  return (
    <Field label={messages().nodes.variableName} htmlFor={id} error={draft !== name ? problem : null} hint={<>{messages().nodes.stepsReadItAs}{' '}<code className="font-mono text-[11px]">{formatReference([startId, problem ? name : draft])}</code>{messages().nodes.renamingUpdatesThem}</>}>
      <input
        id={id}
        type="text"
        value={draft}
        spellCheck={false}
        aria-invalid={draft !== name && problem ? true : undefined}
        disabled={editing.readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(name)
        }}
        className={joinClassNames(
          'box-border h-8 w-full min-w-0 rounded-lg border bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-ink disabled:bg-subtle',
          draft !== name && problem ? 'border-danger' : 'border-line-strong',
        )}
      />
    </Field>
  )
}

function DeleteWarning({ label, usages, onDelete, onKeep }: { label: string; usages: InputUsage[]; onDelete: () => void; onKeep: () => void }) {
  return (
    <div role="alertdialog" aria-label={messages().nodes.deleteLabel(label)} className="flex flex-col gap-2 rounded-lg border border-amber-line-2 bg-amber-tint px-2.5 py-2 text-[12px] leading-normal text-amber-deep">
      <p className="m-0">
        <b className="font-semibold">{joinTitles(usages)}</b> {usages.length === 1 ? 'uses' : 'use'} {messages().nodes.thisInputDeletingItLeaves}{' '}{usages.length === 1 ? messages().nodes.thatStep : messages().nodes.thoseSteps} {messages().nodes.readingAnEmptyValue}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onKeep} autoFocus className="h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink hover:bg-subtle">
          {messages().nodes.keepIt}
        </button>
        <button type="button" onClick={onDelete} className="h-7 cursor-pointer rounded-md border-0 bg-danger px-2.5 text-[12px] font-medium text-white hover:opacity-90">
          {messages().nodes.deleteAnyway}
        </button>
      </div>
    </div>
  )
}

interface StartInputRowProps {
  variable: StartVariable
  index: number
  count: number
  otherNames: string[]
  usages: InputUsage[]
  isExpanded: boolean
  isDropTarget: boolean
  isConfirmingDelete: boolean
  editing: RowEditing
  rowActions: RowActions
}

interface RowActions {
  toggleExpanded: (index: number) => void
  move: (from: number, to: number) => void
  duplicate: (index: number) => void
  requestDelete: (index: number) => void
  confirmDelete: (index: number) => void
  cancelDelete: () => void
  dragStart: (index: number, event: DragEvent) => void
  dragOver: (index: number, event: DragEvent) => void
  drop: (index: number, event: DragEvent) => void
  dragEnd: () => void
}

/** What every part of one input row needs: the input, where it sits and the edit callback. */
interface RowContext {
  variable: StartVariable
  index: number
  /** Shown name: the label, else "Input 3". */
  label: string
  editing: RowEditing
}

/** Drag handle; ArrowUp / ArrowDown on it move the row too. */
function ReorderHandle({ row, count, rowActions }: { row: RowContext; count: number; rowActions: RowActions }) {
  const { index, label, editing } = row
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      rowActions.move(index, index - 1)
    }
    if (event.key === 'ArrowDown' && index < count - 1) {
      event.preventDefault()
      rowActions.move(index, index + 1)
    }
  }
  return (
    <button
      type="button"
      draggable={!editing.readOnly}
      disabled={editing.readOnly}
      data-reorder-handle={index}
      aria-label={messages().nodes.reorderLabel(label)}
      aria-keyshortcuts="ArrowUp ArrowDown"
      title={messages().nodes.dragToReorderOrUseThe}
      onKeyDown={handleKeyDown}
      onDragStart={(event) => rowActions.dragStart(index, event)}
      onDragEnd={rowActions.dragEnd}
      className={joinClassNames(iconButtonClassNames, 'w-5 cursor-grab active:cursor-grabbing')}
    >
      <StrokeIcon size={14}>
        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
      </StrokeIcon>
    </button>
  )
}

/** The type picker; an unknown type (from JSON) stays selectable under its own name. */
function InputTypeSelect({ row }: { row: RowContext }) {
  const { variable, index, label, editing } = row
  const type = variableTypeOf(variable)
  const isKnownType = startInputTypes.some((inputType) => inputType.value === type)
  const typeOptions = [...startInputTypes.map((inputType) => ({ value: inputType.value, label: inputType.label })), ...(isKnownType ? [] : [{ value: type, label: describeStartInputType(type) }])]
  return (
    <SelectInput
      ariaLabel={messages().nodes.typeOfLabel(label)}
      value={type}
      disabled={editing.readOnly}
      options={typeOptions}
      className="!w-[100px] shrink-0"
      onChange={(nextType) => editing.edit((graph) => updateStartVariable(graph, editing.startId, index, (current) => changeVariableType(current, nextType)), messages().nodes.madeLabelALowercaseInput(label, describeStartInputType(nextType).toLowerCase()))}
    />
  )
}

/** First line of a row: handle, label, type and the expand toggle. */
function StartInputHeader({ row, count, isExpanded, detailsId, rowActions }: { row: RowContext; count: number; isExpanded: boolean; detailsId: string; rowActions: RowActions }) {
  const { variable, index, label, editing } = row
  const name = variableNameOf(variable)
  return (
    <div className="flex items-center gap-1">
      <ReorderHandle row={row} count={count} rowActions={rowActions} />
      <TextInput
        ariaLabel={messages().nodes.labelOfInputValue(index + 1)}
        value={typeof variable.label === 'string' ? variable.label : ''}
        placeholder={messages().nodes.labelEGAreaToSearch}
        disabled={editing.readOnly}
        onCommit={(text) => editing.edit((graph) => relabelStartVariable(graph, editing.startId, index, text.trim()), messages().nodes.relabelledInputValue(name || index + 1))}
      />
      <InputTypeSelect row={row} />
      <button
        type="button"
        aria-label={messages().nodes.toggleOptions(isExpanded, label)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => rowActions.toggleExpanded(index)}
        className={joinClassNames(iconButtonClassNames, 'transition-transform', isExpanded ? 'rotate-90' : '')}
      >
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  )
}

/** Second line of a row: Required, where it is used, duplicate and delete. */
function StartInputSummary({ row, usages, rowActions }: { row: RowContext; usages: InputUsage[]; rowActions: RowActions }) {
  const { variable, index, label, editing } = row
  return (
    <div className="flex items-center gap-2 pl-6">
      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={variable.required === true}
          disabled={editing.readOnly}
          aria-label={messages().nodes.labelIsRequired(label)}
          onChange={(event) =>
            editing.edit((graph) => updateStartVariable(graph, editing.startId, index, (current) => ({ ...current, required: event.target.checked })), `${event.target.checked ? 'required' : 'made optional'} ${label}`)
          }
          className="h-[14px] w-[14px] cursor-pointer accent-ink"
        />
        {messages().nodes.required2}
      </label>
      <span className={joinClassNames('min-w-0 flex-1 truncate text-[12px]', usages.length > 0 ? 'text-ink-2' : 'text-muted')} title={usages.length > 0 ? joinTitles(usages) : undefined}>
        {describeUsageCount(usages.length)}
      </span>
      <button type="button" aria-label={messages().nodes.duplicateLabel(label)} title={messages().nodes.duplicate} disabled={editing.readOnly} onClick={() => rowActions.duplicate(index)} className={joinClassNames(iconButtonClassNames, 'size-6')}>
        <StrokeIcon size={14}>
          <path d="M8 8h11v11H8zM5 16V5h11" />
        </StrokeIcon>
      </button>
      <button type="button" aria-label={messages().nodes.deleteLabel2(label)} title={messages().nodes.delete} disabled={editing.readOnly} onClick={() => rowActions.requestDelete(index)} className={joinClassNames(iconButtonClassNames, 'size-6')}>
        <Icon name="trash" size={14} />
      </button>
    </div>
  )
}

/** `variable` with `max_length` set to `maxLength`, or without it when null. */
function withMaxLength(variable: StartVariable, maxLength: number | null): StartVariable {
  const updated = { ...variable }
  if (maxLength === null) delete updated.max_length
  else updated.max_length = Math.round(maxLength)
  return updated
}

function MaxLengthField({ row }: { row: RowContext }) {
  const { variable, index, label, editing } = row
  return (
    <Field label={messages().nodes.maxLength} hint={messages().nodes.longestTextItAcceptsInCharacters}>
      <NumberInput
        ariaLabel={messages().nodes.maxLength}
        wide
        min={1}
        step={1}
        value={typeof variable.max_length === 'number' ? variable.max_length : null}
        disabled={editing.readOnly}
        onCommit={(next) => editing.edit((graph) => updateStartVariable(graph, editing.startId, index, (current) => withMaxLength(current, next)), messages().nodes.setTheMaxLengthOfLabel(label))}
      />
    </Field>
  )
}

/** The expanded part of a row: variable name, choices, default value and the type's options. */
function StartInputDetails({ row, otherNames, usages, detailsId }: { row: RowContext; otherNames: string[]; usages: InputUsage[]; detailsId: string }) {
  const { variable, index, editing } = row
  const type = variableTypeOf(variable)
  return (
    <div id={detailsId} className="flex flex-col gap-3 border-t border-chip px-1 pt-2.5 pb-1">
      <VariableNameField variable={variable} index={index} otherNames={otherNames} editing={editing} startId={editing.startId} />
      {type === 'select' && <ChoicesEditor variable={variable} index={index} editing={editing} />}
      <DefaultValueField variable={variable} index={index} editing={editing} />
      {takesMaxLength(type) && <MaxLengthField row={row} />}
      {usages.length > 0 && <p className={hintClassName}>{messages().nodes.usedBy}{' '}{joinTitles(usages)}</p>}
    </div>
  )
}

function StartInputRow({ variable, index, count, otherNames, usages, isExpanded, isDropTarget, isConfirmingDelete, editing, rowActions }: StartInputRowProps) {
  const detailsId = useId()
  const row: RowContext = { variable, index, label: variableLabelOf(variable) || messages().nodes.inputValue2(index + 1), editing }
  return (
    <li
      data-start-input={variableNameOf(variable)}
      onDragOver={(event) => rowActions.dragOver(index, event)}
      onDrop={(event) => rowActions.drop(index, event)}
      className={joinClassNames('flex flex-col gap-2 rounded-[10px] border bg-surface p-2', isDropTarget ? 'border-brand ring-2 ring-brand-line' : 'border-line')}
    >
      <StartInputHeader row={row} count={count} isExpanded={isExpanded} detailsId={detailsId} rowActions={rowActions} />
      <StartInputSummary row={row} usages={usages} rowActions={rowActions} />
      {isConfirmingDelete && <DeleteWarning label={row.label} usages={usages} onDelete={() => rowActions.confirmDelete(index)} onKeep={rowActions.cancelDelete} />}
      {isExpanded && <StartInputDetails row={row} otherNames={otherNames} usages={usages} detailsId={detailsId} />}
    </li>
  )
}

/** Keyboard reorder keeps focus on the moved row's handle. */
function useFocusHandleAfterMove(): (index: number) => void {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  useEffect(() => {
    if (focusIndex === null) return
    document.querySelector<HTMLButtonElement>(`[data-reorder-handle="${focusIndex}"]`)?.focus()
    setFocusIndex(null)
  }, [focusIndex])
  return setFocusIndex
}

/** Focuses the label of a just-added input. */
function useFocusLabelAfterAdd(): (index: number) => void {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  useEffect(() => {
    if (focusIndex === null) return
    document.querySelector<HTMLInputElement>(`input[aria-label="Label of input ${focusIndex + 1}"]`)?.focus()
    setFocusIndex(null)
  }, [focusIndex])
  return setFocusIndex
}

function useStartInputActions(editing: RowEditing, variables: StartVariable[], usagesByIndex: InputUsage[][]) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const focusHandle = useFocusHandleAfterMove()
  const labelOf = (index: number) => variableLabelOf(variables[index] ?? {}) || messages().nodes.inputValue(index + 1)
  const remove = (index: number) => {
    editing.edit((graph) => removeStartVariable(graph, editing.startId, index), messages().nodes.removedInputValue(labelOf(index)))
    setDeleteIndex(null)
    setExpandedIndex(null)
  }
  const move = (from: number, to: number) => {
    editing.edit((graph) => moveStartVariable(graph, editing.startId, from, to), messages().nodes.movedInputValue(labelOf(from)))
    setExpandedIndex((current) => (current === from ? to : current === to ? from : current))
    setDeleteIndex(null)
    focusHandle(to)
  }
  const rowActions: RowActions = {
    toggleExpanded: (index) => setExpandedIndex((current) => (current === index ? null : index)),
    move,
    duplicate: (index) => {
      editing.edit((graph) => duplicateStartVariable(graph, editing.startId, index), messages().nodes.duplicatedInputValue(labelOf(index)))
      setExpandedIndex(index + 1)
    },
    requestDelete: (index) => ((usagesByIndex[index]?.length ?? 0) > 0 ? setDeleteIndex(index) : remove(index)),
    confirmDelete: remove,
    cancelDelete: () => setDeleteIndex(null),
    dragStart: (index, event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(index))
      const row = (event.currentTarget as HTMLElement).closest('li')
      if (row) event.dataTransfer.setDragImage(row, 16, 16)
      setDragFrom(index)
    },
    dragOver: (index, event) => {
      if (dragFrom === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(index)
    },
    drop: (index, event) => {
      if (dragFrom === null) return
      event.preventDefault()
      if (dragFrom !== index) move(dragFrom, index)
      setDragFrom(null)
      setDropTarget(null)
    },
    dragEnd: () => {
      setDragFrom(null)
      setDropTarget(null)
    },
  }
  return { expandedIndex, setExpandedIndex, deleteIndex, dropTarget: dragFrom !== null && dropTarget !== dragFrom ? dropTarget : null, rowActions }
}

function JsonEscapeHatch({ variables, editing }: { variables: StartVariable[]; editing: RowEditing }) {
  const [isOpen, setIsOpen] = useState(false)
  const [shapeError, setShapeError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)} className={linkButtonClassName}>
        {isOpen ? messages().nodes.hideJson : messages().nodes.editAsJson}
      </button>
      {isOpen && (
        <JsonBox
          label={messages().nodes.inputsAsJson}
          value={variables}
          error={shapeError}
          hint={messages().nodes.advancedGraphrtStartVariablesVariableLabel}
          onCommit={(value) => {
            const isList = Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
            if (!isList) {
              setShapeError(messages().nodes.needsAListOfObjects)
              return
            }
            setShapeError(null)
            editing.edit((graph) => writeStartVariables(graph, editing.startId, value as StartVariable[]), messages().nodes.changedTheInputsAsJson)
          }}
        />
      )}
    </div>
  )
}

/** Settings of Start: its run inputs as an editable list. */
export function StartPanel() {
  const { node, graph, controller, readOnly } = useInspector()
  const variables = readStartVariables(node.config)
  const names = variables.map(variableNameOf)
  const usagesByIndex = names.map((name) => findInputUsages(graph, node.id, name))
  const editing: RowEditing = {
    startId: node.id,
    readOnly,
    edit: (change, what) => {
      if (!readOnly) controller.applyEdit(change, `${what} on ${node.displayTitle}`)
    },
  }
  const { expandedIndex, setExpandedIndex, deleteIndex, dropTarget, rowActions } = useStartInputActions(editing, variables, usagesByIndex)
  const focusLabel = useFocusLabelAfterAdd()
  const addInput = () => {
    const index = variables.length
    editing.edit((graph) => addStartVariable(graph, node.id).graph, messages().nodes.addedAnInput)
    setExpandedIndex(index)
    focusLabel(index)
  }
  return (
    <InspectorSection title={messages().nodes.inputs} badge={<span className="rounded-full bg-chip px-1.5 text-[11px] leading-[18px] font-medium text-ink-2">{variables.length}</span>} sectionKey="inputs">
      <p className={hintClassName}>{messages().nodes.whatAPersonFillsInWhen}</p>
      {variables.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-dashed border-line-strong px-3 py-3 text-center text-[12px] text-muted">{messages().nodes.noInputsYetTheAgentStarts}</p>
      ) : (
        <ol aria-label={messages().nodes.inputs} className="m-0 flex list-none flex-col gap-1.5 p-0">
          {variables.map((variable, index) => (
            <StartInputRow
              key={`${index}-${names[index]}`}
              variable={variable}
              index={index}
              count={variables.length}
              otherNames={names.filter((_unused, itemIndex) => itemIndex !== index)}
              usages={usagesByIndex[index] ?? []}
              isExpanded={expandedIndex === index}
              isDropTarget={dropTarget === index}
              isConfirmingDelete={deleteIndex === index}
              editing={editing}
              rowActions={rowActions}
            />
          ))}
        </ol>
      )}
      <button
        type="button"
        disabled={readOnly}
        onClick={addInput}
        className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-transparent px-3 text-[13px] font-medium text-ink-2 hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="plus" size={14} />
        {messages().nodes.addAnInput}
      </button>
      <JsonEscapeHatch variables={variables} editing={editing} />
    </InspectorSection>
  )
}
