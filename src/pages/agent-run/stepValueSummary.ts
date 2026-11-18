import { describeItemShort, findArrays, isRecord, truncateText } from './runEventValues'

/**
 * Short, readable forms of step inputs and outputs for the expanded step rows and the narration:
 * lists as "10 items" with the first few, objects as pretty JSON cut to a few lines.
 */

export interface ValueSummaryEntry {
  key: string
  text: string
}

const maxTextLength = 600
const maxJsonLength = 600
const listPreviewCount = 3

function describeListItem(item: unknown): string {
  return describeItemShort(item, 80) ?? truncateText(JSON.stringify(item) ?? String(item), 80)
}

/**
 * One value as display text.
 *
 * @example
 * describeValue([{ name: 'A' }, { name: 'B' }]) // "2 items\n• A\n• B"
 */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'string') return truncateText(value, maxTextLength)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const countLine = value.length === 1 ? '1 item' : `${value.length} items`
    const previewLines = value.slice(0, listPreviewCount).map((item) => `• ${describeListItem(item)}`)
    const moreLine = value.length > listPreviewCount ? [`… and ${value.length - listPreviewCount} more`] : []
    return [countLine, ...previewLines, ...moreLine].join('\n')
  }
  return truncateText(JSON.stringify(value, null, 2) ?? String(value), maxJsonLength)
}

/** Each top-level field of a step's outputs (or inputs) as display text. */
export function summarizeValues(values: unknown, skippedKeys: string[] = []): ValueSummaryEntry[] {
  if (values === undefined || values === null) return []
  if (!isRecord(values)) return [{ key: 'value', text: describeValue(values) }]
  return Object.entries(values)
    .filter(([key]) => !skippedKeys.includes(key))
    .map(([key, value]) => ({ key, text: describeValue(value) }))
}

/** A model step's final text: its `text` (or `answer`) output. */
export function readFinalText(outputs: Record<string, unknown> | null): string | null {
  for (const key of ['text', 'answer']) {
    const value = outputs?.[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

const genericListKeys = new Set(['', 'output', 'outputs', 'items', 'results', 'result', 'data', 'body', 'list', 'value', 'values', 'json', 'errors'])

function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim().toLowerCase()
}

function nounFor(key: string, count: number): string {
  const noun = genericListKeys.has(key) ? 'results' : humanizeKey(key)
  return count === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun
}

/**
 * "found 18 places" from a step's outputs: a `<things>_found` / `<things>_count` number, or
 * the first list. Null when the outputs hold neither.
 */
export function describeFoundCount(outputs: Record<string, unknown> | null): string | null {
  if (!outputs) return null
  for (const [key, value] of Object.entries(outputs)) {
    const countMatch = /^(.+?)_(?:found|count)$/.exec(key)
    if (countMatch && typeof value === 'number') return `found ${value} ${nounFor(countMatch[1], value)}`
  }
  const firstList = findArrays(outputs, 2).find((found) => found.key !== 'errors')
  return firstList ? `found ${firstList.items.length} ${nounFor(firstList.key, firstList.items.length)}` : null
}
