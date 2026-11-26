import type { AdaptiveCard, CardNode } from '../uiBlockTypes'

/**
 * Behaviour of an Adaptive Card, independent of React: its inputs and their starting values, which answer
 * of a paused step a button stands for, and what a submit sends (`{ action, values }`, the `human-input`
 * resume answer).
 */

export type CardValues = Record<string, string>

export interface CardInput {
  id: string
  type: string
  label: string
  isRequired: boolean
  node: CardNode
}

const containerKeys = ['body', 'items', 'columns', 'rows', 'cells'] as const

/** Every node of a card in document order, including the cards inside Action.ShowCard. */
function walk(nodes: unknown, visit: (node: CardNode) => void): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const element = node as CardNode
    if (typeof element.type === 'string') visit(element)
    for (const key of containerKeys) walk(element[key], visit)
    if (element.type === 'Action.ShowCard' && element.card && typeof element.card === 'object') walkCard(element.card as AdaptiveCard, visit)
    if (Array.isArray(element.actions)) walk(element.actions, visit)
    if (element.fallback && typeof element.fallback === 'object' && !(String(element.type) in knownTypes)) walk([element.fallback], visit)
  }
}

function walkCard(card: AdaptiveCard, visit: (node: CardNode) => void): void {
  walk(card.body, visit)
  walk(card.actions, visit)
}

/** Element types the renderer draws; others show their `fallback`. */
export const knownTypes: Record<string, true> = Object.fromEntries(
  [
    'TextBlock', 'RichTextBlock', 'Image', 'ImageSet', 'Container', 'ColumnSet', 'Column', 'FactSet', 'ActionSet', 'Table',
    'Input.Text', 'Input.Number', 'Input.Date', 'Input.Time', 'Input.Toggle', 'Input.ChoiceSet',
  ].map((type) => [type, true]),
)

const text = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null)

/** The card's inputs, in document order. */
export function collectInputs(card: AdaptiveCard): CardInput[] {
  const inputs: CardInput[] = []
  walkCard(card, (node) => {
    if (!String(node.type).startsWith('Input.') || typeof node.id !== 'string') return
    inputs.push({ id: node.id, type: node.type, label: text(node.label) ?? text(node.title) ?? text(node.placeholder) ?? node.id, isRequired: node.isRequired === true, node })
  })
  return inputs
}

/** Toggle values as Adaptive Cards define them: `valueOn` / `valueOff`, "true" / "false" by default. */
export function toggleValues(node: CardNode): { on: string; off: string } {
  return { on: text(node.valueOn) ?? 'true', off: text(node.valueOff) ?? 'false' }
}

/** Starting values: each input's `value` (a Toggle starts off unless its value is `valueOn`). */
export function initialCardValues(inputs: CardInput[]): CardValues {
  return Object.fromEntries(
    inputs.map((input) => {
      const value = text(input.node.value)
      if (input.type === 'Input.Toggle') {
        const { on, off } = toggleValues(input.node)
        return [input.id, value === on ? on : off]
      }
      return [input.id, value ?? '']
    }),
  )
}

/** Labels of required inputs that are still empty. */
export function missingRequiredInputs(inputs: CardInput[], values: CardValues): string[] {
  return inputs.filter((input) => input.isRequired && input.type !== 'Input.Toggle' && (values[input.id] ?? '').trim() === '').map((input) => input.label)
}

/** The answer key of a submit button: Execute's `verb`, else the action `id`, else `data.action`, else its title. */
export function actionKey(action: CardNode): string | null {
  if (action.type === 'Action.Execute' && typeof action.verb === 'string' && action.verb) return action.verb
  if (typeof action.id === 'string' && action.id) return action.id
  const data = action.data
  if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).action === 'string') return (data as Record<string, string>).action
  return text(action.title)
}

/**
 * The paused step's action a button answers with: the same id (or the same id ignoring case), or the step's
 * only action. Null when the button matches none, so it stays disabled rather than guessing.
 *
 * @param key - From {@link actionKey} (string | null)
 * @param allowedActionIds - The step's action ids (string[])
 */
export function resolveAnswerAction(key: string | null, allowedActionIds: string[]): string | null {
  if (key !== null) {
    if (allowedActionIds.includes(key)) return key
    const match = allowedActionIds.find((id) => id.toLowerCase() === key.toLowerCase())
    if (match) return match
  }
  return allowedActionIds.length === 1 ? allowedActionIds[0] : null
}

function typedValue(input: CardInput, raw: string): unknown {
  if (input.type === 'Input.Number') {
    const number = Number(raw)
    return raw.trim() !== '' && Number.isFinite(number) ? number : null
  }
  if (input.type === 'Input.Toggle') {
    const { on, off } = toggleValues(input.node)
    return on === 'true' && off === 'false' ? raw === 'true' : raw
  }
  return raw
}

/**
 * The values a submit sends: the action's `data` fields, then every input (numbers as numbers, default
 * toggles as booleans). With `associatedInputs: "none"` only the data.
 *
 * @param action - The Submit or Execute action (CardNode)
 * @param inputs - The card's inputs (CardInput[])
 * @param values - Their current values (CardValues)
 */
export function buildSubmissionValues(action: CardNode, inputs: CardInput[], values: CardValues): Record<string, unknown> {
  const data = action.data && typeof action.data === 'object' ? { ...(action.data as Record<string, unknown>) } : {}
  if (String(action.associatedInputs ?? '').toLowerCase() === 'none') return data
  for (const input of inputs) data[input.id] = typedValue(input, values[input.id] ?? '')
  return data
}
