import type { AgentGraph, JsonValue } from '@/api/agentGraphTypes'

/**
 * Value references as the graphrt runtime reads them (`graphrt-core/src/template.rs`
 * and `pool.rs`): template text holds `{{#node.field.path#}}` placeholders, selector
 * fields hold `[node, field, ...]` lists (or `"node.field"`). `sys` and `env` are the
 * run's own namespaces (`{{#sys.run_id#}}`, `{{#env.API_TOKEN#}}`).
 */

export const SYSTEM_NAMESPACE = 'sys'
export const ENV_NAMESPACE = 'env'

/** One piece of a template: plain text or a reference to a value. */
export type TemplatePart = { type: 'text'; text: string } | { type: 'reference'; path: string[] }

/** Longest placeholder body the runtime accepts. */
const maxPlaceholderLength = 512

function parsePlaceholderBody(body: string): string[] | null {
  if (body.length === 0 || body.length > maxPlaceholderLength) return null
  const segments = body.split('.')
  if (segments.length < 2) return null
  const isValid = segments.every((segment) => segment.length > 0 && /^[\p{L}\p{N}_-]+$/u.test(segment))
  return isValid ? segments : null
}

function pushText(parts: TemplatePart[], text: string): void {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + text }
  else parts.push({ type: 'text', text })
}

/**
 * Splits template text into text and references, with the runtime's rules: anything
 * that is not a well-formed `{{#ns.name.path#}}` stays literal text.
 *
 * @example
 * parseTemplate('Hi {{#start.name#}}!')
 * // [{ type: 'text', text: 'Hi ' }, { type: 'reference', path: ['start', 'name'] }, { type: 'text', text: '!' }]
 */
export function parseTemplate(source: string): TemplatePart[] {
  const parts: TemplatePart[] = []
  let rest = source
  while (rest.length > 0) {
    const openIndex = rest.indexOf('{{#')
    if (openIndex < 0) break
    pushText(parts, rest.slice(0, openIndex))
    const afterOpen = rest.slice(openIndex + 3)
    const closeIndex = afterOpen.indexOf('#}}')
    if (closeIndex < 0) {
      pushText(parts, rest.slice(openIndex))
      rest = ''
      break
    }
    const path = parsePlaceholderBody(afterOpen.slice(0, closeIndex))
    if (path) {
      parts.push({ type: 'reference', path })
      rest = afterOpen.slice(closeIndex + 3)
    } else {
      pushText(parts, '{{#')
      rest = afterOpen
    }
  }
  pushText(parts, rest)
  return parts
}

/** Template text of parts (the inverse of {@link parseTemplate}). */
export function serializeTemplate(parts: TemplatePart[]): string {
  return parts.map((part) => (part.type === 'text' ? part.text : formatReference(part.path))).join('')
}

/** `['start', 'name']` → `{{#start.name#}}`. */
export function formatReference(path: string[]): string {
  return `{{#${path.join('.')}#}}`
}

/** Every reference path in a template, in order. */
export function templateReferences(source: string): string[][] {
  return parseTemplate(source).flatMap((part) => (part.type === 'reference' ? [part.path] : []))
}

/**
 * A selector config value (`['node', 'field']` or `"node.field"`) as a path, or null.
 *
 * @example
 * readSelector(['search_maps', 'results']) // ['search_maps', 'results']
 * readSelector('start.area') // ['start', 'area']
 */
export function readSelector(value: JsonValue | undefined): string[] | null {
  if (Array.isArray(value)) {
    const segments = value.map((segment) => (typeof segment === 'string' || typeof segment === 'number' ? String(segment) : ''))
    return segments.length >= 2 && segments.every((segment) => segment !== '') ? segments : null
  }
  if (typeof value === 'string' && /^[^.\s]+(\.[^.\s]+)+$/.test(value)) return value.split('.')
  return null
}

/** True when `template` is exactly one reference (the runtime then passes the typed value). */
export function singleReference(template: string): string[] | null {
  const parts = parseTemplate(template)
  return parts.length === 1 && parts[0].type === 'reference' ? parts[0].path : null
}

function spacedId(nodeId: string): string {
  return nodeId.replace(/[_-]+/g, ' ').trim()
}

/**
 * The chip label of a reference, as the flow summary's readable references write it:
 * `start.x` → x, `<loop>.item.x` → x, `env.X` → X, `sys.run_id` → run id, else the node
 * id with spaces and the field.
 *
 * @example
 * describeReference(['for_each_place', 'item', 'phone'], graph) // 'phone'
 * describeReference(['write_message', 'text'], graph) // 'write message › text'
 */
export function describeReference(path: string[], graph: Pick<AgentGraph, 'nodes'>): string {
  const [namespace, ...fieldPath] = path
  if (namespace === ENV_NAMESPACE) return fieldPath.join('.')
  if (namespace === SYSTEM_NAMESPACE) return fieldPath.join('.').replace(/_/g, ' ')
  const node = graph.nodes.find((candidate) => candidate.id === namespace)
  if (node?.kind === 'start') return fieldPath.join('.')
  if (node?.kind === 'iteration' && (fieldPath[0] === 'item' || fieldPath[0] === 'index')) {
    return fieldPath.length > 1 ? fieldPath.slice(1).join('.') : fieldPath[0]
  }
  return `${spacedId(namespace)} › ${fieldPath.join('.')}`
}
