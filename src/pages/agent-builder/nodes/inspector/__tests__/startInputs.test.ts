import type { AgentGraph, GraphNode, NodeConfig } from '@/api/agentGraphTypes'
import { createGraphNode, toGraphEdit } from '../../graphEdits'
import {
  addStartVariable,
  changeVariableOptions,
  changeVariableType,
  convertDefaultForType,
  defaultControlFor,
  duplicateStartVariable,
  findInputUsages,
  moveStartVariable,
  readStartVariables,
  relabelStartVariable,
  removeStartVariable,
  renameStartVariable,
  startInputTypes,
  toVariableName,
  uniqueVariableName,
  updateStartVariable,
  validateVariableName,
} from '../startInputs'

function node(id: string, kind: string, config: NodeConfig, title = id): GraphNode {
  return createGraphNode({ id, kind, title, config })
}

function sampleGraph(): AgentGraph {
  return {
    agentId: 'a',
    version: 1,
    latestVersion: 1,
    name: null,
    nodes: [
      node('start', 'start', {
        variables: [
          { variable: 'area_to_search', label: 'Area to search', type: 'text-input', required: true, x_custom: 'kept' },
          { variable: 'promotion_message', label: 'Promotion message', type: 'paragraph', required: false },
        ],
        extra_key: 1,
      }),
      node('search', 'google-maps-scraper.search', { query: 'cafes in {{#start.area_to_search#}}', other: '{{#start.area_to_search_wide#}}' }, 'Search Google Maps'),
      node('write', 'llm', { prompt_template: [{ role: 'user', text: 'Write {{#start.promotion_message#}} about {{#start.area_to_search.city#}}' }] }, 'Write message'),
      node('done', 'end', { outputs: [{ variable: 'area', value_selector: ['start', 'area_to_search'] }, { variable: 'dotted', value_selector: 'start.area_to_search' }] }, 'End'),
    ],
    edges: [],
    inputs: [],
    env: [],
    problems: [],
  }
}

const variablesOf = (graph: AgentGraph) => readStartVariables(graph.nodes[0].config)
const configOf = (graph: AgentGraph, id: string) => graph.nodes.find((candidate) => candidate.id === id)?.config

describe('start input names', () => {
  it('derives snake_case names from labels', () => {
    expect(toVariableName('Area to search')).toBe('area_to_search')
    expect(toVariableName('  Max. results (1–50) ')).toBe('max_results_1_50')
    expect(toVariableName('Café crème')).toBe('cafe_creme')
    expect(toVariableName('!!!')).toBe('')
  })

  it('validates names with the runtime rules and uniqueness', () => {
    expect(validateVariableName('area', [])).toBeNull()
    expect(validateVariableName('area-2', [])).toBeNull()
    expect(validateVariableName('', [])).toBe('Give it a name')
    expect(validateVariableName('has space', [])).toMatch(/letters, digits/)
    expect(validateVariableName('a.b', [])).toMatch(/no spaces or dots/)
    expect(validateVariableName('area', ['area'])).toBe('Another input already has this name')
    expect(validateVariableName('x'.repeat(65), [])).toMatch(/At most 64/)
    expect(uniqueVariableName('area', ['area', 'area_2'])).toBe('area_3')
  })

  it('offers exactly the input types the runtime start node accepts', () => {
    expect(startInputTypes.map((inputType) => inputType.value)).toEqual(['text-input', 'paragraph', 'number', 'select', 'checkbox', 'file', 'file-list', 'json'])
  })
})

describe('start input edits', () => {
  it('renames an input and rewrites every reference to it in one graph', () => {
    const renamed = renameStartVariable(sampleGraph(), 'start', 0, 'area')
    expect(variablesOf(renamed)[0]).toEqual({ variable: 'area', label: 'Area to search', type: 'text-input', required: true, x_custom: 'kept' })
    expect(configOf(renamed, 'search')).toEqual({ query: 'cafes in {{#start.area#}}', other: '{{#start.area_to_search_wide#}}' })
    expect(configOf(renamed, 'write')).toEqual({ prompt_template: [{ role: 'user', text: 'Write {{#start.promotion_message#}} about {{#start.area.city#}}' }] })
    expect(configOf(renamed, 'done')).toEqual({ outputs: [{ variable: 'area', value_selector: ['start', 'area'] }, { variable: 'dotted', value_selector: 'start.area' }] })
  })

  it('refuses invalid or taken names', () => {
    const graph = sampleGraph()
    expect(renameStartVariable(graph, 'start', 0, 'promotion_message')).toBe(graph)
    expect(renameStartVariable(graph, 'start', 0, 'bad name')).toBe(graph)
  })

  it('relabelling renames a name that followed its label, references included', () => {
    const relabelled = relabelStartVariable(sampleGraph(), 'start', 0, 'City')
    expect(variablesOf(relabelled)[0]).toMatchObject({ variable: 'city', label: 'City' })
    expect(configOf(relabelled, 'search')).toMatchObject({ query: 'cafes in {{#start.city#}}' })
    const custom = renameStartVariable(sampleGraph(), 'start', 0, 'where')
    expect(variablesOf(relabelStartVariable(custom, 'start', 0, 'City'))[0]).toMatchObject({ variable: 'where', label: 'City' })
  })

  it('adds, duplicates, moves and removes inputs', () => {
    const { graph: added, index } = addStartVariable(sampleGraph(), 'start')
    expect(index).toBe(2)
    expect(variablesOf(added)[2]).toEqual({ variable: 'input', label: '', type: 'text-input', required: false })
    expect(variablesOf(relabelStartVariable(added, 'start', 2, 'Max results'))[2]).toMatchObject({ variable: 'max_results', label: 'Max results' })

    const duplicated = duplicateStartVariable(sampleGraph(), 'start', 0)
    expect(variablesOf(duplicated).map((variable) => variable.variable)).toEqual(['area_to_search', 'area_to_search_2', 'promotion_message'])
    expect(variablesOf(duplicated)[1]).toMatchObject({ label: 'Area to search (copy)', x_custom: 'kept', required: true })

    const moved = moveStartVariable(sampleGraph(), 'start', 1, 0)
    expect(variablesOf(moved).map((variable) => variable.variable)).toEqual(['promotion_message', 'area_to_search'])
    expect(configOf(moved, 'start')).toMatchObject({ extra_key: 1 })

    expect(variablesOf(removeStartVariable(sampleGraph(), 'start', 0)).map((variable) => variable.variable)).toEqual(['promotion_message'])
  })

  it('lists the steps that use an input', () => {
    const graph = sampleGraph()
    expect(findInputUsages(graph, 'start', 'area_to_search')).toEqual([
      { nodeId: 'search', title: 'Search Google Maps' },
      { nodeId: 'write', title: 'Write message' },
      { nodeId: 'done', title: 'End' },
    ])
    expect(findInputUsages(graph, 'start', 'promotion_message').map((usage) => usage.nodeId)).toEqual(['write'])
    expect(findInputUsages(graph, 'start', 'nothing')).toEqual([])
  })
})

describe('type-specific defaults', () => {
  it('picks the default control per type', () => {
    expect(['text-input', 'paragraph', 'number', 'select', 'checkbox', 'file', 'file-list', 'json'].map(defaultControlFor)).toEqual(['text', 'textarea', 'number', 'select', 'checkbox', 'none', 'none', 'json'])
  })

  it('converts the default when the type changes', () => {
    expect(convertDefaultForType('12', 'number')).toBe(12)
    expect(convertDefaultForType('abc', 'number')).toBeUndefined()
    expect(convertDefaultForType('yes', 'checkbox')).toBe(true)
    expect(convertDefaultForType(3, 'text-input')).toBe('3')
    expect(convertDefaultForType('red', 'select', ['red', 'blue'])).toBe('red')
    expect(convertDefaultForType('green', 'select', ['red'])).toBeUndefined()
    expect(convertDefaultForType('x', 'file')).toBeUndefined()
  })

  it('keeps choices only for a dropdown and max length only for text', () => {
    const text = { variable: 'n', type: 'text-input', default: '5', max_length: 10 }
    expect(changeVariableType(text, 'number')).toEqual({ variable: 'n', type: 'number', default: 5 })
    const dropdown = changeVariableType(text, 'select')
    expect(dropdown).toEqual({ variable: 'n', type: 'select', options: ['Option 1'] })
    expect(changeVariableOptions({ ...dropdown, default: 'Option 1' }, ['A', 'B'])).toEqual({ variable: 'n', type: 'select', options: ['A', 'B'] })
    expect(changeVariableType({ variable: 'c', type: 'select', options: ['A'], default: 'A' }, 'paragraph')).toEqual({ variable: 'c', type: 'paragraph', default: 'A' })
  })
})

describe('saving start inputs', () => {
  it('sends the start config in the shape graphrt StartConfig reads, other keys untouched', () => {
    let graph = sampleGraph()
    graph = addStartVariable(graph, 'start').graph
    graph = relabelStartVariable(graph, 'start', 2, 'Max results')
    graph = updateStartVariable(graph, 'start', 2, (variable) => changeVariableType(variable, 'number'))
    graph = updateStartVariable(graph, 'start', 2, (variable) => ({ ...variable, default: 20, required: true }))
    graph = addStartVariable(graph, 'start').graph
    graph = relabelStartVariable(graph, 'start', 3, 'Tone')
    graph = updateStartVariable(graph, 'start', 3, (variable) => changeVariableOptions(changeVariableType(variable, 'select'), ['friendly', 'formal']))
    graph = updateStartVariable(graph, 'start', 3, (variable) => ({ ...variable, default: 'friendly' }))
    const edit = toGraphEdit(graph)
    expect(edit.nodes.find((nodeEdit) => nodeEdit.id === 'start')?.config).toEqual({
      variables: [
        { variable: 'area_to_search', label: 'Area to search', type: 'text-input', required: true, x_custom: 'kept' },
        { variable: 'promotion_message', label: 'Promotion message', type: 'paragraph', required: false },
        { variable: 'max_results', label: 'Max results', type: 'number', required: true, default: 20 },
        { variable: 'tone', label: 'Tone', type: 'select', required: false, options: ['friendly', 'formal'], default: 'friendly' },
      ],
      extra_key: 1,
    })
  })
})
