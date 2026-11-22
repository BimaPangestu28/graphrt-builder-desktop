import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgentGraphs, setSampleBuilderBusy } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent, summarizeStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { BuilderAgentPanel } from '../../BuilderAgentPanel'
import { NodesView } from '../NodesView'

// Real ELK is slow in jsdom; these tests only need non-overlapping positions.
vi.mock('../flow/layoutEngine', () => import('./fakeElkLayout'))

const agentId = 'maps-leads'

function renderPanel() {
  return render(
    <MemoryRouter>
      <BuilderAgentPanel agent={readStoredAgent(agentId)} flowSummary={summarizeStoredAgent(agentId)} flowSummaryError={null} highlightedStepIds={new Set()} requirements={[]} />
    </MemoryRouter>,
  )
}

describe('NodesView', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('switches between Steps and Nodes and keeps the Steps list as it was', async () => {
    renderPanel()
    expect(screen.getByRole('tab', { name: 'Steps' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Search Google Maps')).toBeInTheDocument()
    expect(screen.queryByTestId('nodes-view')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Nodes' }))
    expect(screen.getByRole('tab', { name: 'Nodes' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('nodes-view')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'builder-panel-nodes')

    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }))
    expect(screen.queryByTestId('nodes-view')).not.toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('Search Google Maps')).toBeInTheDocument()
  })

  it('draws the sample graph read-only with its steps, loop body and toolbar', async () => {
    render(<NodesView agent={readStoredAgent(agentId)} />)
    const canvas = await screen.findByTestId('node-canvas')
    await waitFor(() => expect(within(canvas).getByTestId('node-write_message')).toBeInTheDocument())

    expect(within(canvas).getByText('Search Google Maps')).toBeInTheDocument()
    expect(within(canvas).getByText('For each place')).toBeInTheDocument()
    expect(within(canvas).getByText('Ask me before sending')).toBeInTheDocument()
    expect(within(canvas).getByTestId('node-send_whatsapp')).toHaveTextContent('Send WhatsApp message')
    expect(within(canvas).getByTestId('marker-for_each_place_start')).toBeInTheDocument()
    expect(within(canvas).queryByTestId('node-for_each_place_start')).not.toBeInTheDocument()

    const toolbar = screen.getByRole('toolbar', { name: 'Nodes' })
    expect(within(toolbar).getByRole('status')).toHaveTextContent('Saved as v7')
    expect(within(toolbar).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('opens the Add node palette with the offered kinds', async () => {
    render(<NodesView agent={readStoredAgent(agentId)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add node' }))
    const palette = await screen.findByRole('complementary', { name: 'Add node' })
    expect(await within(palette).findByText('Ask a model')).toBeInTheDocument()
    expect(within(palette).queryByText('iteration-start')).not.toBeInTheDocument()
  })

  it('shows the builder-busy banner while a chat change runs', async () => {
    render(<NodesView agent={readStoredAgent(agentId)} />)
    await screen.findByTestId('node-canvas')
    act(() => setSampleBuilderBusy(agentId, true))
    expect(await screen.findByText(/The builder is changing this agent/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto-layout' })).toBeDisabled()
  })
})
