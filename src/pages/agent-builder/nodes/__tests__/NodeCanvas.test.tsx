import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import type { NodeCanvasProps } from '../contracts'
import { writeCanvasClipboard } from '../flow/canvasCommands'
import { NodeCanvas } from '../NodeCanvas'
import { NodesView } from '../NodesView'

// Real ELK is slow in jsdom; these tests only need non-overlapping positions.
vi.mock('../flow/layoutEngine', () => import('./fakeElkLayout'))

async function loadSampleGraph(): Promise<AgentGraph> {
  return sampleAgentGraphBackend.getAgentGraph('maps-leads')
}

function renderCanvas(graph: AgentGraph, overrides: Partial<NodeCanvasProps> = {}) {
  const props: NodeCanvasProps = {
    graph,
    positions: {},
    viewport: null,
    kindNames: {},
    selectedNodeIds: [],
    readOnly: false,
    onSelectionChange: vi.fn(),
    onMoveNodes: vi.fn(),
    onViewportChange: vi.fn(),
    onConnect: vi.fn(),
    onDelete: vi.fn(),
    onApplyEdit: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onOpenPalette: vi.fn(),
    onAddNodeAfter: vi.fn(),
    onChangeAction: vi.fn(),
    onAskBuilder: vi.fn(),
    onOpenNodeSettings: vi.fn(),
    ...overrides,
  }
  const view = render(<NodeCanvas {...props} />)
  return { ...view, props }
}

async function findFlowNode(nodeId: string): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('node-canvas')
  await waitFor(() => expect(canvas.querySelector(`.react-flow__node[data-id="${nodeId}"]`)).not.toBeNull())
  return canvas.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement
}

describe('NodeCanvas', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    writeCanvasClipboard(null)
  })

  it('draws cards with the plugin line, preview chips, approval tone, setup status and named branch ports', async () => {
    const graph = await loadSampleGraph()
    renderCanvas(graph, { pluginStatuses: { 'whatsapp-web': { label: 'Not linked', tone: 'amber' } } })
    await findFlowNode('send_whatsapp')
    const sendCard = screen.getByTestId('node-send_whatsapp')
    expect(sendCard).toHaveTextContent('Whatsapp Web · send_message')
    expect(sendCard).toHaveTextContent('Not linked')
    expect(within(sendCard).getByText('write message')).toBeInTheDocument()
    expect(screen.getByTestId('node-approve_message').className).toContain('bg-amber-tint')
    expect(screen.getByRole('button', { name: 'Connect from the Send exit of Ask me before sending' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect from the Skip exit of Ask me before sending' })).toBeInTheDocument()
  })

  it('shows compact cards when zoomed out to 40% or less', async () => {
    const graph = await loadSampleGraph()
    renderCanvas(graph, { viewport: { x: 0, y: 0, zoom: 0.3 } })
    await findFlowNode('write_message')
    expect(screen.getByTestId('node-write_message')).toHaveAttribute('data-compact', 'true')
    expect(within(screen.getByTestId('node-write_message')).queryByText('name')).not.toBeInTheDocument()
  })

  it('shows full cards at normal zoom', async () => {
    const graph = await loadSampleGraph()
    renderCanvas(graph, { viewport: { x: 0, y: 0, zoom: 1 } })
    await findFlowNode('write_message')
    expect(screen.getByTestId('node-write_message')).not.toHaveAttribute('data-compact')
  })

  it('dispatches the context menu actions', async () => {
    const graph = await loadSampleGraph()
    const { props } = renderCanvas(graph)
    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    const menu = await screen.findByRole('menu', { name: 'Actions for Send WhatsApp' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.replace(/⌘D|Ctrl\+D|⌫|A$/, ''))).toEqual([
      'Add node after',
      'Change action',
      'Ask the builder about this',
      'Duplicate',
      'Disconnect',
      'Delete',
    ])

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Add node after/ }))
    expect(props.onAddNodeAfter).toHaveBeenCalledWith({ source: 'send_whatsapp', sourceHandle: 'source' })

    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change action' }))
    expect(props.onChangeAction).toHaveBeenCalledWith('send_whatsapp')

    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask the builder about this' }))
    expect(props.onAskBuilder).toHaveBeenCalledWith('About the "Send WhatsApp" step: ')

    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }))
    expect(props.onApplyEdit).toHaveBeenLastCalledWith(expect.any(Function), 'duplicated Send WhatsApp')
    const duplicated = vi.mocked(props.onApplyEdit!).mock.calls.at(-1)![0](graph)
    expect(duplicated.nodes.some((node) => node.id === 'send_whatsapp_2' && node.parent === 'for_each_place')).toBe(true)

    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }))
    const disconnected = vi.mocked(props.onApplyEdit!).mock.calls.at(-1)![0](graph)
    expect(disconnected.edges.some((edge) => edge.source === 'send_whatsapp' || edge.target === 'send_whatsapp')).toBe(false)

    fireEvent.contextMenu(await findFlowNode('send_whatsapp'), { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(props.onDelete).toHaveBeenCalledWith({ nodeIds: ['send_whatsapp'], edgeIds: [] })
  })

  it('leaves Change action out for builtin steps and closes the menu with Escape', async () => {
    const graph = await loadSampleGraph()
    renderCanvas(graph)
    fireEvent.contextMenu(await findFlowNode('write_message'), { clientX: 40, clientY: 40 })
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Change action' })).not.toBeInTheDocument()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('runs keyboard shortcuts on the selection', async () => {
    const graph = await loadSampleGraph()
    const positions: Record<string, NodeLayout> = { write_message: { nodeId: 'write_message', x: 40, y: 80 } }
    const { props } = renderCanvas(graph, { selectedNodeIds: ['write_message'], positions })
    await findFlowNode('write_message')
    const canvas = screen.getByTestId('node-canvas')

    fireEvent.keyDown(canvas, { key: 'Delete' })
    expect(props.onDelete).toHaveBeenCalledWith({ nodeIds: ['write_message'], edgeIds: [] })

    fireEvent.keyDown(canvas, { key: 'z', metaKey: true })
    expect(props.onUndo).toHaveBeenCalled()
    fireEvent.keyDown(canvas, { key: 'z', metaKey: true, shiftKey: true })
    expect(props.onRedo).toHaveBeenCalled()

    fireEvent.keyDown(canvas, { key: 'd', metaKey: true })
    expect(props.onApplyEdit).toHaveBeenLastCalledWith(expect.any(Function), 'duplicated Write a short message')

    fireEvent.keyDown(canvas, { key: 'c', metaKey: true })
    fireEvent.keyDown(canvas, { key: 'v', metaKey: true })
    // Paste reads the system clipboard first (none in jsdom), then the session copy.
    await waitFor(() => expect(props.onApplyEdit).toHaveBeenLastCalledWith(expect.any(Function), 'pasted Write a short message'))

    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(props.onMoveNodes).toHaveBeenLastCalledWith([expect.objectContaining({ nodeId: 'write_message', x: 50, y: 80 })])

    fireEvent.keyDown(canvas, { key: 'a', metaKey: true })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(graph.nodes.filter((node) => !node.hidden).map((node) => node.id))

    fireEvent.keyDown(canvas, { key: 'a' })
    expect(props.onOpenPalette).toHaveBeenCalled()

    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(props.onSelectionChange).toHaveBeenCalledWith([])

    fireEvent.keyDown(canvas, { key: '?', shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('ignores shortcuts while read-only or typing', async () => {
    const graph = await loadSampleGraph()
    const { props } = renderCanvas(graph, { selectedNodeIds: ['write_message'], readOnly: true })
    await findFlowNode('write_message')
    fireEvent.keyDown(screen.getByTestId('node-canvas'), { key: 'Delete' })
    fireEvent.keyDown(screen.getByTestId('node-canvas'), { key: 'z', metaKey: true })
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(props.onUndo).not.toHaveBeenCalled()
  })

  it('connects from a port with the keyboard, refusing invalid targets', async () => {
    const graph = await loadSampleGraph()
    const { props } = renderCanvas(graph)
    await findFlowNode('write_message')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Connect from the Skip exit of Ask me before sending' }), { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('Connecting from Ask me before sending')
    // Write a short message comes before the approval: an arrow back would close a circle.
    expect(screen.getByTestId('node-write_message').className).toContain('is-invalid-target')
    expect(screen.getByTestId('node-send_whatsapp').className).toContain('is-valid-target')

    const sendNode = await findFlowNode('send_whatsapp')
    act(() => sendNode.focus())
    fireEvent.keyDown(sendNode, { key: 'Enter' })
    expect(props.onConnect).toHaveBeenCalledWith({ source: 'approve_message', sourceHandle: 'skip', target: 'send_whatsapp' })
  })

  it('opens the palette from the empty state of an agent with only Start and End', async () => {
    const graph = await loadSampleGraph()
    const bare: AgentGraph = { ...graph, nodes: graph.nodes.filter((node) => node.kind === 'start' || node.kind === 'end'), edges: [] }
    const { props } = renderCanvas(bare)
    fireEvent.click(await screen.findByRole('button', { name: 'Add node' }))
    expect(props.onOpenPalette).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Write in chat' }))
    expect(props.onAskBuilder).toHaveBeenCalledWith('')
  })

  it('places a step added after another next to it and reports the position', async () => {
    const graph = await loadSampleGraph()
    const onMoveNodes = vi.fn()
    const { rerender, props } = renderCanvas(graph, { onMoveNodes })
    await findFlowNode('write_message')
    const added = { ...graph.nodes.find((node) => node.id === 'write_message')!, id: 'check_message', title: 'Check the message', displayTitle: 'Check the message' }
    const withAdded: AgentGraph = { ...graph, nodes: [...graph.nodes, added], edges: [...graph.edges, { id: 'w-c', documentId: null, source: 'write_message', sourceHandle: 'source', target: 'check_message', unused: false }] }
    rerender(<NodeCanvas {...props} graph={withAdded} />)
    await waitFor(() => expect(onMoveNodes).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ nodeId: 'check_message' })])))
    const placed = onMoveNodes.mock.calls.flatMap((call) => call[0] as NodeLayout[]).find((layout) => layout.nodeId === 'check_message') as NodeLayout
    expect(placed.x).toBeGreaterThan(0)
    expect(await findFlowNode('check_message')).toBeInTheDocument()
  })
})

describe('NodesView canvas edits', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('deletes with the keyboard as one undoable edit', async () => {
    render(<NodesView agent={readStoredAgent('maps-leads')} />)
    const canvas = await screen.findByTestId('node-canvas')
    await waitFor(() => expect(canvas.querySelector('.react-flow__node[data-id="send_whatsapp"]')).not.toBeNull())
    fireEvent.click(screen.getByTestId('node-send_whatsapp'))
    await waitFor(() => expect(screen.getByTestId('node-send_whatsapp').className).toContain('border-brand'))
    fireEvent.keyDown(canvas, { key: 'Delete' })
    await waitFor(() => expect(screen.queryByTestId('node-send_whatsapp')).not.toBeInTheDocument())
    expect(screen.getByRole('status', { name: '' })).toBeDefined()
    expect(screen.getByRole('toolbar', { name: 'Nodes' })).toHaveTextContent('Unsaved changes')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByTestId('node-send_whatsapp')).toBeInTheDocument())
  })
})
