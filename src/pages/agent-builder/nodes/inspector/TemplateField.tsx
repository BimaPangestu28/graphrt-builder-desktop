import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { checkReference, type ReferenceCheck, type ValueGroup } from './availableValues'
import { Field, linkButtonClassName } from './fields'
import { useInspector } from './InspectorContext'
import { describeReference, formatReference, templateReferences } from './references'
import { createChip, currentRange, insertChipAtCaret, insertNodeAtRange, renderTemplateInto, serializeEditor } from './templateEditorDom'
import { ValuePicker } from './ValuePicker'

/**
 * Template text with value chips (spec B6): references show as chips
 * (`{{#for_each_place.item.phone#}}` → "phone"), "Insert value" opens the picker and
 * inserts at the cursor, "Show as text" reveals the raw `{{#…#}}` form. A reference to a
 * step that does not exist (or is out of reach) is marked and explained under the field.
 * The text commits on blur, so one edit is one undo step. The chip DOM lives in
 * `templateEditorDom.ts`.
 */

export { serializeEditor } from './templateEditorDom'

interface TemplateFieldProps {
  label: ReactNode
  value: string
  onCommit: (value: string) => void
  required?: boolean
  multiline?: boolean
  placeholder?: string
  hint?: ReactNode
  /** Problem shown when the field is empty but required, or another rule fails. */
  error?: string | null
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string
  /** Config path a `requestedSection` can name to focus this field (`url`). */
  fieldPath?: string
}

interface ReferenceProblem {
  path: string[]
  check: ReferenceCheck
}

/** Invalid references of a template, with plain words, for the messages under the field. */
function referenceProblems(template: string, graph: AgentGraph, groups: ValueGroup[]): ReferenceProblem[] {
  return templateReferences(template).flatMap((path) => {
    const check = checkReference(path, graph, groups)
    return check.status === 'ok' ? [] : [{ path, check }]
  })
}

/** Inserts `text` at the caret and reports the editor's new template text. */
function insertTextAtCaret(editor: HTMLElement, text: string, onChange: (template: string) => void): void {
  insertNodeAtRange(editor, document.createTextNode(text), currentRange())
  onChange(serializeEditor(editor))
}

interface ChipEditorProps {
  id: string
  editorRef: RefObject<HTMLDivElement>
  ariaLabel: string | undefined
  placeholder?: string
  multiline: boolean
  readOnly: boolean
  /** Tracks focus so the field does not rebuild the DOM under the caret. */
  isFocusedRef: MutableRefObject<boolean>
  onDraftChange: (template: string) => void
  onCommit: (template: string) => void
  saveSelection: () => void
}

/**
 * The contentEditable box with chips. Enter blurs (commits) a single-line field and
 * inserts a new line in a multiline one; pasting keeps plain text only.
 */
function ChipEditor({ id, editorRef, ariaLabel, placeholder, multiline, readOnly, isFocusedRef, onDraftChange, onCommit, saveSelection }: ChipEditorProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!multiline) {
      event.currentTarget.blur()
      return
    }
    insertTextAtCaret(event.currentTarget, '\n', onDraftChange)
  }
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    insertTextAtCaret(event.currentTarget, event.clipboardData.getData('text/plain'), onDraftChange)
  }
  return (
    <div
      id={id}
      ref={editorRef}
      role="textbox"
      aria-multiline={multiline}
      aria-label={ariaLabel}
      aria-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={() => {
        isFocusedRef.current = true
      }}
      onBlur={(event) => {
        isFocusedRef.current = false
        saveSelection()
        onCommit(serializeEditor(event.currentTarget))
      }}
      onInput={(event) => onDraftChange(serializeEditor(event.currentTarget))}
      onKeyUp={saveSelection}
      onMouseUp={saveSelection}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={joinClassNames(
        'box-border min-h-9 w-full rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-[1.7] break-words whitespace-pre-wrap text-ink outline-none focus:border-ink',
        multiline ? 'min-h-[76px]' : '',
        readOnly ? 'bg-subtle text-muted' : '',
        "empty:before:text-faint empty:before:content-[attr(data-placeholder)]",
      )}
    />
  )
}

/** One message per broken reference, each with a way to pick a replacement. */
function ReferenceProblemList({ problems, graph, readOnly, onReplace }: { problems: ReferenceProblem[]; graph: AgentGraph; readOnly: boolean; onReplace: (path: string[]) => void }) {
  return (
    <>
      {problems.map(({ path, check }) => (
        <p key={path.join('.')} role="alert" className={joinClassNames('m-0 text-[12px]', check.status === 'unknown-step' ? 'text-danger' : 'text-amber-strong')}>
          <b className="font-semibold">{describeReference(path, graph)}</b>: {check.message} ·{' '}
          <button type="button" className={linkButtonClassName} disabled={readOnly} onClick={() => onReplace(path)}>
            Pick another value
          </button>
        </p>
      ))}
    </>
  )
}

/** The draft text and its commit: committing only calls `onCommit` when the text changed. */
function useTemplateDraft(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (nextValue: string) => {
    setDraft(nextValue)
    if (nextValue !== value) onCommit(nextValue)
  }
  return { draft, setDraft, commit }
}

export function TemplateField({ label, value, onCommit, required, multiline = false, placeholder, hint, error, ariaLabel, fieldPath }: TemplateFieldProps) {
  const { graph, valueGroups, readOnly } = useInspector()
  const editorId = useId()
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const isFocusedRef = useRef(false)
  const { draft, setDraft, commit } = useTemplateDraft(value, onCommit)
  const [showAsText, setShowAsText] = useState(false)
  const [picker, setPicker] = useState<{ replacing: string[] | null } | null>(null)

  // The editor's DOM is built here, not by React, so typing never fights reconciliation.
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || isFocusedRef.current) return
    if (serializeEditor(editor) !== draft || editor.childNodes.length === 0) renderTemplateInto(editor, draft, graph, valueGroups)
  }, [draft, graph, valueGroups, showAsText])

  const saveSelection = () => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) savedRangeRef.current = selection.getRangeAt(0).cloneRange()
  }

  const pick = (path: string[]) => {
    const replacing = picker?.replacing ?? null
    setPicker(null)
    if (replacing) {
      commit(draft.split(formatReference(replacing)).join(formatReference(path)))
      return
    }
    const editor = editorRef.current
    if (showAsText || !editor) {
      commit(`${draft}${formatReference(path)}`)
      return
    }
    // Focus moves back into the editor here, so the commit below does not rebuild its DOM.
    savedRangeRef.current = insertChipAtCaret(editor, createChip(path, graph, valueGroups), savedRangeRef.current)
    commit(serializeEditor(editor))
  }

  const accessibleName = ariaLabel ?? (typeof label === 'string' ? label : undefined)
  const isEmpty = draft.trim() === ''

  return (
    <Field label={label} htmlFor={editorId} fieldPath={fieldPath} required={required} hint={hint} error={error ?? (required && isEmpty ? 'Required' : null)}>
      {showAsText ? (
        <textarea
          id={editorId}
          aria-label={accessibleName}
          value={draft}
          disabled={readOnly}
          rows={multiline ? 4 : 2}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          className="box-border w-full resize-y rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] leading-normal outline-none focus:border-ink"
        />
      ) : (
        <ChipEditor
          id={editorId}
          editorRef={editorRef}
          ariaLabel={accessibleName}
          placeholder={placeholder}
          multiline={multiline}
          readOnly={readOnly}
          isFocusedRef={isFocusedRef}
          onDraftChange={setDraft}
          onCommit={commit}
          saveSelection={saveSelection}
        />
      )}
      <ReferenceProblemList problems={referenceProblems(draft, graph, valueGroups)} graph={graph} readOnly={readOnly} onReplace={(path) => setPicker({ replacing: path })} />
      <div className="flex items-center gap-3">
        <button type="button" className={linkButtonClassName} disabled={readOnly} onMouseDown={saveSelection} onClick={() => setPicker(picker ? null : { replacing: null })}>
          Insert value {'{'}
        </button>
        <button type="button" className={joinClassNames(linkButtonClassName, 'text-muted')} onClick={() => setShowAsText((shown) => !shown)}>
          {showAsText ? 'Show as chips' : 'Show as text'}
        </button>
      </div>
      {picker && <ValuePicker groups={valueGroups} onPick={pick} onClose={() => setPicker(null)} />}
    </Field>
  )
}
