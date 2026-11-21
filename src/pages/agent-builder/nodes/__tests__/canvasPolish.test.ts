import type { AgentGraph, GraphProblem, NodeLayout } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { copyToClipboards, readClipboardForPaste, writeCanvasClipboard } from '../flow/canvasCommands'
import { copyGraphNodes, parseGraphClipboard, pasteGraphNodes, serializeGraphClipboard } from '../flow/clipboard'
import { containerInset, findDropContainer, placeInsideContainer } from '../flow/containerDrop'
import { listPaneMenuItems } from '../flow/NodeContextMenu'
import { edgeLabelOf, toFlowEdges, toFlowNodes } from '../flow/toFlowElements'
import { placeUnplacedNodes } from '../flow/useCanvasLayout'
import { canvasFitPadding, centreClearOfOverlays, isCompactCanvas, isMinimapShown } from '../flow/useCanvasViewportFit'
import { checkReparentNodes, createGraphNode, insertGraphNodeOnEdge, referencedNodeIds, reparentGraphNodes } from '../graphEdits'
import { inspectorTargetForProblem } from '../problems/problemDisplay'

async function loadSampleGraph(): Promise<AgentGraph> {
  return sampleAgentGraphBackend.getAgentGraph('maps-leads')
}

function problem(code: string, message: string): GraphProblem {
  return { severity: 'error', code, message, nodeId: 'send_whatsapp', edgeId: null }
}

beforeEach(() => {
  resetSampleAgents()
  resetSampleAgentGraphs()
  writeCanvasClipboard(null)
})

describe('moving steps into and out of loops', () => {
  it('reads the steps a node takes values from', async () => {
    const graph = await loadSampleGraph()
    const approve = graph.nodes.find((node) => node.id === 'approve_message')!
    expect([...referencedNodeIds(graph, approve)].sort()).toEqual(['for_each_place', 'write_message'])
    const loop = graph.nodes.find((node) => node.id === 'for_each_place')!
    expect([...referencedNodeIds(graph, loop)].sort()).toEqual(['search_maps', 'send_whatsapp'])
  })

  it('refuses moves that would break a value reference, with the reason', async () => {
    const graph = await loadSampleGraph()
    expect(checkReparentNodes(graph, ['write_message'], null)).toEqual({ allowed: false, reason: 'Write a short message uses values from inside For each place' })
    // The loop collects its result from Send WhatsApp.
    const sendWithoutItem = { ...graph, nodes: graph.nodes.map((node) => (node.id === 'send_whatsapp' ? { ...node, config: { text: 'hello' } } : node)) }
    expect(checkReparentNodes(sendWithoutItem, ['send_whatsapp'], null).reason).toBe('For each place collects its result from Send WhatsApp')
    // Write a short message reads Search Google Maps' results? No: Search is used by the loop itself, which is fine.
    expect(checkReparentNodes(graph, ['search_maps'], 'for_each_place')).toEqual({ allowed: true, reason: null })
    expect(checkReparentNodes(graph, ['end'], 'for_each_place').reason).toBe('End stays outside loops')
    expect(checkReparentNodes(graph, ['for_each_place'], 'for_each_place').allowed).toBe(false)
    expect(checkReparentNodes(graph, ['search_maps'], 'write_message').reason).toBe('Steps can only go inside a loop')
  })

  it('refuses moving a step into a loop when steps outside use its result', async () => {
    const graph = await loadSampleGraph()
    const report = createGraphNode({ id: 'report', kind: 'llm', parent: null, config: { prompt: '{{#search_maps.results#}}' } }, 'Write the report')
    const withReport = { ...graph, nodes: [...graph.nodes, report] }
    expect(checkReparentNodes(withReport, ['search_maps'], 'for_each_place')).toEqual({ allowed: false, reason: 'Write the report uses its result outside For each place' })
  })

  it('re-parents and drops the arrows that would cross the loop edge', async () => {
    const graph = await loadSampleGraph()
    const moved = reparentGraphNodes(graph, ['search_maps'], 'for_each_place')
    expect(moved.nodes.find((node) => node.id === 'search_maps')?.parent).toBe('for_each_place')
    expect(moved.edges.some((edge) => edge.source === 'search_maps' || edge.target === 'search_maps')).toBe(false)
    expect(moved.edges.length).toBe(graph.edges.length - 2)
  })

  it('finds the innermost loop under a point and keeps a dropped step inside it', () => {
    const containers = [
      { id: 'outer', box: { x: 0, y: 0, width: 1000, height: 600 } },
      { id: 'inner', box: { x: 100, y: 100, width: 300, height: 200 } },
    ]
    expect(findDropContainer(containers, { x: 150, y: 150 })).toBe('inner')
    expect(findDropContainer(containers, { x: 700, y: 500 })).toBe('outer')
    expect(findDropContainer(containers, { x: 1200, y: 500 })).toBeNull()

    const placed = placeInsideContainer({ x: 105, y: 110 }, { width: 240, height: 112 }, { x: 100, y: 100, width: 200, height: 150 })
    expect(placed.position).toEqual({ x: containerInset.left, y: containerInset.top })
    expect(placed.grownSize).toEqual({ width: containerInset.left + 240 + containerInset.right, height: containerInset.top + 112 + containerInset.bottom })
    expect(placeInsideContainer({ x: 400, y: 300 }, { width: 100, height: 50 }, containers[0].box).grownSize).toBeNull()
  })
})

describe('system clipboard', () => {
  it('round-trips copied steps through graphrt JSON and pastes them with new ids', async () => {
    const graph = await loadSampleGraph()
    const clipboard = copyGraphNodes(graph, ['write_message', 'approve_message'], { write_message: { nodeId: 'write_message', x: 10, y: 20 } })
    const text = serializeGraphClipboard(clipboard)
    expect(JSON.parse(text)).toMatchObject({ graphrt: 'nodes', version: 1 })
    const parsed = parseGraphClipboard(text)!
    expect(parsed.nodes.map((node) => node.id)).toEqual(['write_message', 'approve_message'])
    expect(parsed.edges).toHaveLength(1)
    expect(parsed.layouts.write_message).toMatchObject({ x: 10, y: 20 })
    const pasted = pasteGraphNodes(graph, parsed)
    expect(pasted.pastedRootIds).toEqual(['write_message_2', 'approve_message_2'])
    expect(pasted.graph.nodes.find((node) => node.id === 'approve_message_2')?.ports.outputs.map((port) => port.id)).toEqual(expect.arrayContaining(['send', 'skip']))
  })

  it('ignores other clipboard text and malformed steps', () => {
    expect(parseGraphClipboard('hello')).toBeNull()
    expect(parseGraphClipboard('{"graphrt":"nodes","version":1,"nodes":[]}')).toBeNull()
    expect(parseGraphClipboard('{"graphrt":"other","version":1,"nodes":[{"id":"a","kind":"llm","config":{},"parent":null}]}')).toBeNull()
    expect(parseGraphClipboard('{"graphrt":"nodes","version":1,"nodes":[{"id":"bad id!","kind":"llm","config":{},"parent":null}]}')).toBeNull()
    expect(parseGraphClipboard('{"graphrt":"nodes","version":1,"nodes":[{"id":"a","kind":"llm","config":"x","parent":null}]}')).toBeNull()
    expect(parseGraphClipboard('{not json')).toBeNull()
    const withStrayEdge = parseGraphClipboard('{"graphrt":"nodes","version":1,"nodes":[{"id":"a","kind":"llm","config":{},"parent":null}],"edges":[{"source":"a","target":"zzz"}]}')
    expect(withStrayEdge?.edges).toEqual([])
  })

  it('writes to the system clipboard and reads it back, falling back to the session copy', async () => {
    const graph = await loadSampleGraph()
    const clipboard = copyGraphNodes(graph, ['write_message'], {})
    let systemText = ''
    const writeText = vi.fn(async (text: string) => {
      systemText = text
    })
    const readText = vi.fn(async () => systemText)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
    try {
      expect(await copyToClipboards(clipboard)).toBe(true)
      expect(parseGraphClipboard(systemText)?.nodes[0].id).toBe('write_message')
      expect((await readClipboardForPaste())?.nodes[0].id).toBe('write_message')

      // Something else was copied since: the session copy is pasted.
      systemText = 'plain text'
      expect((await readClipboardForPaste())?.nodes[0].id).toBe('write_message')

      // Reading is refused (no permission): the session copy too.
      readText.mockRejectedValueOnce(new Error('denied'))
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect((await readClipboardForPaste())?.nodes[0].id).toBe('write_message')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
      vi.restoreAllMocks()
    }
  })
})

describe('arrows, End and placement', () => {
  it('names branch and error arrows on the arrow itself', async () => {
    const graph = await loadSampleGraph()
    const sendEdge = toFlowEdges(graph).find((edge) => edge.source === 'approve_message')!
    expect(sendEdge.data?.label).toBe('Send')
    expect(toFlowEdges(graph).find((edge) => edge.source === 'search_maps')?.data?.label).toBeNull()
    expect(edgeLabelOf('Send', 'unused')).toBe('Send · not used')
    expect(edgeLabelOf(undefined, 'unused')).toBe('not used')
    expect(edgeLabelOf('On error', 'error')).toBe('On error')
  })

  it('draws End as a pill and lets loop steps leave their loop', async () => {
    const graph = await loadSampleGraph()
    const flowNodes = toFlowNodes(graph, { positions: {} })
    expect(flowNodes.find((flowNode) => flowNode.id === 'end')?.type).toBe('end')
    const write = flowNodes.find((flowNode) => flowNode.id === 'write_message')!
    expect(write.parentId).toBe('for_each_place')
    expect(write.extent).toBeUndefined()
  })

  it('inserts a step between two at the top level by moving the later steps down', async () => {
    const graph = await loadSampleGraph()
    const known: Record<string, NodeLayout> = {}
    let y = 0
    for (const node of graph.nodes.filter((candidate) => !candidate.parent)) {
      known[node.id] = { nodeId: node.id, x: 0, y, width: node.container ? 900 : null, height: node.container ? 200 : null }
      y += node.container ? 260 : 170
    }
    const edge = graph.edges.find((candidate) => candidate.source === 'search_maps' && candidate.target === 'for_each_place')!
    const withNode = insertGraphNodeOnEdge(graph, createGraphNode({ id: 'filter', kind: 'llm' }), edge.id)
    const placements = placeUnplacedNodes({ graph: withNode, known, measured: new Map(), fallback: { x: 0, y: 0 } })
    const filter = placements.find((layout) => layout.nodeId === 'filter')!
    expect(filter.y).toBe(known.search_maps.y + 112 + 56)
    expect(filter.x).toBe(0)
    const loop = placements.find((layout) => layout.nodeId === 'for_each_place')!
    expect(loop.y).toBeGreaterThan(known.for_each_place.y)
    expect(placements.find((layout) => layout.nodeId === 'search_maps')).toBeUndefined()
  })
})

describe('canvas menus, fit and problems', () => {
  it('lists the empty-canvas menu for what the canvas can do', () => {
    expect(listPaneMenuItems({ isMac: true, canAddNode: true, canAddNote: true, canPaste: true }).map((item) => item.action)).toEqual(['add-node-here', 'add-note-here', 'paste', 'fit'])
    expect(listPaneMenuItems({ isMac: false, canAddNode: false, canAddNote: false, canPaste: false }).map((item) => item.action)).toEqual(['fit'])
  })

  it('fits clear of a floating panel on the left', () => {
    expect(canvasFitPadding(0).left).toBe('28px')
    expect(canvasFitPadding(312).left).toBe('340px')
  })

  it('fits clear of the zoom bar and, when it shows, the minimap; tighter on a narrow canvas', () => {
    expect(canvasFitPadding(0)).toEqual({ top: '28px', right: '28px', bottom: '64px', left: '28px' })
    expect(canvasFitPadding(0, { minimapShown: true }).bottom).toBe('140px')
    expect(canvasFitPadding(312, { compact: true })).toEqual({ top: '16px', right: '16px', bottom: '56px', left: '328px' })
  })

  it('shows the minimap only when there is room, unless the person chose', () => {
    expect(isMinimapShown('auto', null)).toBe(false)
    expect(isMinimapShown('auto', { width: 1100, height: 700 })).toBe(true)
    expect(isMinimapShown('auto', { width: 560, height: 700 })).toBe(false)
    expect(isMinimapShown('auto', { width: 1100, height: 400 })).toBe(false)
    expect(isMinimapShown('shown', { width: 400, height: 300 })).toBe(true)
    expect(isMinimapShown('hidden', { width: 1400, height: 900 })).toBe(false)
    expect(isCompactCanvas({ width: 560 })).toBe(true)
    expect(isCompactCanvas({ width: 820 })).toBe(false)
  })

  it('centres a step in the part of the canvas no overlay covers', () => {
    const padding = canvasFitPadding(312, { minimapShown: true })
    // 340 left vs 28 right moves the view left; 140 bottom vs 28 top moves it down.
    expect(centreClearOfOverlays({ x: 100, y: 100 }, padding, 1)).toEqual({ x: -56, y: 156 })
    expect(centreClearOfOverlays({ x: 100, y: 100 }, canvasFitPadding(0), 0.5)).toEqual({ x: 100, y: 136 })
  })

  it('points Show node at the part of the inspector a problem is about', () => {
    expect(inspectorTargetForProblem(problem('unused_edge', 'never taken'))).toBe('on-error')
    expect(inspectorTargetForProblem(problem('model_provider_not_set_up', 'connect OpenAI'))).toBe('model')
    expect(inspectorTargetForProblem(problem('node_config', 'missing field `url`'))).toBe('url')
    expect(inspectorTargetForProblem(problem('node_config', 'something is off'))).toBeNull()
    expect(inspectorTargetForProblem(problem('unreachable', 'not reachable'))).toBeNull()
  })
})
