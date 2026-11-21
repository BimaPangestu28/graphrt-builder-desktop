import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { stopAgentRevision } from '@/api/builder'
import { isSampleBuilderBusy, resetSampleAgentGraphs, setSampleBuilderBusy } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { NodesView } from '../NodesView'

const agentId = 'maps-leads'

describe('Stop the builder', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('stops the running change from the sync banner and gives the canvas back', async () => {
    render(
      <MemoryRouter>
        <NodesView agent={readStoredAgent(agentId)} autosaveDelayMs={null} />
      </MemoryRouter>,
    )
    await screen.findByTestId('node-canvas')
    act(() => setSampleBuilderBusy(agentId, true))
    expect(await screen.findByText(/The builder is changing this agent/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop the builder' }))

    await waitFor(() => expect(screen.queryByText(/The builder is changing this agent/)).not.toBeInTheDocument())
    expect(isSampleBuilderBusy(agentId)).toBe(false)
  })

  it('reports whether a change was running', async () => {
    expect(await stopAgentRevision(agentId)).toBe(false)
    setSampleBuilderBusy(agentId, true)
    expect(await stopAgentRevision(agentId)).toBe(true)
  })
})
