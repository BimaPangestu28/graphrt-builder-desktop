import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { checkReference, type ReferenceCheck, type ValueGroup } from './availableValues'
import { Field, linkButtonClassName } from './fields'
import { useInspector } from './InspectorContext'
import { describeReference, formatReference, parseTemplate, templateReferences } from './references'
import { ValuePicker } from './ValuePicker'

/**
 * Template text with value chips (spec B6): references show as chips
 * (`{{#for_each_place.item.phone#}}` → "phone"), "Insert value" opens the picker and
 * inserts at the cursor, "Show as text" reveals the raw `{{#…#}}` form. A reference to a
 * step that does not exist (or is out of reach) is marked and explained under the field.
 * The text commits on blur, so one edit is one undo step.
 */

const referenceAttribute = 'data-reference'

const chipClassNames: Record<ReferenceCheck['status'], string> = {
  ok: 'bg-brand-soft text-brand-strong',
  'unknown-step': 'bg-danger-soft text-danger line-through decoration-1',
  'out-of-scope': 'bg-amber-soft text-amber-strong',
}

function createChip(path: string[], graph: AgentGraph, groups: ValueGroup[]): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.setAttribute(referenceAttribute, path.join('.'))
  chip.contentEditable = 'false'
  chip.title = formatReference(path)
  chip.className = joinClassNames('mx-px inline-block rounded-[5px] px-[5px] font-medium', chipClassNames[checkReference(path, graph, groups).status])
  chip.textContent = describeReference(path, graph)
  return chip
}

function renderTemplateInto(element: HTMLElement, template: string, graph: AgentGraph, groups: ValueGroup[]): void {
  const nodes = parseTemplate(template).map((part) => (part.type === 'text' ? document.createTextNode(part.text) : createChip(part.path, graph, groups)))
  element.replaceChildren(...nodes)
}

/** The template text an editor's DOM stands for (chips back to `{{#…#}}`). */
export function serializeEditor(element: Node): string {
  let text = ''
  element.childNodes.forEach((child, index) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? ''
      return
    }
    if (!(child instanceof HTMLElement)) return
    const reference = child.getAttribute(referenceAttribute)
    if (reference) {
      text += formatReference(reference.split('.'))
      return
    }
    if (child.tagName === 'BR') {
      text += '\n'
      return
    }
    // Browsers wrap new lines in <div>s when Enter slips through.
    const isBlock = child.tagName === 'DIV' || child.tagName === 'P'
    text += `${isBlock && index > 0 ? '\n' : ''}${serializeEditor(child)}`
  })
  return text
}

function insertNodeAtRange(editor: HTMLElement, node: Node, savedRange: Range | null): void {
  const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange : null
  if (!range) {
    editor.appendChild(node)
    return
  }
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

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
}

/** Invalid references of a template, with plain words, for the messages under the field. */
function referenceProblems(template: string, graph: AgentGraph, groups: ValueGroup[]) {
  return templateReferences(template).flatMap((path) => {
    const check = checkReference(path, graph, groups)
    return check.status === 'ok' ? [] : [{ path, check }]
  })
}

export function TemplateField({ label, value, onCommit, required, multiline = false, placeholder, hint, error, ariaLabel }: TemplateFieldProps) {
  const { graph, valueGroups, readOnly } = useInspector()
  const editorId = useId()
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [draft, setDraft] = useState(value)
  const [showAsText, setShowAsText] = useState(false)
  const [picker, setPicker] = useState<{ replacing: string[] | null } | null>(null)
  const isFocusedRef = useRef(false)

  useEffect(() => setDraft(value), [value])

  // The editor's DOM is built here, not by React, so typing never fights reconciliation.
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || isFocusedRef.current) return
    if (serializeEditor(editor) !== draft || editor.childNodes.length === 0) renderTemplateInto(editor, draft, graph, valueGroups)
  }, [draft, graph, valueGroups, showAsText])

  const commit = (nextValue: string) => {
    setDraft(nextValue)
    if (nextValue !== value) onCommit(nextValue)
  }

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
    insertNodeAtRange(editor, createChip(path, graph, valueGroups), savedRangeRef.current)
    commit(serializeEditor(editor))
  }

  const problems = referenceProblems(draft, graph, valueGroups)
  const isEmpty = draft.trim() === ''

  return (
    <Field label={label} htmlFor={editorId} required={required} hint={hint} error={error ?? (required && isEmpty ? 'Required' : null)}>
      {showAsText ? (
        <textarea
          id={editorId}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          value={draft}
          disabled={readOnly}
          rows={multiline ? 4 : 2}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          className="box-border w-full resize-y rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] leading-normal outline-none focus:border-ink"
        />
      ) : (
        <div
          id={editorId}
          ref={editorRef}
          role="textbox"
          aria-multiline={multiline}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
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
            commit(serializeEditor(event.currentTarget))
          }}
          onInput={(event) => setDraft(serializeEditor(event.currentTarget))}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (!multiline) {
              event.currentTarget.blur()
              return
            }
            const selection = window.getSelection()
            insertNodeAtRange(event.currentTarget, document.createTextNode('\n'), selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null)
            setDraft(serializeEditor(event.currentTarget))
          }}
          onPaste={(event) => {
            event.preventDefault()
            const pasted = event.clipboardData.getData('text/plain')
            const selection = window.getSelection()
            insertNodeAtRange(event.currentTarget, document.createTextNode(pasted), selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null)
            setDraft(serializeEditor(event.currentTarget))
          }}
          className={joinClassNames(
            'box-border min-h-9 w-full rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-[1.7] break-words whitespace-pre-wrap text-ink outline-none focus:border-ink',
            multiline ? 'min-h-[76px]' : '',
            readOnly ? 'bg-subtle text-muted' : '',
            "empty:before:text-faint empty:before:content-[attr(data-placeholder)]",
          )}
        />
      )}
      {problems.map(({ path, check }) => (
        <p key={path.join('.')} role="alert" className={joinClassNames('m-0 text-[12px]', check.status === 'unknown-step' ? 'text-danger' : 'text-amber-strong')}>
          <b className="font-semibold">{describeReference(path, graph)}</b>: {check.message} ·{' '}
          <button type="button" className={linkButtonClassName} disabled={readOnly} onClick={() => setPicker({ replacing: path })}>
            Pick another value
          </button>
        </p>
      ))}
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
