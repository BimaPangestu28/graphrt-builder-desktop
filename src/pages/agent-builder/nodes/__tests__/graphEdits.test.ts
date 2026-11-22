import { sampleAgentGraphBackend, resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { computeAutoLayout, mergeLayouts } from '../flow/autoLayout'
import { toFlowEdges, toFlowNodes } from '../flow/toFlowElements'
import { addGraphEdge, changedNodeIds, createGraphNode, isSameGraph, removeGraphNodes, toGraphEdit, uniqueNodeId, updateGraphNode } from '../graphEdits'

async function loadSampleGraph(): Promise<AgentGraph> {
  return sampleAgentGraphBackend.getAgentGraph('maps-leads')
}

describe('graph edits', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('updates ports and marks error-path arrows unused when On error is switched off', async () => {
    const graph = await loadSampleGraph()
    const withErrorPath = updateGraphNode(graph, 'send_whatsapp', { onError: { strategy: 'fail-branch', values: {} } })
    const withErrorArrow = addGraphEdge(withErrorPath, { source: 'send_whatsapp', sourceHandle: 'fail-branch', target: 'for_each_place_start' })
    expect(withErrorArrow.edges.at(-1)).toMatchObject({ sourceHandle: 'fail-branch', unused: false })

    const switchedOff = updateGraphNode(withErrorArrow, 'send_whatsapp', { onError: { strategy: 'fail', values: {} } })
    expect(switchedOff.edges.at(-1)).toMatchObject({ sourceHandle: 'fail-branch', unused: true })
    expect(switchedOff.nodes.find((node) => node.id === 'send_whatsapp')?.ports.outputs.map((port) => port.id)).toEqual(['source'])
  })

  it('adds approval buttons as exits when the actions change', async () => {
    const graph = await loadSampleGraph()
    const approval = graph.nodes.find((node) => node.id === 'approve_message')!
    const edited = updateGraphNode(graph, 'approve_message', { config: { ...approval.config, actions: [{ id: 'send', title: 'Send' }, { id: 'later', title: 'Later' }] } })
    expect(edited.nodes.find((node) => node.id === 'approve_message')?.ports.outputs.map((port) => port.label)).toEqual(['Send', 'Later'])
  })

  it('removes a container with its body and every arrow touching them', async () => {
    const graph = await loadSampleGraph()
    const removed = removeGraphNodes(graph, ['for_each_place'])
    expect(removed.nodes.map((node) => node.id)).toEqual(['ask_input', 'search_maps', 'end'])
    expect(removed.edges.every((edge) => edge.source !== 'for_each_place' && edge.target !== 'for_each_place')).toBe(true)
  })

  it('names new nodes uniquely and builds them with ports', async () => {
    const graph = await loadSampleGraph()
    const nodeId = uniqueNodeId(graph, 'Write message')
    const node = createGraphNode({ id: nodeId, kind: 'if-else', config: { cases: [{ case_id: 'hot' }] } })
    expect(nodeId).toBe('write_message_2')
    expect(node.displayTitle).toBe('Check a condition')
    expect(node.ports.outputs.map((port) => port.id)).toEqual(['hot', 'false'])
  })

  it('turns the working copy into the save edit and compares graphs', async () => {
    const graph = await loadSampleGraph()
    const renamed = updateGraphNode(graph, 'write_message', { title: 'Write it' })
    const edit = toGraphEdit(renamed, { description: 'renamed' })
    expect(edit.nodes).toHaveLength(graph.nodes.length)
    expect(edit.edges[0]).toEqual({ documentId: null, source: 'ask_input', sourceHandle: 'source', target: 'search_maps' })
    expect(edit.description).toBe('renamed')
    expect(changedNodeIds(graph, renamed)).toEqual(['write_message'])
    expect(isSameGraph(graph, renamed)).toBe(false)
    expect(isSameGraph(graph, updateGraphNode(renamed, 'write_message', { title: graph.nodes.find((node) => node.id === 'write_message')!.title }))).toBe(true)
  })
})

describe('canvas elements', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('lays every node out, with loop bodies inside their container', async () => {
    const graph = await loadSampleGraph()
    const layouts = await computeAutoLayout(graph)
    const byId = Object.fromEntries(layouts.map((layout) => [layout.nodeId, layout]))
    expect(Object.keys(byId).sort()).toEqual(graph.nodes.map((node) => node.id).sort())
    const container = byId.for_each_place
    expect(container.width).toBeGreaterThan(240)
    expect(byId.write_message.x).toBeGreaterThanOrEqual(0)
    expect(byId.write_message.x + 240).toBeLessThanOrEqual(container.width! + 1)
    // Top level runs down, a loop body runs right.
    expect(byId.search_maps.y).toBeGreaterThan(byId.ask_input.y)
    expect(byId.approve_message.x).toBeGreaterThan(byId.write_message.x)
  })

  it('prefers saved positions over auto-layout', () => {
    const merged = mergeLayouts([{ nodeId: 'a', x: 1, y: 1, width: 300, height: 200 }, { nodeId: 'b', x: 2, y: 2 }], { a: { nodeId: 'a', x: 50, y: 60 } })
    expect(merged.a).toEqual({ nodeId: 'a', x: 50, y: 60, width: 300, height: 200 })
    expect(merged.b).toEqual({ nodeId: 'b', x: 2, y: 2 })
  })

  it('builds React Flow nodes with parents first and labelled branch edges', async () => {
    const graph = await loadSampleGraph()
    const flowNodes = toFlowNodes(graph, { positions: {} })
    const containerIndex = flowNodes.findIndex((node) => node.id === 'for_each_place')
    const childIndex = flowNodes.findIndex((node) => node.id === 'write_message')
    expect(containerIndex).toBeLessThan(childIndex)
    expect(flowNodes[childIndex]).toMatchObject({ parentId: 'for_each_place', type: 'step' })
    expect(flowNodes.find((node) => node.id === 'for_each_place_start')?.type).toBe('marker')
    const sendEdge = toFlowEdges(graph).find((edge) => edge.source === 'approve_message')
    expect(sendEdge).toMatchObject({ sourceHandle: 'send', label: 'Send' })
  })

  it('labels plugin steps with the same plugin name as the rest of the app', async () => {
    const graph = await loadSampleGraph()
    const pluginStep = graph.nodes.find((node) => node.plugin)
    if (!pluginStep?.plugin) throw new Error('the sample graph has a plugin step')
    const renamedGraph = { ...graph, nodes: graph.nodes.map((node) => (node.id === pluginStep.id ? { ...node, plugin: 'whatsapp-api', kind: 'whatsapp-api.send' } : node)) }
    const flowNode = toFlowNodes(renamedGraph, { positions: {} }).find((node) => node.id === pluginStep.id)
    expect(flowNode?.data).toMatchObject({ pluginLine: 'WhatsApp API · send' })
  })
})
