import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleBuilder, sampleBuilderBackend, sampleBuildTiming } from '@/api/sampleBackend/builder'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { openBuilderDelayMs } from '@/data/mapsLeadsAgent'
import { agentPath, routePaths } from '@/routes'
import { GeneratingPage } from '../GeneratingPage'

const buildRequestState = { buildRequest: { description: 'Find cafes and message them', kind: 'task' } }

function renderGeneratingPage(locationState: unknown = buildRequestState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: routePaths.generating, state: locationState }]}>
      <Routes>
        <Route path={routePaths.generating} element={<GeneratingPage />} />
        <Route path={agentPath('builder', 'maps-leads')} element={<p>Builder screen</p>} />
        <Route path={routePaths.connections} element={<p>Connections screen</p>} />
        <Route path={routePaths.newAgent} element={<p>New agent screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Lets pending promises settle, then moves fake time forward. */
async function advanceBy(milliseconds: number) {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds))
}

describe('GeneratingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSampleAgents()
    resetSampleBuilder()
    resetSampleCredentials()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('builds the request from the new agent screen with progress driving the checklist', async () => {
    const buildAgentSpy = vi.spyOn(sampleBuilderBackend, 'buildAgent')
    renderGeneratingPage()
    expect(screen.getByText('Find cafes and message them')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New agent' })).toBeInTheDocument()
    await advanceBy(0)
    expect(buildAgentSpy).toHaveBeenCalledWith({ description: 'Find cafes and message them', kind: 'task' }, expect.any(Function))
    expect(screen.getByText('Building your agent')).toBeInTheDocument()
    expect(screen.getByText(/Understood the job/)).toHaveTextContent('In progress')

    await advanceBy(sampleBuildTiming.buildStageDelayMs * 2)
    expect(screen.getByText(/Understood the job/)).toHaveTextContent('Done')
    expect(screen.getByText(/Fixed problems/)).toHaveTextContent('In progress')
    expect(screen.getByText('Step 4 read the wrong field for the place name')).toBeInTheDocument()
  })

  it('shows the saved agent and opens its builder', async () => {
    renderGeneratingPage()
    await advanceBy(sampleBuildTiming.buildStageDelayMs * 5)
    expect(screen.getByText('Your agent is ready')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText('Send WhatsApp')).toBeInTheDocument()
    await advanceBy(openBuilderDelayMs)
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })

  it('builds nothing when opened without a request and links back to New agent', async () => {
    const buildAgentSpy = vi.spyOn(sampleBuilderBackend, 'buildAgent')
    renderGeneratingPage(null)
    await advanceBy(0)
    expect(buildAgentSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Nothing to build yet' })).toBeInTheDocument()
    expect(screen.queryByText(/Find cafes in Bandar Lampung/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Describe a new agent' }))
    expect(screen.getByText('New agent screen')).toBeInTheDocument()
  })

  it('links to Connections when no model key is set up', async () => {
    await sampleCredentialsBackend.deleteApiKey('openai')
    renderGeneratingPage()
    await advanceBy(0)
    expect(screen.getByRole('alert')).toHaveTextContent('Add an AI key to build agents')
    fireEvent.click(screen.getByRole('link', { name: 'Open Connections' }))
    expect(screen.getByText('Connections screen')).toBeInTheDocument()
  })

  it('offers Try again after other failures', async () => {
    const buildAgentSpy = vi.spyOn(sampleBuilderBackend, 'buildAgent').mockRejectedValueOnce(new BackendError('workflow', 'The model returned an invalid flow'))
    renderGeneratingPage()
    await advanceBy(0)
    expect(screen.getByRole('alert')).toHaveTextContent('The model returned an invalid flow')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await advanceBy(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(buildAgentSpy).toHaveBeenCalledTimes(2)
  })
})
