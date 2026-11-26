import type { GraphNode, JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { messages as currentMessages } from '@/i18n'

/**
 * What a node card shows under its title (spec N1 anatomy): the setting that matters
 * most, with value references as chips ("To [phone] · text [write message]"), and
 * the badges for retry, error path and timeout.
 */

export type PreviewSegment = { kind: 'text'; text: string } | { kind: 'reference'; text: string }

/** Lookup of nodes by id, to name references readably. */
export type NodeLookup = Map<string, Pick<GraphNode, 'id' | 'kind' | 'container'>>

const previewTextLimit = 90
const referencePattern = /\{\{#([^#]+)#\}\}/g

/**
 * The readable name of a reference path (spec 43: start.x → x, loop.item.x → x,
 * env.X → X, else the node id with spaces).
 */
export function readableReference(path: string, nodesById: NodeLookup): string {
  const parts = path.split('.').filter(Boolean)
  const [head, second] = parts
  if (!head) return path
  const node = nodesById.get(head)
  const humanize = (text: string) => text.replace(/_/g, ' ')
  if (head === 'env' || head === 'sys') return parts.at(-1) ?? head
  if (node?.kind === 'start' || head === 'start') return humanize(parts.slice(1).join('.') || head)
  if (node?.container && (second === 'item' || second === 'index')) return humanize(parts.slice(2).join('.') || second)
  return humanize(head)
}

function pushText(segments: PreviewSegment[], text: string) {
  if (!text) return
  const last = segments.at(-1)
  if (last?.kind === 'text') last.text += text
  else segments.push({ kind: 'text', text })
}

/** Template text as segments, references as chips, cut to a short preview. */
export function templateSegments(template: string, nodesById: NodeLookup, limit = previewTextLimit): PreviewSegment[] {
  const segments: PreviewSegment[] = []
  let used = 0
  let lastIndex = 0
  const flattened = template.replace(/\s+/g, ' ').trim()
  for (const match of flattened.matchAll(referencePattern)) {
    const before = flattened.slice(lastIndex, match.index)
    if (used + before.length > limit) {
      pushText(segments, `${before.slice(0, Math.max(0, limit - used))}…`)
      return segments
    }
    pushText(segments, before)
    used += before.length
    const label = readableReference(match[1], nodesById)
    segments.push({ kind: 'reference', text: label })
    used += label.length
    lastIndex = (match.index ?? 0) + match[0].length
  }
  const rest = flattened.slice(lastIndex)
  pushText(segments, used + rest.length > limit ? `${rest.slice(0, Math.max(0, limit - used))}…` : rest)
  return segments
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function asList(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function promptOf(config: NodeConfig): string | null {
  const messages = asList(config.prompt_template)
  const userMessages = messages.map(asRecord).filter((message) => message && typeof message.text === 'string')
  const chosen = [...userMessages].reverse().find((message) => message?.role === 'user') ?? userMessages.at(-1)
  if (chosen) return chosen.text as string
  if (typeof config.prompt_template === 'string') return config.prompt_template
  return typeof config.instruction === 'string' ? config.instruction : null
}

function selectorReference(value: JsonValue | undefined, nodesById: NodeLookup): PreviewSegment[] {
  const parts = asList(value).filter((part): part is string => typeof part === 'string')
  if (parts.length === 0) return []
  const label = readableReference(parts.join('.'), nodesById)
  const sourceName = parts[0].replace(/_/g, ' ')
  return [{ kind: 'text', text: 'over ' }, { kind: 'reference', text: parts.at(-1) ?? label }, { kind: 'text', text: ` of ${sourceName}` }]
}

function valueSegments(value: JsonValue, nodesById: NodeLookup): PreviewSegment[] {
  if (typeof value === 'string') return templateSegments(value, nodesById, 28)
  if (typeof value === 'number' || typeof value === 'boolean') return [{ kind: 'text', text: String(value) }]
  return []
}

/** "To [phone] · text [write message]": the first settings of a plugin step. */
function settingSegments(config: NodeConfig, nodesById: NodeLookup): PreviewSegment[] {
  const segments: PreviewSegment[] = []
  const entries = Object.entries(config).filter(([, value]) => valueSegments(value, nodesById).length > 0).slice(0, 2)
  entries.forEach(([key, value], index) => {
    const label = key.replace(/_/g, ' ')
    pushText(segments, `${index > 0 ? ' · ' : ''}${index === 0 ? label[0].toUpperCase() + label.slice(1) : label} `)
    for (const segment of valueSegments(value, nodesById)) {
      if (segment.kind === 'text') pushText(segments, segment.text)
      else segments.push(segment)
    }
  })
  return segments
}

function titlesOf(list: JsonValue | undefined, labelKeys: string[]): string[] {
  return asList(list).flatMap((item) => {
    const record = asRecord(item)
    const label = record && labelKeys.map((key) => record[key]).find((value) => typeof value === 'string' && value.trim())
    return typeof label === 'string' ? [label.trim()] : []
  })
}

function joinChoices(choices: string[]): string {
  if (choices.length <= 1) return choices.join('')
  return `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`
}

/**
 * The key setting of `node` as preview segments; empty when there is nothing to show.
 *
 * @param node - The node (GraphNode)
 * @param nodesById - Every node by id, to name references (NodeLookup)
 * @returns Text and reference chips (PreviewSegment[])
 */
export function describeNodePreview(node: GraphNode, nodesById: NodeLookup): PreviewSegment[] {
  const { config } = node
  switch (node.kind) {
    case 'start': {
      const variables = titlesOf(config.variables, ['label', 'variable'])
      return variables.length > 0 ? variables.flatMap((label, index) => [...(index > 0 ? [{ kind: 'text' as const, text: ' ' }] : []), { kind: 'reference' as const, text: label.toLowerCase() }]) : [{ kind: 'text', text: currentMessages().nodes.noInputsYet }]
    }
    case 'llm':
    case 'agent':
    case 'parameter-extractor': {
      const prompt = promptOf(config)
      return prompt ? templateSegments(prompt, nodesById) : []
    }
    case 'human-input': {
      const prompt = typeof config.prompt === 'string' ? (config.prompt.split('\n')[0] ?? '') : ''
      const buttons = titlesOf(config.actions, ['title', 'id'])
      const segments = prompt ? templateSegments(prompt, nodesById, 60) : []
      if (buttons.length > 0) pushText(segments, `${segments.length > 0 ? ' · ' : ''}${joinChoices(buttons)}`)
      return segments
    }
    case 'if-else': {
      const caseCount = asList(config.cases).length || (config.conditions ? 1 : 0)
      return [{ kind: 'text', text: caseCount === 1 ? currentMessages().nodes.n1CaseElseTheElsePort : currentMessages().nodes.casecountCasesElseTheElsePort(caseCount) }]
    }
    case 'question-classifier': {
      const classes = titlesOf(config.classes, ['name', 'label', 'id'])
      return classes.length > 0 ? [{ kind: 'text', text: classes.join(' · ') }] : []
    }
    case 'iteration': {
      const segments = selectorReference(config.iterator_selector, nodesById)
      if (segments.length > 0) pushText(segments, config.is_parallel ? currentMessages().nodes.inParallel : currentMessages().nodes.oneAtATime)
      return segments
    }
    case 'loop':
      return [{ kind: 'text', text: currentMessages().nodes.upToRounds(typeof config.loop_count === 'number' ? config.loop_count : 1) }]
    case 'http-request': {
      const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET'
      return typeof config.url === 'string' ? [{ kind: 'text', text: `${method} ` }, ...templateSegments(config.url, nodesById, 60)] : []
    }
    case 'template-transform':
      return typeof config.template === 'string' ? templateSegments(config.template, nodesById) : []
    default: {
      const segments = node.plugin || node.kind === 'tool' ? settingSegments(config, nodesById) : []
      return segments.length > 0 ? segments : node.detail ? [{ kind: 'text', text: node.detail }] : []
    }
  }
}

export interface NodeBadge {
  key: 'retry' | 'error-path' | 'fallback' | 'timeout'
  label: string
  tone: 'neutral' | 'danger'
}

/** "12 s", "2 min", "1.5 s". */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`
  const seconds = milliseconds / 1000
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`
  const minutes = seconds / 60
  return currentMessages().nodes.valueMin(Number.isInteger(minutes) ? minutes : minutes.toFixed(1))
}

/** Retry N×, Error path / Fallback values, timeout (spec B3 node badges). */
export function describeNodeBadges(node: Pick<GraphNode, 'retry' | 'onError' | 'timeoutMs'>): NodeBadge[] {
  const badges: NodeBadge[] = []
  if (node.retry.maxRetries > 0) badges.push({ key: 'retry', label: currentMessages().nodes.retryMaxretries(node.retry.maxRetries), tone: 'neutral' })
  if (node.onError.strategy === 'fail-branch') badges.push({ key: 'error-path', label: currentMessages().nodes.errorPath, tone: 'danger' })
  if (node.onError.strategy === 'default-value') badges.push({ key: 'fallback', label: currentMessages().nodes.fallbackValues, tone: 'neutral' })
  if (node.timeoutMs !== null && node.timeoutMs > 0) badges.push({ key: 'timeout', label: formatDuration(node.timeoutMs), tone: 'neutral' })
  return badges
}
