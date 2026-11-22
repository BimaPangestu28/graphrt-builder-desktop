import type { AgentGraph } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { checkReference, type ReferenceCheck, type ValueGroup } from './availableValues'
import { describeReference, formatReference, parseTemplate } from './references'

/**
 * The DOM side of the template editor ({@link TemplateField}): references are
 * non-editable chip spans inside a contentEditable box, built here rather than by React
 * so typing never fights reconciliation. {@link serializeEditor} turns the DOM back
 * into `{{#…#}}` template text.
 */

const referenceAttribute = 'data-reference'

const chipClassNames: Record<ReferenceCheck['status'], string> = {
  ok: 'bg-brand-soft text-brand-strong',
  'unknown-step': 'bg-danger-soft text-danger line-through decoration-1',
  'out-of-scope': 'bg-amber-soft text-amber-strong',
}

export function createChip(path: string[], graph: AgentGraph, groups: ValueGroup[]): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.setAttribute(referenceAttribute, path.join('.'))
  chip.contentEditable = 'false'
  chip.title = formatReference(path)
  chip.className = joinClassNames('mx-px inline-block rounded-[5px] px-[5px] font-medium', chipClassNames[checkReference(path, graph, groups).status])
  chip.textContent = describeReference(path, graph)
  return chip
}

/**
 * A zero-width space beside a chip that has no text next to it. Chips are not editable,
 * so without a text node after (or before) one the caret has nowhere to go: WebKit puts
 * typed text inside the chip or drops the caret. Never saved (see {@link serializeEditor}).
 */
const caretSpot = '​'

function isChip(node: Node | null): boolean {
  return node instanceof HTMLElement && node.hasAttribute(referenceAttribute)
}

/** Adds a {@link caretSpot} text node on each side of `chip` that has no text node. */
function ensureCaretSpots(chip: Node): void {
  if (chip.previousSibling === null || isChip(chip.previousSibling)) chip.parentNode?.insertBefore(document.createTextNode(caretSpot), chip)
  if (chip.nextSibling === null || isChip(chip.nextSibling)) chip.parentNode?.insertBefore(document.createTextNode(caretSpot), chip.nextSibling)
}

export function renderTemplateInto(element: HTMLElement, template: string, graph: AgentGraph, groups: ValueGroup[]): void {
  const nodes = parseTemplate(template).map((part) => (part.type === 'text' ? document.createTextNode(part.text) : createChip(part.path, graph, groups)))
  element.replaceChildren(...nodes)
  nodes.filter(isChip).forEach(ensureCaretSpots)
}

/** The template text an editor's DOM stands for (chips back to `{{#…#}}`, caret spots dropped). */
export function serializeEditor(element: Node): string {
  let text = ''
  element.childNodes.forEach((child, index) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += (child.textContent ?? '').replaceAll(caretSpot, '')
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

export function insertNodeAtRange(editor: HTMLElement, node: Node, savedRange: Range | null): void {
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

/**
 * Inserts a chip at the saved caret (or at the end), gives the editor focus back and
 * puts the caret right after the chip, so typing goes on after it.
 *
 * @returns The caret after the chip, to remember for the next insert (Range)
 */
export function insertChipAtCaret(editor: HTMLElement, chip: HTMLElement, savedRange: Range | null): Range {
  const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange : null
  if (range) {
    range.deleteContents()
    range.insertNode(chip)
  } else {
    editor.appendChild(chip)
  }
  ensureCaretSpots(chip)
  // Empty text nodes left by splitting a text node at its edge only confuse the caret.
  for (const child of [...editor.childNodes]) if (child.nodeType === Node.TEXT_NODE && child.textContent === '') child.remove()
  const after = chip.nextSibling ?? editor.appendChild(document.createTextNode(caretSpot))
  editor.focus()
  const caret = document.createRange()
  // Inside the text after the chip (after a caret spot), never "after the chip" in the editor.
  caret.setStart(after, after.textContent === caretSpot ? 1 : 0)
  caret.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(caret)
  return caret.cloneRange()
}

/** The caret range of the current selection, or null when there is none. */
export function currentRange(): Range | null {
  const selection = window.getSelection()
  return selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
}
