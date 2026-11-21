import type { AgentGraph, GraphNode, JsonValue } from '@/api/agentGraphTypes'
import { updateGraphNode } from '../graphEdits'
import { isJsonObject, readConfigList, type JsonObject } from './configPaths'

/**
 * The Start node's inputs as graphrt reads them (`graphrt-core/src/nodes/start.rs`,
 * `StartConfig`): `variables: [{ variable, label, type, required, default, options,
 * max_length }]`. Pure helpers for the Start inputs editor: names, types, defaults,
 * where an input is used and graph edits that keep `{{#start.x#}}` references and
 * `[start, x]` selectors pointing at the right input. Unknown keys of a variable are kept.
 */

/** One start variable as stored in the node config. */
export type StartVariable = JsonObject

/** An input type the runtime accepts, with the words the Test form uses for it. */
export interface StartInputType {
  /** graphrt's `type` value. */
  value: string
  label: string
  /** What the person running the agent gets ("A one-line text box"). */
  description: string
}

/**
 * The input kinds `StartNode` accepts (`InputVariable::value_type`), in the order the
 * type menu shows them. The Test form (`runInputValues.ts`) renders each the same way.
 */
export const startInputTypes: StartInputType[] = [
  { value: 'text-input', label: 'Short text', description: 'A one-line text box' },
  { value: 'paragraph', label: 'Paragraph', description: 'A multi-line text box' },
  { value: 'number', label: 'Number', description: 'A number box' },
  { value: 'select', label: 'Dropdown', description: 'One of a list of choices' },
  { value: 'checkbox', label: 'Checkbox', description: 'Yes or no' },
  { value: 'file', label: 'File', description: 'One file' },
  { value: 'file-list', label: 'Files', description: 'Several files' },
  { value: 'json', label: 'JSON', description: 'Any JSON value (object, list, text, number)' },
]

/** The runtime's default when `type` is missing (`default_kind`). */
export const defaultStartInputType = 'text-input'

/** Only text kinds take `max_length`; the runtime checks it on text values. */
const textTypes = new Set(['text-input', 'paragraph', 'string', 'text'])
const numberTypes = new Set(['number', 'integer', 'float'])
const booleanTypes = new Set(['checkbox', 'boolean', 'bool'])
const fileTypes = new Set(['file', 'file-list'])

/** How the default value is edited for a type. */
export type StartDefaultControl = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'json' | 'none'

/** The default value control of `type` (files have no default). */
export function defaultControlFor(type: string): StartDefaultControl {
  if (type === 'paragraph') return 'textarea'
  if (textTypes.has(type)) return 'text'
  if (numberTypes.has(type)) return 'number'
  if (booleanTypes.has(type)) return 'checkbox'
  if (type === 'select') return 'select'
  if (fileTypes.has(type)) return 'none'
  return 'json'
}

/** True when `max_length` applies to `type`. */
export function takesMaxLength(type: string): boolean {
  return textTypes.has(type)
}

/** The label of a type for the menu; unknown runtime names (`integer`, `object`) as they are. */
export function describeStartInputType(type: string): string {
  return startInputTypes.find((inputType) => inputType.value === type)?.label ?? type
}

/** Variable names the runtime can reference: one template segment (`[\p{L}\p{N}_-]+`, see `references.ts`). */
const variableNamePattern = /^[\p{L}\p{N}_-]+$/u
/** Longest name the editor allows (a placeholder body is 512 at most, with the node id). */
export const maxVariableNameLength = 64

function readText(variable: StartVariable, key: string): string {
  const value = variable[key]
  return typeof value === 'string' ? value : ''
}

/** The variable name (`variable`). */
export function variableNameOf(variable: StartVariable): string {
  return readText(variable, 'variable')
}

/** The label shown to people; the name when there is none. */
export function variableLabelOf(variable: StartVariable): string {
  return readText(variable, 'label').trim() || variableNameOf(variable)
}

/** The graphrt `type`, or the runtime default. */
export function variableTypeOf(variable: StartVariable): string {
  return readText(variable, 'type') || defaultStartInputType
}

/** Choices of a `select`. */
export function variableOptionsOf(variable: StartVariable): string[] {
  return Array.isArray(variable.options) ? variable.options.filter((option): option is string => typeof option === 'string') : []
}

/** The start variables of a config, objects only. */
export function readStartVariables(config: JsonValue | undefined): StartVariable[] {
  return readConfigList(config, ['variables']).filter(isJsonObject)
}

/**
 * The name a label suggests: lower snake_case ASCII letters and digits.
 *
 * @example
 * toVariableName('Area to search') // 'area_to_search'
 * toVariableName('Max. results (1–50)') // 'max_results_1_50'
 */
export function toVariableName(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxVariableNameLength)
}

/**
 * `base`, or `base_2`, `base_3`… when taken.
 *
 * @param base - Wanted name (string)
 * @param taken - Names in use (string[])
 */
export function uniqueVariableName(base: string, taken: string[]): string {
  const wanted = base || 'input'
  if (!taken.includes(wanted)) return wanted
  let suffix = 2
  while (taken.includes(`${wanted}_${suffix}`)) suffix += 1
  return `${wanted}_${suffix}`
}

/**
 * Why a variable name cannot be used, or null when it can.
 *
 * @param name - The typed name (string)
 * @param otherNames - Names of the other inputs (string[])
 */
export function validateVariableName(name: string, otherNames: string[]): string | null {
  if (name.trim() === '') return 'Give it a name'
  if (name.length > maxVariableNameLength) return `At most ${maxVariableNameLength} characters`
  if (!variableNamePattern.test(name)) return 'Use letters, digits, _ or - only (no spaces or dots)'
  if (otherNames.includes(name)) return 'Another input already has this name'
  return null
}

/** True when the name still is the one its label suggests (renaming the label then renames it too). */
export function isNameFollowingLabel(variable: StartVariable): boolean {
  const name = variableNameOf(variable)
  const label = readText(variable, 'label')
  return name === '' || name === toVariableName(label) || (label.trim() === '' && /^input(_\d+)?$/.test(name))
}

/**
 * A default value converted for `type`, or undefined when it does not fit (dropped).
 *
 * @example
 * convertDefaultForType('12', 'number') // 12
 * convertDefaultForType('red', 'select', ['blue']) // undefined
 */
export function convertDefaultForType(value: JsonValue | undefined, type: string, options: string[] = []): JsonValue | undefined {
  if (value === undefined || value === null) return undefined
  switch (defaultControlFor(type)) {
    case 'none':
      return undefined
    case 'number': {
      const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
      return Number.isFinite(numberValue) ? numberValue : undefined
    }
    case 'checkbox':
      if (typeof value === 'boolean') return value
      if (typeof value === 'string' && ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase())) return true
      if (typeof value === 'string' && ['false', 'no', '0', 'off'].includes(value.trim().toLowerCase())) return false
      return undefined
    case 'select': {
      const text = typeof value === 'string' ? value : String(value)
      return options.includes(text) ? text : undefined
    }
    case 'text':
    case 'textarea':
      if (typeof value === 'string') return value === '' ? undefined : value
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined
    default:
      return value
  }
}

/** `variable` with `key` set, or removed when `value` is undefined. */
function withKey(variable: StartVariable, key: string, value: JsonValue | undefined): StartVariable {
  const next = { ...variable }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/**
 * The variable with a new type: the default converted, choices kept only for a
 * dropdown, `max_length` only for text.
 */
export function changeVariableType(variable: StartVariable, type: string): StartVariable {
  let next = withKey(variable, 'type', type)
  const options = variableOptionsOf(variable)
  if (type === 'select' && options.length === 0) next.options = ['Option 1']
  if (type !== 'select') next = withKey(next, 'options', undefined)
  if (!takesMaxLength(type)) next = withKey(next, 'max_length', undefined)
  return withKey(next, 'default', convertDefaultForType(variable.default, type, variableOptionsOf(next)))
}

/** The variable with new dropdown choices; a default that is no longer a choice is dropped. */
export function changeVariableOptions(variable: StartVariable, options: string[]): StartVariable {
  const next = withKey(variable, 'options', options)
  return withKey(next, 'default', convertDefaultForType(variable.default, variableTypeOf(variable), options))
}

/** A step that reads an input. */
export interface InputUsage {
  nodeId: string
  title: string
}

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function referencePattern(startId: string, name: string): RegExp {
  return new RegExp(`\\{\\{#${escapeForPattern(startId)}\\.${escapeForPattern(name)}(?=[.#])`, 'gu')
}

function isSelectorTo(value: JsonValue[], startId: string, name: string): boolean {
  return value.length >= 2 && value[0] === startId && value[1] === name
}

function isDottedSelectorTo(value: string, startId: string, name: string): boolean {
  return value === `${startId}.${name}` || (value.startsWith(`${startId}.${name}.`) && !/\s/.test(value))
}

/** True when `value` (a config, at any depth) reads `startId.name`. */
export function readsInput(value: JsonValue | undefined, startId: string, name: string): boolean {
  if (typeof value === 'string') return referencePattern(startId, name).test(value) || isDottedSelectorTo(value, startId, name)
  if (Array.isArray(value)) return isSelectorTo(value, startId, name) || value.some((item) => readsInput(item, startId, name))
  if (isJsonObject(value)) return Object.values(value).some((item) => readsInput(item, startId, name))
  return false
}

/**
 * Every step (other than Start) whose settings read the input `name` of `startId`.
 *
 * @param graph - Working graph (AgentGraph)
 * @param startId - The Start node's id (string)
 * @param name - The variable name (string)
 * @returns The steps in document order (InputUsage[])
 */
export function findInputUsages(graph: Pick<AgentGraph, 'nodes'>, startId: string, name: string): InputUsage[] {
  if (!name) return []
  return graph.nodes
    .filter((node) => node.id !== startId && !node.hidden && readsInput(node.config as JsonValue, startId, name))
    .map((node) => ({ nodeId: node.id, title: node.displayTitle }))
}

/** `value` with every reference to `startId.from` pointing at `startId.to`. */
export function renameInputReferences(value: JsonValue, startId: string, from: string, to: string): JsonValue {
  if (typeof value === 'string') {
    const renamed = value.replace(referencePattern(startId, from), `{{#${startId}.${to}`)
    return isDottedSelectorTo(renamed, startId, from) ? `${startId}.${to}${renamed.slice(startId.length + from.length + 1)}` : renamed
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => renameInputReferences(item, startId, from, to))
    if (isSelectorTo(items, startId, from)) items[1] = to
    return items
  }
  if (isJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameInputReferences(item, startId, from, to)]))
  return value
}

function startNodeOf(graph: AgentGraph, startId: string): GraphNode | null {
  return graph.nodes.find((node) => node.id === startId) ?? null
}

/** The graph with the Start node's variables replaced (every other config key kept). */
export function writeStartVariables(graph: AgentGraph, startId: string, variables: StartVariable[]): AgentGraph {
  const start = startNodeOf(graph, startId)
  if (!start) return graph
  return updateGraphNode(graph, startId, { config: { ...start.config, variables } })
}

/** The graph with one variable changed by `change`. */
export function updateStartVariable(graph: AgentGraph, startId: string, index: number, change: (variable: StartVariable) => StartVariable): AgentGraph {
  const start = startNodeOf(graph, startId)
  if (!start) return graph
  const variables = readStartVariables(start.config)
  if (!variables[index]) return graph
  return writeStartVariables(graph, startId, variables.map((variable, itemIndex) => (itemIndex === index ? change(variable) : variable)))
}

/**
 * Renames input `index` and every reference to it in the other steps: one graph, so
 * one undo step. Unchanged when the new name is not valid.
 */
export function renameStartVariable(graph: AgentGraph, startId: string, index: number, nextName: string): AgentGraph {
  const start = startNodeOf(graph, startId)
  if (!start) return graph
  const variables = readStartVariables(start.config)
  const variable = variables[index]
  if (!variable) return graph
  const previousName = variableNameOf(variable)
  const otherNames = variables.filter((_unused, itemIndex) => itemIndex !== index).map(variableNameOf)
  if (previousName === nextName || validateVariableName(nextName, otherNames)) return graph
  const renamed = updateStartVariable(graph, startId, index, (current) => ({ ...current, variable: nextName }))
  if (!previousName) return renamed
  return {
    ...renamed,
    nodes: renamed.nodes.map((node) => {
      if (node.id === startId) return node
      const config = renameInputReferences(node.config as JsonValue, startId, previousName, nextName)
      return isJsonObject(config) && JSON.stringify(config) !== JSON.stringify(node.config) ? { ...node, config } : node
    }),
  }
}

/**
 * Changes the label of input `index`; a name that followed the old label follows the
 * new one (references included), unless that name is taken.
 */
export function relabelStartVariable(graph: AgentGraph, startId: string, index: number, label: string): AgentGraph {
  const start = startNodeOf(graph, startId)
  const variable = start ? readStartVariables(start.config)[index] : undefined
  if (!start || !variable) return graph
  const relabelled = updateStartVariable(graph, startId, index, (current) => withKey(current, 'label', label.trim() === '' ? undefined : label))
  if (!isNameFollowingLabel(variable)) return relabelled
  const otherNames = readStartVariables(start.config).filter((_unused, itemIndex) => itemIndex !== index).map(variableNameOf)
  const suggested = toVariableName(label)
  if (!suggested) return relabelled
  return renameStartVariable(relabelled, startId, index, uniqueVariableName(suggested, otherNames))
}

/** The graph with a new short-text input at the end; returns its index too. */
export function addStartVariable(graph: AgentGraph, startId: string): { graph: AgentGraph; index: number } {
  const start = startNodeOf(graph, startId)
  if (!start) return { graph, index: -1 }
  const variables = readStartVariables(start.config)
  const name = uniqueVariableName('input', variables.map(variableNameOf))
  const added: StartVariable = { variable: name, label: '', type: defaultStartInputType, required: false }
  return { graph: writeStartVariables(graph, startId, [...variables, added]), index: variables.length }
}

/** The graph with input `index` copied right after it ("Area (copy)", `area_2`). */
export function duplicateStartVariable(graph: AgentGraph, startId: string, index: number): AgentGraph {
  const start = startNodeOf(graph, startId)
  const variables = start ? readStartVariables(start.config) : []
  const original = variables[index]
  if (!original) return graph
  const name = uniqueVariableName(variableNameOf(original) || 'input', variables.map(variableNameOf))
  const label = readText(original, 'label')
  const copy: StartVariable = { ...structuredClone(original), variable: name, ...(label ? { label: `${label} (copy)` } : {}) }
  return writeStartVariables(graph, startId, [...variables.slice(0, index + 1), copy, ...variables.slice(index + 1)])
}

/** The graph with input `from` moved to position `to`. */
export function moveStartVariable(graph: AgentGraph, startId: string, from: number, to: number): AgentGraph {
  const start = startNodeOf(graph, startId)
  const variables = start ? readStartVariables(start.config) : []
  if (from === to || from < 0 || to < 0 || from >= variables.length || to >= variables.length) return graph
  const reordered = [...variables]
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved)
  return writeStartVariables(graph, startId, reordered)
}

/** The graph without input `index` (references to it are left for the problems list to flag). */
export function removeStartVariable(graph: AgentGraph, startId: string, index: number): AgentGraph {
  const start = startNodeOf(graph, startId)
  const variables = start ? readStartVariables(start.config) : []
  if (!variables[index]) return graph
  return writeStartVariables(graph, startId, variables.filter((_unused, itemIndex) => itemIndex !== index))
}
