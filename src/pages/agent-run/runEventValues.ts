import type { GraphrtEvent, RunEventRecord } from '@/api/types'

/**
 * Small readers for graphrt event fields shared by the step list and the narration:
 * frames (`"each_place[3]"`, `"outer[2]/inner[0]"`), iteration items and output values.
 */

/** One `<container>[<index>]` segment of a graphrt frame id. */
export interface FrameSegment {
  containerId: string
  index: number
}

const frameSegmentPattern = /^(.+)\[(\d+)\]$/

/** Reads an event's frame; events without one (older rows, the sample run) are top level. */
export function readFrame(event: GraphrtEvent): string {
  return typeof event.frame === 'string' ? event.frame : ''
}

/**
 * Splits a frame id into its container segments.
 *
 * @example
 * parseFrame('outer[2]/inner[0]') // [{ containerId: 'outer', index: 2 }, { containerId: 'inner', index: 0 }]
 */
export function parseFrame(frame: string): FrameSegment[] {
  if (!frame) return []
  return frame.split('/').flatMap((segment) => {
    const match = frameSegmentPattern.exec(segment)
    return match ? [{ containerId: match[1], index: Number(match[2]) }] : []
  })
}

/** The frame a container's item `index` runs in, given the frame the container itself runs in. */
export function buildItemFrame(containerFrame: string, containerId: string, index: number): string {
  const segment = `${containerId}[${index}]`
  return containerFrame ? `${containerFrame}/${segment}` : segment
}

export function readString(event: GraphrtEvent, fieldName: string): string | null {
  const fieldValue = event[fieldName]
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : null
}

export function readNumber(source: unknown, fieldName: string): number | null {
  if (!isRecord(source)) return null
  const fieldValue = source[fieldName]
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

/** Fields that usually name a list item (a place, a business, a contact), most telling first. */
const itemLabelFields = ['name', 'title', 'label', 'displayName', 'display_name', 'business_name', 'place_name', 'company', 'email', 'subject', 'id']

function readLabelField(item: Record<string, unknown>, fieldName: string): string | null {
  const fieldValue = item[fieldName]
  if (typeof fieldValue === 'string' && fieldValue.trim()) return fieldValue.trim()
  if (typeof fieldValue === 'number') return String(fieldValue)
  // Google Places returns `displayName: { text, languageCode }`.
  if (isRecord(fieldValue) && typeof fieldValue.text === 'string' && fieldValue.text.trim()) return fieldValue.text.trim()
  return null
}

/**
 * A short label for a list item: the text itself, or its name/title-like field.
 *
 * @returns The label, or null when the item has nothing readable (string | null)
 * @example
 * describeItemShort({ name: 'Kopi Kenangan', phone: '+62…' }) // "Kopi Kenangan"
 */
export function describeItemShort(item: unknown, maxLength = 48): string | null {
  if (typeof item === 'string') return item.trim() ? truncateText(item.trim(), maxLength) : null
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (!isRecord(item)) return null
  for (const fieldName of itemLabelFields) {
    const label = readLabelField(item, fieldName)
    if (label) return truncateText(label, maxLength)
  }
  return null
}

/** Arrays inside a value, breadth first, at most `maxDepth` levels down, with the key holding each. */
export function findArrays(value: unknown, maxDepth = 3): Array<{ key: string; items: unknown[] }> {
  const found: Array<{ key: string; items: unknown[] }> = []
  let level: Array<{ key: string; value: unknown }> = [{ key: '', value }]
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth += 1) {
    const nextLevel: Array<{ key: string; value: unknown }> = []
    for (const entry of level) {
      if (Array.isArray(entry.value)) found.push({ key: entry.key, items: entry.value })
      else if (isRecord(entry.value)) Object.entries(entry.value).forEach(([key, child]) => nextLevel.push({ key, value: child }))
    }
    level = nextLevel
  }
  return found
}

/** Values a node may have read its list from: earlier outputs, variable writes and the run inputs. */
function readCandidateValue(event: GraphrtEvent): unknown {
  if (event.type === 'node_succeeded') return event.outputs
  if (event.type === 'variable_updated') return event.value
  if (event.type === 'run_started') return event.inputs
  return undefined
}

/**
 * Finds the list an iteration walks through. graphrt's `iteration_next` progress carries only
 * `{ index, total }`, so the list is the most recent array of exactly `total` items written
 * before the progress event (an earlier step's outputs, a variable or a run input).
 *
 * @param events - The run's events (RunEventRecord[])
 * @param beforeSeq - Only events before this seq are searched (number)
 * @param total - Number of items the iteration reported (number)
 * @param iteratorPath - The iteration's `iterator_selector` as `node.field.path`, when known (string | null)
 * @returns The items, or null when no matching list was found (unknown[] | null)
 */
export function findIterationItems(events: RunEventRecord[], beforeSeq: number, total: number, iteratorPath: string | null = null): unknown[] | null {
  const selectedItems = iteratorPath ? readSelectedList(events, beforeSeq, iteratorPath) : null
  if (selectedItems && selectedItems.length === total) return selectedItems
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const record = events[eventIndex]
    if (record.seq >= beforeSeq) continue
    const candidate = readCandidateValue(record.event)
    if (candidate === undefined) continue
    const match = findArrays(candidate).find((found) => found.items.length === total)
    if (match) return match.items
  }
  return null
}

/**
 * The iterator path from a flow summary's iteration detail ("over search_maps.places").
 *
 * @example
 * readIteratorPath('over search_maps.places') // "search_maps.places"
 */
export function readIteratorPath(stepDetail: string | null | undefined): string | null {
  const match = /^over\s+(\S+)$/.exec(stepDetail?.trim() ?? '')
  return match ? match[1] : null
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : Array.isArray(current) ? current[Number(key)] : undefined), value)
}

/** The list at `node.field.path` in that node's latest outputs before `beforeSeq`. */
function readSelectedList(events: RunEventRecord[], beforeSeq: number, iteratorPath: string): unknown[] | null {
  const [nodeId, ...fieldPath] = iteratorPath.split('.')
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const { seq, event } = events[eventIndex]
    if (seq >= beforeSeq || event.type !== 'node_succeeded' || event.node_id !== nodeId) continue
    const selected = readPath(event.outputs, fieldPath)
    return Array.isArray(selected) ? selected : null
  }
  return null
}
