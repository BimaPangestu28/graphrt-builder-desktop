/**
 * Makes the data inside an approval question readable. A step's prompt may carry a whole
 * object, which the workflow writes out as one line of JSON ("Isi invoice: {"number":…}").
 * A person approving an invoice should see its client, items and tax, not brackets and quotes,
 * so each JSON object or list in the prompt becomes a short outline:
 *
 * ```text
 * Number: INV-2026-0001
 * Client: PT Maju Bersama
 * Items:
 *   1. Desain antarmuka · quantity 3 · unit hari · unit price 1500000
 * ```
 *
 * Text that is not JSON is left exactly as written.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const listIndent = '  '
const partSeparator = ' · '

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** "unit_price" → "unit price". */
function readableKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim()
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function describeScalar(value: string | number | boolean | null): string {
  return value === null ? '-' : String(value)
}

/** One line for a value inside a list or a field: a record becomes "name · key value · key value". */
function describeInline(value: JsonValue): string {
  if (Array.isArray(value)) return value.map(describeInline).join(', ')
  if (!isRecord(value)) return describeScalar(value)
  const entries = Object.entries(value)
  if (entries.length === 1) return describeInline(entries[0][1])
  return entries
    .map(([key, fieldValue], index) => {
      const text = describeInline(fieldValue)
      // The first text field names the thing ("Desain antarmuka"), so its key adds nothing.
      return index === 0 && typeof fieldValue === 'string' ? text : `${readableKey(key)} ${text}`
    })
    .join(partSeparator)
}

function describeField(key: string, value: JsonValue): string[] {
  const label = capitalize(readableKey(key))
  if (Array.isArray(value) && value.some(isRecord)) {
    return [`${label}:`, ...value.map((item, index) => `${listIndent}${index + 1}. ${describeInline(item)}`)]
  }
  return [`${label}: ${describeInline(value)}`]
}

function describeJson(value: JsonValue): string[] {
  if (isRecord(value)) return Object.entries(value).flatMap(([key, fieldValue]) => describeField(key, fieldValue))
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${describeInline(item)}`)
  return [describeScalar(value)]
}

/** The JSON object or list `text` is, or undefined when it is anything else. */
function parseJsonContainer(text: string): JsonValue | undefined {
  const trimmed = text.trim()
  const isContainer = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!isContainer) return undefined
  try {
    const parsed = JSON.parse(trimmed) as JsonValue
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * `prompt` with every line that is a JSON object or list (alone, or after a "Label:") turned
 * into an outline. Show the result with `white-space: pre-wrap` so the list indent stays.
 *
 * @param prompt - The approval's description, possibly several lines (string)
 * @returns The same text with its JSON made readable (string)
 *
 * @example
 * readablePrompt('Isi invoice: {"number":"INV-1","items":[{"description":"Desain","quantity":3}]}')
 * // "Isi invoice:\nNumber: INV-1\nItems:\n  1. Desain · quantity 3"
 */
export function readablePrompt(prompt: string): string {
  return prompt
    .split('\n')
    .flatMap((line) => {
      const whole = parseJsonContainer(line)
      if (whole !== undefined) return describeJson(whole)
      // "Isi invoice: {…}": a label, then the data.
      const labelEnd = line.search(/:\s*[[{]/)
      if (labelEnd < 0) return [line]
      const labelled = parseJsonContainer(line.slice(labelEnd + 1))
      return labelled === undefined ? [line] : [line.slice(0, labelEnd + 1), ...describeJson(labelled)]
    })
    .join('\n')
}
