import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { checkConnection } from '@/lib/agentGraphRules'
import { copyGraphNodes, pasteGraphNodes, remapReferences } from '../flow/clipboard'
import { buildAskBuilderText, nudgeLayouts } from '../flow/canvasCommands'
import { describeNodeBadges, describeNodePreview, readableReference } from '../flow/nodePreview'
import { findFreePosition, placeNewNode, rectsOverlap } from '../flow/placement'
import { isTypingTarget, resolveShortcut } from '../flow/shortcuts'
import { placeUnplacedNodes } from '../flow/useCanvasLayout'
import { createGraphNode, disconnectGraphNodes, insertGraphNodeAfter, reconnectGraphEdge, updateGraphNode } from '../graphEdits'

async function loadSampleGraph(): Promise<AgentGraph> {
  return sampleAgentGraphBackend.getAgentGraph('maps-leads')
}

const startIdOf = (graph: AgentGraph) => graph.nodes.find((node) => node.kind === 'start')?.id as string

describe('connect rules', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('allows an arrow between two steps of the same scope', async () => {
    const graph = await loadSampleGraph()
    expect(checkConnection(graph, { source: 'write_message', target: 'send_whatsapp' })).toEqual({ allowed: true })
  })

  it('refuses arrows into Start, into itself, across a loop boundary, duplicates and circles, with a reason', async () => {
    const graph = await loadSampleGraph()
    expect(checkConnection(graph, { source: 'search_maps', target: startIdOf(graph) })).toEqual({ allowed: false, reason: "Can't connect: Start never has arrows coming in" })
    expect(checkConnection(graph, { source: 'search_maps', target: 'search_maps' })).toMatchObject({ allowed: false, reason: "Can't connect a step to itself" })
    expect(checkConnection(graph, { source: 'write_message', target: 'end' })).toEqual({ allowed: false, reason: "Can't connect: steps inside For each place can't link to steps outside it" })
    expect(checkConnection(graph, { source: 'search_maps', target: 'write_message' })).toMatchObject({ allowed: false, reason: expect.stringContaining('outside For each place') })
    expect(checkConnection(graph, { source: 'write_message', target: 'approve_message' })).toMatchObject({ allowed: false, reason: 'Already connected' })
    expect(checkConnection(graph, { source: 'send_whatsapp', target: 'write_message' })).toEqual({ allowed: false, reason: "Can't connect: that would make a circle of steps" })
  })

  it('only allows exits the source has', async () => {
    const graph = await loadSampleGraph()
    expect(checkConnection(graph, { source: 'approve_message', sourceHandle: 'skip', target: 'send_whatsapp' })).toEqual({ allowed: true })
    expect(checkConnection(graph, { source: 'approve_message', sourceHandle: 'fail-branch', target: 'send_whatsapp' })).toMatchObject({ allowed: false })
  })
})

describe('canvas edits', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('pastes copies with new ids, their inner arrows and references pointing at the copies', async () => {
    const graph = await loadSampleGraph()
    const clipboard = copyGraphNodes(graph, ['write_message', 'approve_message'], { write_message: { nodeId: 'write_message', x: 40, y: 80 } })
    expect(clipboard.edges).toHaveLength(1)

    const result = pasteGraphNodes(graph, clipboard)
    expect(result.idMap).toEqual({ write_message: 'write_message_2', approve_message: 'approve_message_2' })
    expect(result.pastedRootIds).toEqual(['write_message_2', 'approve_message_2'])
    expect(result.graph.nodes.find((node) => node.id === 'approve_message_2')?.parent).toBe('for_each_place')
    expect(result.graph.edges.some((edge) => edge.source === 'write_message_2' && edge.target === 'approve_message_2')).toBe(true)
    // Arrows to steps that were not copied are dropped.
    expect(result.graph.edges.some((edge) => edge.source === 'approve_message_2' && edge.target === 'send_whatsapp')).toBe(false)
    expect(JSON.stringify(result.graph.nodes.find((node) => node.id === 'approve_message_2')?.config)).toContain('{{#write_message_2.text#}}')
    expect(result.layouts).toEqual([{ nodeId: 'write_message_2', x: 80, y: 120 }])
  })

  it('duplicates a loop with its body (hidden entry included) and ignores a lone entry marker', async () => {
    const graph = await loadSampleGraph()
    const clipboard = copyGraphNodes(graph, ['for_each_place'], {})
    expect(clipboard.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['for_each_place', 'for_each_place_start', 'write_message', 'send_whatsapp']))
    const result = pasteGraphNodes(graph, clipboard)
    expect(result.graph.nodes.find((node) => node.id === 'for_each_place_start_2')).toMatchObject({ parent: 'for_each_place_2', hidden: true })
    expect(result.pastedRootIds).toEqual(['for_each_place_2'])
    expect(copyGraphNodes(graph, ['for_each_place_start'], {}).nodes).toEqual([])
  })

  it('rewrites template and selector references only for copied ids', () => {
    expect(remapReferences({ text: 'Hi {{#a.name#}} {{#b.x#}}', selector: ['a', 'items'] }, { a: 'a_2' })).toEqual({ text: 'Hi {{#a_2.name#}} {{#b.x#}}', selector: ['a_2', 'items'] })
  })

  it('adds a node after a step, in between the step and what followed it', async () => {
    const graph = await loadSampleGraph()
    const node = createGraphNode({ id: 'summarise', kind: 'llm', parent: null })
    const inserted = insertGraphNodeAfter(graph, node, { source: 'search_maps', sourceHandle: 'source' })
    const fromSearch = inserted.edges.filter((edge) => edge.source === 'search_maps').map((edge) => edge.target)
    expect(fromSearch).toEqual(['summarise'])
    expect(inserted.edges.some((edge) => edge.source === 'summarise' && edge.target === 'for_each_place')).toBe(true)
  })

  it('disconnects a step and moves an arrow end', async () => {
    const graph = await loadSampleGraph()
    const disconnected = disconnectGraphNodes(graph, ['search_maps'])
    expect(disconnected.edges.some((edge) => edge.source === 'search_maps' || edge.target === 'search_maps')).toBe(false)

    const arrow = graph.edges.find((edge) => edge.source === 'approve_message') as AgentGraph['edges'][number]
    const moved = reconnectGraphEdge(graph, arrow.id, { source: 'approve_message', sourceHandle: 'skip', target: 'send_whatsapp' })
    expect(moved.edges.filter((edge) => edge.source === 'approve_message').map((edge) => edge.sourceHandle)).toEqual(['skip'])
  })

  it('nudges selected positions and words the ask-the-builder draft', async () => {
    const graph = await loadSampleGraph()
    expect(nudgeLayouts(['a', 'missing'], { a: { nodeId: 'a', x: 10, y: 10 } }, { x: 10, y: -50 })).toEqual([{ nodeId: 'a', x: 20, y: -40 }])
    expect(buildAskBuilderText(graph, ['write_message'])).toBe('About the "Write a short message" step: ')
  })
})

describe('placement', () => {
  it('places a new step after its anchor and nudges it clear of the others', () => {
    const anchor = { x: 0, y: 0, width: 240, height: 100 }
    const size = { width: 240, height: 100 }
    expect(placeNewNode(anchor, size, [anchor], { x: 0, y: 0 }, 'down')).toEqual({ x: 0, y: 156 })
    const blocker = { x: 0, y: 156, width: 240, height: 100 }
    const placed = placeNewNode(anchor, size, [anchor, blocker], { x: 0, y: 0 }, 'down')
    expect(rectsOverlap({ ...placed, ...size }, blocker)).toBe(false)
    expect(rectsOverlap({ ...placed, ...size }, anchor)).toBe(false)
    expect(placeNewNode(anchor, size, [anchor], { x: 0, y: 0 }, 'right')).toEqual({ x: 312, y: 0 })
  })

  it('never returns a spot that overlaps, even in a crowded area', () => {
    const occupied = Array.from({ length: 30 }, (_, index) => ({ x: (index % 6) * 260, y: Math.floor(index / 6) * 130, width: 240, height: 110 }))
    const spot = findFreePosition({ x: 0, y: 0 }, { width: 240, height: 110 }, occupied, 'right')
    expect(occupied.some((rect) => rectsOverlap({ ...spot, width: 240, height: 110 }, rect))).toBe(false)
  })

  it('places steps added on the canvas next to the step they follow, inside their loop, and grows the loop', async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    const graph = await loadSampleGraph()
    const known: Record<string, NodeLayout> = Object.fromEntries(graph.nodes.map((node, index) => [node.id, { nodeId: node.id, x: 0, y: index * 200, width: node.container ? 320 : null, height: node.container ? 200 : null }]))
    known.write_message = { nodeId: 'write_message', x: 40, y: 70 }
    const node = createGraphNode({ id: 'check_it', kind: 'llm', parent: 'for_each_place' })
    const withNode = insertGraphNodeAfter(graph, node, { source: 'write_message', sourceHandle: 'source' })
    const placements = placeUnplacedNodes({ graph: withNode, known, measured: new Map(), fallback: { x: 0, y: 0 } })
    const placed = placements.find((layout) => layout.nodeId === 'check_it')
    expect(placed).toMatchObject({ x: 40 + 240 + 72 })
    const grown = placements.find((layout) => layout.nodeId === 'for_each_place')
    expect(grown?.width).toBeGreaterThan(320)
  })
})

describe('shortcuts', () => {
  const press = (key: string, modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers })

  it('uses ⌘ on macOS and Ctrl elsewhere', () => {
    expect(resolveShortcut(press('z', { metaKey: true }), true)).toBe('undo')
    expect(resolveShortcut(press('z', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(resolveShortcut(press('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo')
    expect(resolveShortcut(press('y', { ctrlKey: true }), false)).toBe('redo')
    expect(resolveShortcut(press('c', { ctrlKey: true }), false)).toBe('copy')
    expect(resolveShortcut(press('v', { metaKey: true }), true)).toBe('paste')
    expect(resolveShortcut(press('d', { metaKey: true }), true)).toBe('duplicate')
    expect(resolveShortcut(press('a', { ctrlKey: true }), false)).toBe('select-all')
    expect(resolveShortcut(press('z', { ctrlKey: true }), true)).toBeNull()
  })

  it('maps the plain keys', () => {
    expect(resolveShortcut(press('Delete'), true)).toBe('delete')
    expect(resolveShortcut(press('Backspace'), true)).toBe('delete')
    expect(resolveShortcut(press('Escape'), true)).toBe('deselect')
    expect(resolveShortcut(press('ArrowLeft'), true)).toBe('nudge-left')
    expect(resolveShortcut(press('ArrowDown', { shiftKey: true }), true)).toBe('nudge-down')
    expect(resolveShortcut(press('+'), true)).toBe('zoom-in')
    expect(resolveShortcut(press('-'), true)).toBe('zoom-out')
    expect(resolveShortcut(press('f'), true)).toBe('fit')
    expect(resolveShortcut(press('!', { shiftKey: true }), true)).toBe('fit')
    expect(resolveShortcut(press('a'), true)).toBe('add-node')
    expect(resolveShortcut(press('?', { shiftKey: true }), true)).toBe('show-shortcuts')
    expect(resolveShortcut(press('F10', { shiftKey: true }), true)).toBe('context-menu')
    expect(resolveShortcut(press('x'), true)).toBeNull()
  })

  it('leaves typing in fields alone', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
  })
})

describe('node card content', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('previews the key setting with references as chips', async () => {
    const graph = await loadSampleGraph()
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
    const sendNode = graph.nodes.find((node) => node.id === 'send_whatsapp') as AgentGraph['nodes'][number]
    expect(describeNodePreview(sendNode, nodesById)).toEqual([
      { kind: 'text', text: 'Phone ' },
      { kind: 'reference', text: 'phone' },
      { kind: 'text', text: ' · text ' },
      { kind: 'reference', text: 'write message' },
    ])
    expect(readableReference('env.API_TOKEN', nodesById)).toBe('API_TOKEN')
    expect(readableReference(`${startIdOf(graph)}.city`, nodesById)).toBe('city')
  })

  it('shows retry, error path and timeout badges', async () => {
    const graph = await loadSampleGraph()
    const changed = updateGraphNode(graph, 'send_whatsapp', { retry: { maxRetries: 2, intervalMs: 2000, backoff: 2 }, onError: { strategy: 'fail-branch', values: {} }, timeoutMs: 30_000 })
    const node = changed.nodes.find((candidate) => candidate.id === 'send_whatsapp') as AgentGraph['nodes'][number]
    expect(describeNodeBadges(node).map((badge) => badge.label)).toEqual(['Retry 2×', 'Error path', '30 s'])
    expect(node.ports.outputs.map((outputPort) => outputPort.id)).toEqual(['source', 'fail-branch'])
  })
})
