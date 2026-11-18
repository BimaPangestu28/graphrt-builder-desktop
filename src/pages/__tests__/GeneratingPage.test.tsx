import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleBuilder, sampleBuildDrafts, sampleBuilderBackend, sampleBuildTiming } from '@/api/sampleBackend/builder'
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

  it('streams the explanation, step titles and token count while the model writes', async () => {
    const draftingExplanation = sampleBuildDrafts.drafting!.explanation
    renderGeneratingPage()
    await advanceBy(sampleBuildTiming.buildStageDelayMs)
    expect(screen.getByText(/Picked the steps/)).toHaveTextContent('In progress')
    expect(screen.getByText(/^Writing… \d+ tokens$/)).toBeInTheDocument()
    expect(screen.getByText(/^This agent searches/)).not.toHaveTextContent(draftingExplanation)
    expect(screen.queryByRole('list', { name: 'Steps written so far' })).not.toBeInTheDocument()

    await advanceBy(sampleBuildTiming.buildStageDelayMs - 1)
    expect(screen.getByText(draftingExplanation)).toBeInTheDocument()
    expect(screen.getByText('Writing… 1,184 tokens')).toBeInTheDocument()
    const writtenSteps = screen.getByRole('list', { name: 'Steps written so far' })
    expect(within(writtenSteps).getAllByRole('listitem').map((stepItem) => stepItem.textContent)).toEqual(
      sampleBuildDrafts.drafting!.stepTitles.map((stepTitle, stepIndex) => `${stepIndex + 1}${stepTitle}`),
    )

    await advanceBy(1)
    expect(screen.getByText(/Fixed problems/)).toHaveTextContent('In progress')
    expect(screen.getByText(/^Fixing… \d+ tokens$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Writing…/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Steps written so far' })).not.toBeInTheDocument()
    // Shown under the checklist and, now that its round is over, announced once.
    expect(screen.getAllByText(draftingExplanation)).toHaveLength(2)

    await advanceBy(sampleBuildTiming.buildStageDelayMs)
    expect(screen.getByText(/Checking it again/)).toHaveTextContent('In progress')
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument()
    expect(screen.getByText(sampleBuildDrafts.repairing!.explanation)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Steps written so far' })).getAllByRole('listitem')).toHaveLength(6)
  })

  it('announces the explanation once its round is over, not while it streams', async () => {
    const buildAgentSpy = vi.spyOn(sampleBuilderBackend, 'buildAgent').mockImplementation(async (_request, onProgress) => {
      onProgress({ stage: 'drafting', message: 'Writing the steps', draft: { explanation: 'This agent sends', stepTitles: ['Search places'], outputTokens: 12345 } })
      await new Promise((resolve) => setTimeout(resolve, 100))
      onProgress({ stage: 'drafting', message: 'Writing the steps', draft: { explanation: 'This agent sends a daily summary.', stepTitles: ['Search places', 'Send'], outputTokens: 23456 } })
      await new Promise((resolve) => setTimeout(resolve, 100))
      onProgress({ stage: 'checking', message: 'No problems found' })
      return new Promise(() => {})
    })
    const { container } = renderGeneratingPage()
    const liveRegion = () => container.querySelector('.sr-only[aria-live="polite"]')!
    await advanceBy(0)
    expect(buildAgentSpy).toHaveBeenCalled()
    expect(screen.getByText('This agent sends')).toBeInTheDocument()
    expect(screen.getByText('Writing… 12,345 tokens')).toHaveAttribute('aria-hidden', 'true')
    expect(liveRegion()).toHaveTextContent(/^$/)

    await advanceBy(100)
    expect(screen.getByText('Writing… 23,456 tokens')).toBeInTheDocument()
    expect(liveRegion()).toHaveTextContent(/^$/)

    await advanceBy(100)
    expect(liveRegion()).toHaveTextContent('This agent sends a daily summary.')
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument()
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
