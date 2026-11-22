import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import type { NodeCanvasProps } from '../contracts'
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
    viewport: { x: 0, y: 0, zoom: 1 },
    kindNames: {},
    selectedNodeIds: [],
    readOnly: false,
    onSelectionChange: vi.fn(),
    onMoveNodes: vi.fn(),
    onViewportChange: vi.fn(),
    onApplyEdit: vi.fn(),
    onRequestAddNode: vi.fn(),
    onAddNote: vi.fn(),
    ...overrides,
  }
  return { ...render(<NodeCanvas {...props} />), props }
}

async function findFlowNode(nodeId: string): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('node-canvas')
  await waitFor(() => expect(canvas.querySelector(`.react-flow__node[data-id="${nodeId}"]`)).not.toBeNull())
  return canvas.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement
}

function viewportScale(): number {
  const transform = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
  return Number(transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? 'NaN')
}

describe('NodeCanvas polish', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('draws End as a pill', async () => {
    renderCanvas(await loadSampleGraph())
    await findFlowNode('end')
    expect(screen.getByTestId('node-end')).toHaveAttribute('data-shape', 'pill')
    expect(screen.getByTestId('node-end')).toHaveTextContent('End')
  })

  it('shows compact cards below 60% and full cards from 60%', async () => {
    const graph = await loadSampleGraph()
    const { unmount } = renderCanvas(graph, { viewport: { x: 0, y: 0, zoom: 0.55 } })
    await findFlowNode('write_message')
    expect(screen.getByTestId('node-write_message')).toHaveAttribute('data-compact', 'true')
    unmount()
    renderCanvas(graph, { viewport: { x: 0, y: 0, zoom: 0.6 } })
    await findFlowNode('write_message')
    expect(screen.getByTestId('node-write_message')).not.toHaveAttribute('data-compact')
  })

  it('shows a "+" on a hovered arrow that opens the palette on that arrow', async () => {
    const graph = await loadSampleGraph()
    const { props } = renderCanvas(graph)
    await findFlowNode('write_message')
    const edge = graph.edges.find((candidate) => candidate.source === 'search_maps')!
    const edgeElement = await waitFor(() => {
      const element = document.querySelector(`.react-flow__edge[data-id="${edge.id}"] g`)
      expect(element).not.toBeNull()
      return element as Element
    })
    fireEvent.mouseEnter(edgeElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a step on this arrow' }))
    expect(props.onRequestAddNode).toHaveBeenCalledWith({ type: 'on-edge', edgeId: edge.id })
  })

  it('hides the arrow "+" while read-only', async () => {
    const graph = await loadSampleGraph()
    renderCanvas(graph, { readOnly: true })
    await findFlowNode('write_message')
    const edge = graph.edges.find((candidate) => candidate.source === 'search_maps')!
    await waitFor(() => expect(document.querySelector(`.react-flow__edge[data-id="${edge.id}"] g`)).not.toBeNull())
    fireEvent.mouseEnter(document.querySelector(`.react-flow__edge[data-id="${edge.id}"] g`) as Element)
    expect(screen.queryByRole('button', { name: 'Add a step on this arrow' })).not.toBeInTheDocument()
  })

  it('adds a note or a node from the empty-canvas menu', async () => {
    const { props } = renderCanvas(await loadSampleGraph())
    await findFlowNode('write_message')
    const pane = document.querySelector('.react-flow__pane') as Element
    fireEvent.contextMenu(pane, { clientX: 300, clientY: 40 })
    const menu = await screen.findByRole('menu', { name: 'Actions for the canvas' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add note here' }))
    expect(props.onAddNote).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) })

    fireEvent.contextMenu(pane, { clientX: 300, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Add node here/ }))
    expect(props.onRequestAddNode).toHaveBeenCalledWith(expect.objectContaining({ type: 'at-position' }))
  })

  it('centres a step on a focus request, zooming in to a readable size', async () => {
    const graph = await loadSampleGraph()
    const view = renderCanvas(graph, { viewport: { x: 0, y: 0, zoom: 0.4 } })
    await findFlowNode('end')
    expect(viewportScale()).toBeCloseTo(0.4)
    view.rerender(<NodeCanvas {...view.props} focusRequest={{ nodeId: 'end', sequence: 1 }} />)
    await waitFor(() => expect(viewportScale()).toBeCloseTo(0.85))
  })
})

describe('NodesView selection from the palette and problems', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })
  afterEach(() => vi.restoreAllMocks())

  it('selects a step added from the palette and opens its settings', async () => {
    render(
      <MemoryRouter>
        <NodesView agent={readStoredAgent('maps-leads')} autosaveDelayMs={null} />
      </MemoryRouter>,
    )
    await findFlowNode('search_maps')
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }))
    const palette = await screen.findByRole('complementary', { name: 'Add node' })
    fireEvent.click(await within(palette).findByText('Ask a model'))
    const inspector = await screen.findByRole('complementary', { name: 'Step settings' })
    expect(inspector).toHaveTextContent('ask_a_model')
    await waitFor(() => expect(document.querySelector('.react-flow__node[data-id="ask_a_model"]')).toHaveClass('selected'))
  })

  it('Show node selects the step and centres it on the canvas', async () => {
    const loaded = await sampleAgentGraphBackend.getAgentGraph('maps-leads')
    const broken: AgentGraph = { ...loaded, problems: [{ severity: 'error', code: 'unreachable', message: 'End is not reachable', nodeId: 'end', edgeId: null }] }
    vi.spyOn(sampleAgentGraphBackend, 'getAgentGraph').mockResolvedValue(broken)
    render(
      <MemoryRouter>
        <NodesView agent={readStoredAgent('maps-leads')} autosaveDelayMs={null} />
      </MemoryRouter>,
    )
    await findFlowNode('end')
    fireEvent.click(within(screen.getByRole('region', { name: 'Problems' })).getByRole('button', { name: 'Show node' }))
    expect(await screen.findByRole('complementary', { name: 'Step settings' })).toHaveTextContent('End')
    await waitFor(() => expect(viewportScale()).toBeGreaterThanOrEqual(0.85))
  })
})
