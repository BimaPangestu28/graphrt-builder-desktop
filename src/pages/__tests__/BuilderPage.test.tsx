import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleBuilder, sampleBuilderBackend, sampleBuildTiming } from '@/api/sampleBackend/builder'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { agentPath, agentRoutePatterns, routePaths } from '@/routes'
import { BuilderPage } from '../BuilderPage'

function renderBuilderPage(agentId = 'maps-leads') {
  return render(
    <MemoryRouter initialEntries={[agentPath('builder', agentId)]}>
      <Routes>
        <Route path={agentRoutePatterns.builder} element={<BuilderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function getStepsList() {
  return screen.getAllByRole('list').find((list) => list.tagName === 'OL' && within(list).queryByText('Search Google Maps'))!
}

async function sendChange(request: string) {
  fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: request } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('BuilderPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleBuilder()
    resetSampleCredentials()
    sampleBuildTiming.revisionStageDelayMs = 1
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the agent from the route and shows its steps and what it needs', async () => {
    renderBuilderPage()
    expect(screen.getByText('Loading agent…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(await screen.findByText('Write a short message')).toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Write a short message').closest('li')).toHaveClass('ml-6')
    expect(screen.getByText('Search Google Maps').closest('li')).not.toHaveClass('ml-6')
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect WhatsApp on this Mac' })).toHaveAttribute('href', routePaths.connectWhatsApp)
    expect(await screen.findByText('OpenAI · Keychain')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test with 1 place/ })).toHaveAttribute('href', routePaths.testRun)
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', routePaths.versionHistory)
    expect(within(screen.getByRole('region', { name: 'Agent' })).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', routePaths.scheduleAgent)
  })

  it('builds header links for the agent in the route', async () => {
    renderBuilderPage('invoice-reminders')
    expect(await screen.findByRole('heading', { name: 'Invoice reminders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', agentPath('versionHistory', 'invoice-reminders'))
  })

  it('sends a change through reviseAgent, highlights changed steps, and undoes it', async () => {
    const reviseAgentSpy = vi.spyOn(sampleBuilderBackend, 'reviseAgent')
    const restoreSpy = vi.spyOn(sampleAgentsBackend, 'restoreAgentVersion')
    renderBuilderPage()
    await screen.findByText('Write a short message')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    await sendChange('Skip places with fewer than 50 reviews')
    expect(screen.getByText('Skip places with fewer than 50 reviews', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByLabelText('Describe a change')).toHaveValue('')
    expect(reviseAgentSpy).toHaveBeenCalledWith('maps-leads', 'Skip places with fewer than 50 reviews', expect.any(Function))
    expect(await screen.findByText('Changed just now')).toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Redo' })).toBeInTheDocument()
    expect(restoreSpy).toHaveBeenCalledWith('maps-leads', 7)
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
    expect(within(getStepsList()).getAllByRole('listitem')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(await screen.findByText('Changed just now')).toBeInTheDocument()
    expect(restoreSpy).toHaveBeenLastCalledWith('maps-leads', 8)
  })

  it('shows the stored workflow document in the Source tab', async () => {
    renderBuilderPage()
    await screen.findByRole('heading', { name: 'Maps leads to WhatsApp' })
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText(/type: iteration/)).toBeInTheDocument()
  })

  it('explains a failed change in the chat', async () => {
    vi.spyOn(sampleBuilderBackend, 'reviseAgent').mockRejectedValue(new BackendError('model', 'The model is not reachable'))
    renderBuilderPage()
    await screen.findByText('Write a short message')
    await sendChange('Make it friendlier')
    expect(await screen.findByText('Could not change the agent: The model is not reachable')).toBeInTheDocument()
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
  })

  it('shows a quiet message for an unknown agent', async () => {
    renderBuilderPage('missing-agent')
    expect(await screen.findByText('Could not load this agent: No agent with id missing-agent')).toBeInTheDocument()
  })
})
