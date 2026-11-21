import type { AgentGraph } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { insertGraphNodeAfterNode, insertGraphNodeOnEdge } from '../../graphEdits'
import { applyNodePlacement, buildNodePlacement, createPaletteNode, placeNodeInGraph } from '../nodePlacement'

async function loadSampleGraph(): Promise<AgentGraph> {
  return sampleAgentGraphBackend.getAgentGraph('maps-leads')
}

function edgesOf(graph: AgentGraph): string[] {
  return graph.edges.map((edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}`)
}

const formatText = { kind: 'template-transform', displayName: 'Format text' }

describe('node placement', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('inserts on an arrow: source → new → target, keeping the branch exit and the container', async () => {
    const graph = await loadSampleGraph()
    const sendEdge = graph.edges.find((edge) => edge.source === 'approve_message' && edge.sourceHandle === 'send')!
    const node = createPaletteNode(graph, formatText)
    const next = insertGraphNodeOnEdge(graph, node, sendEdge.id)

    expect(edgesOf(next)).not.toContain(`approve_message:send->${sendEdge.target}`)
    expect(edgesOf(next)).toContain('approve_message:send->format_text')
    expect(edgesOf(next)).toContain(`format_text:source->${sendEdge.target}`)
    expect(next.edges).toHaveLength(graph.edges.length + 1)
    expect(next.nodes.find((candidate) => candidate.id === 'format_text')?.parent).toBe('for_each_place')
  })

  it('keeps the arrow when the new node has no exit (End)', async () => {
    const graph = await loadSampleGraph()
    const sendEdge = graph.edges.find((edge) => edge.source === 'approve_message' && edge.sourceHandle === 'send')!
    const next = insertGraphNodeOnEdge(graph, createPaletteNode(graph, { kind: 'loop-end', displayName: 'Stop repeating' }), sendEdge.id)
    expect(edgesOf(next)).toContain(`approve_message:send->${sendEdge.target}`)
    expect(edgesOf(next)).toContain('approve_message:send->stop_repeating')
  })

  it('adds after a node on its default arrow, or connected from its exit when it has none', async () => {
    const graph = await loadSampleGraph()
    const defaultEdge = graph.edges.find((edge) => edge.source === 'write_message' && edge.sourceHandle === 'source')!
    const afterWrite = insertGraphNodeAfterNode(graph, createPaletteNode(graph, formatText), 'write_message')
    expect(edgesOf(afterWrite)).toEqual(expect.arrayContaining(['write_message:source->format_text', `format_text:source->${defaultEdge.target}`]))
    expect(edgesOf(afterWrite)).not.toContain(`write_message:source->${defaultEdge.target}`)

    const withoutExits = { ...graph, edges: graph.edges.filter((edge) => edge.source !== 'write_message') }
    const connected = insertGraphNodeAfterNode(withoutExits, createPaletteNode(withoutExits, formatText), 'write_message')
    expect(edgesOf(connected)).toContain('write_message:source->format_text')
    expect(connected.edges).toHaveLength(withoutExits.edges.length + 1)
  })

  it('adds unconnected at a position, inside a container when dropped on one', async () => {
    const graph = await loadSampleGraph()
    const node = createPaletteNode(graph, formatText)
    const dropped = placeNodeInGraph(graph, node, { type: 'at-position', x: 10, y: 20, parentId: 'for_each_place' })
    expect(dropped.nodes.at(-1)).toMatchObject({ id: 'format_text', parent: 'for_each_place' })
    expect(dropped.edges).toEqual(graph.edges)
  })

  it('builds one placement: unique id, position beside the anchor, plain-words description, one undo step', async () => {
    const graph = await loadSampleGraph()
    const placement = buildNodePlacement(graph, { kind: 'llm', displayName: 'Ask a model' }, { type: 'after-node', nodeId: 'write_message' }, { write_message: { nodeId: 'write_message', x: 100, y: 40 } })
    expect(placement.node.id).toBe('ask_a_model')
    expect(placement.layout).toMatchObject({ nodeId: 'ask_a_model', x: 100 + 240 + 72, y: 40 })
    expect(placement.description).toBe('added Ask a model after Write a short message')

    const applyEdit = vi.fn()
    const moveNodes = vi.fn()
    applyNodePlacement({ applyEdit, moveNodes }, placement)
    expect(applyEdit).toHaveBeenCalledTimes(1)
    expect(applyEdit.mock.calls[0][1]).toBe('added Ask a model after Write a short message')
    const edited = applyEdit.mock.calls[0][0](graph) as AgentGraph
    expect(edited.nodes.some((candidate) => candidate.id === 'ask_a_model')).toBe(true)
    expect(moveNodes).toHaveBeenCalledWith([placement.layout])
  })

  it('drops an anchor that no longer exists', async () => {
    const graph = await loadSampleGraph()
    const placement = buildNodePlacement(graph, formatText, { type: 'on-edge', edgeId: 'gone' })
    expect(placement.anchor).toBeNull()
    expect(placement.description).toBe('added Format text')
  })
})
