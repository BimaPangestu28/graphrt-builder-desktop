import type { AgentGraph, GraphNode } from '@/api/agentGraphTypes'
import { sampleNodeKinds } from '@/api/sampleBackend/sampleNodeKinds'
import { createGraphNode } from '../../graphEdits'
import { checkReference, describeValueType, listAvailableValues, listEarlierNodeIds } from '../availableValues'
import { readConfigValue, writeConfigValue } from '../configPaths'
import { describeRetryWaits, parseFallbackValue } from '../ErrorHandlingSection'
import { planActionChange } from '../panels/PluginActionPanel'
import { readKeyValueRows, toToolParameter, readToolParameter } from '../panels/ConnectPanels'
import { describeReference, parseTemplate, readSelector, serializeTemplate } from '../references'
import { schemaFieldKind, schemaProperties } from '../SchemaForm'

const kindsByKind = Object.fromEntries(sampleNodeKinds.map((info) => [info.kind, info]))

function node(id: string, kind: string, parent: string | null = null, extra: Partial<GraphNode> = {}): GraphNode {
  return { ...createGraphNode({ id, kind, parent, config: {} }, kindsByKind[kind]?.displayName), ...extra }
}

function edge(source: string, target: string, sourceHandle = 'source') {
  return { id: `${source}-${target}`, documentId: null, source, sourceHandle, target, unused: false }
}

/** start → search → loop[ body_start → write → send ] → report; search --fail-branch--> notify */
function sampleGraph(): AgentGraph {
  const search = node('search', 'google-maps-scraper.search', null, { onError: { strategy: 'fail-branch', values: {} } })
  return {
    agentId: 'a',
    version: 1,
    latestVersion: 1,
    name: null,
    nodes: [
      node('start', 'start', null, { config: { variables: [{ variable: 'area', type: 'text-input' }, { variable: 'max_results', type: 'number' }] } }),
      search,
      node('loop', 'iteration', null, { config: { iterator_selector: ['search', 'results'] } }),
      node('loop_start', 'iteration-start', 'loop'),
      node('write', 'llm', 'loop'),
      node('send', 'whatsapp-web.send_message', 'loop'),
      node('report', 'llm'),
      node('notify', 'answer'),
      node('other_loop', 'iteration'),
      node('other_body', 'llm', 'other_loop'),
    ],
    edges: [edge('start', 'search'), edge('search', 'loop'), edge('loop', 'report'), edge('loop_start', 'write'), edge('write', 'send'), edge('search', 'notify', 'fail-branch'), edge('start', 'other_loop')],
    inputs: [],
    env: [{ name: 'API_TOKEN', description: null, isSecret: true, hasDefault: false }],
    problems: [],
  }
}

describe('references', () => {
  it('parses templates with the runtime rules and writes them back unchanged', () => {
    const source = 'Hi {{#start.area#}}, {{#bad value#}} and {{#search.results.0.name#}}'
    const parts = parseTemplate(source)
    expect(parts.filter((part) => part.type === 'reference').map((part) => (part.type === 'reference' ? part.path : []))).toEqual([
      ['start', 'area'],
      ['search', 'results', '0', 'name'],
    ])
    expect(serializeTemplate(parts)).toBe(source)
  })

  it('reads selectors as lists or dotted text and labels chips like the flow summary', () => {
    expect(readSelector(['search', 'results'])).toEqual(['search', 'results'])
    expect(readSelector('start.area')).toEqual(['start', 'area'])
    expect(readSelector(['only'])).toBeNull()
    const graph = sampleGraph()
    expect(describeReference(['start', 'area'], graph)).toBe('area')
    expect(describeReference(['loop', 'item', 'phone'], graph)).toBe('phone')
    expect(describeReference(['env', 'API_TOKEN'], graph)).toBe('API_TOKEN')
    expect(describeReference(['write_message', 'text'], graph)).toBe('write message › text')
  })
})

describe('available values', () => {
  it('lists upstream outputs, the loop item, Start inputs, secrets and the run id inside a loop', () => {
    const graph = sampleGraph()
    expect(listEarlierNodeIds(graph, 'send')).toEqual(['write', 'loop_start'])
    const groups = listAvailableValues(graph, 'send', kindsByKind)
    const paths = groups.flatMap((group) => group.options.map((option) => option.path.join('.')))
    expect(paths).toEqual(expect.arrayContaining(['loop.item', 'loop.index', 'write.text', 'search.results', 'start.area', 'start.max_results', 'env.API_TOKEN', 'sys.run_id']))
    expect(paths).not.toContain('report.text')
    expect(paths).not.toContain('other_body.text')
    expect(paths).not.toContain('search.error_message')
    expect(groups[0].title).toContain('item')
  })

  it('offers error_message and error_type only after an On error port', () => {
    const paths = listAvailableValues(sampleGraph(), 'notify', kindsByKind).flatMap((group) => group.options.map((option) => option.path.join('.')))
    expect(paths).toEqual(expect.arrayContaining(['search.error_message', 'search.error_type', 'search.results']))
  })

  it('flags unknown steps as errors and out-of-reach steps as warnings', () => {
    const graph = sampleGraph()
    const groups = listAvailableValues(graph, 'send', kindsByKind)
    expect(checkReference(['draft_message', 'text'], graph, groups).status).toBe('unknown-step')
    expect(checkReference(['other_body', 'text'], graph, groups).status).toBe('out-of-scope')
    expect(checkReference(['write', 'text'], graph, groups).status).toBe('ok')
    expect(checkReference(['env', 'ANYTHING'], graph, groups).status).toBe('ok')
  })

  it('describes value types in plain words', () => {
    expect(describeValueType('array[object]')).toBe('list of objects')
    expect(describeValueType('boolean')).toBe('yes/no')
    expect(describeValueType('integer')).toBe('number')
  })
})

describe('config helpers', () => {
  it('writes nested values without touching other keys', () => {
    const config = { url: 'x', unknown_key: { keep: true } }
    const written = writeConfigValue(config, ['timeout', 'read'], 30)
    expect(written).toEqual({ url: 'x', unknown_key: { keep: true }, timeout: { read: 30 } })
    expect(writeConfigValue(written, ['url'], undefined)).not.toHaveProperty('url')
    expect(readConfigValue(writeConfigValue({ items: [{ a: 1 }] }, ['items', 0, 'a'], 2), ['items', 0, 'a'])).toBe(2)
  })

  it('maps schema properties to inputs, including required names without a description', () => {
    expect(schemaFieldKind({ oneOf: [{ type: 'array' }, { type: 'string', pattern: '^x' }] })).toBe('selector')
    expect(schemaFieldKind({ type: 'string', enum: ['a'] })).toBe('choice')
    expect(schemaFieldKind({ type: 'integer' })).toBe('integer')
    expect(schemaFieldKind({ type: ['number', 'null'] })).toBe('number')
    expect(schemaFieldKind({ type: 'boolean' })).toBe('boolean')
    expect(schemaFieldKind({ type: 'array' })).toBe('json')
    expect(schemaProperties({ properties: { a: { type: 'string' } }, required: ['a', 'b'] }).map(([name]) => name)).toEqual(['a', 'b'])
  })

  it('describes retry waits and parses fallback values', () => {
    expect(describeRetryWaits({ maxRetries: 2, intervalMs: 2000, backoff: 2 })).toBe('Waits 2 s, then 4 s.')
    expect(describeRetryWaits({ maxRetries: 0, intervalMs: 0, backoff: 1 })).toBeNull()
    expect(parseFallbackValue('null')).toBeNull()
    expect(parseFallbackValue('12')).toBe(12)
    expect(parseFallbackValue('not sent')).toBe('not sent')
  })

  it('reads headers in every graphrt shape and writes tool inputs as variable, mixed or constant', () => {
    expect(readKeyValueRows('Accept: application/json\nX-Id: 1')).toEqual([
      { key: 'Accept', value: 'application/json' },
      { key: 'X-Id', value: '1' },
    ])
    expect(readKeyValueRows({ Accept: 'text/plain' })).toEqual([{ key: 'Accept', value: 'text/plain' }])
    expect(toToolParameter('{{#start.offer#}}')).toEqual({ type: 'variable', value: ['start', 'offer'] })
    expect(toToolParameter('Catering for {{#start.offer#}}')).toEqual({ type: 'mixed', value: 'Catering for {{#start.offer#}}' })
    expect(toToolParameter('plain')).toEqual({ type: 'constant', value: 'plain' })
    expect(readToolParameter({ type: 'variable', value: ['start', 'offer'] })).toBe('{{#start.offer#}}')
  })
})

describe('change action plan', () => {
  it('keeps shared inputs, flags new required ones and lists values the new action does not read', () => {
    const fileKind = {
      ...kindsByKind['whatsapp-web.send_message'],
      kind: 'whatsapp-web.send_file',
      displayName: 'Send WhatsApp file',
      configSchema: { type: 'object', properties: { phone: { type: 'string' }, file: { type: 'string' }, caption: { type: 'string' } }, required: ['file'] },
    }
    const plan = planActionChange({ phone: '{{#loop.item.phone#}}', text: 'Hello' }, 'whatsapp-web.send_message', fileKind)
    expect(plan.keptKeys).toEqual(['phone'])
    expect(plan.neededKeys).toEqual(['file'])
    expect(plan.unusedKeys).toEqual(['text'])
  })
})
