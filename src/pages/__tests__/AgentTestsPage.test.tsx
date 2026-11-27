import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { BackendError } from '@/api/client'
import { resetSampleQuality, sampleQualityBackend } from '@/api/sampleBackend/quality'
import { readCurrentSteps, saveNewVersion } from '@/api/sampleBackend/sampleAgentStore'
import { setLocale } from '@/i18n'
import { agentPath, agentRoutePatterns } from '@/routes'
import { AgentReleasesPage } from '../AgentReleasesPage'
import { AgentTestsPage } from '../AgentTestsPage'

const agentId = 'catering-assistant'

function renderPage(routeKey: 'agentTests' | 'agentReleases') {
  return render(
    <MemoryRouter initialEntries={[agentPath(routeKey, agentId)]}>
      <Routes>
        <Route path={agentRoutePatterns.agentTests} element={<AgentTestsPage />} />
        <Route path={agentRoutePatterns.agentReleases} element={<AgentReleasesPage />} />
        <Route path={agentRoutePatterns.putOnline} element={<h1>Put it online</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Test & release', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleQuality()
  })
  afterEach(() => setLocale('en'))

  it('suggests questions, checks the agent and shows per question whether the answer was good', async () => {
    const user = userEvent.setup()
    renderPage('agentTests')
    expect(await screen.findByRole('heading', { level: 1, name: 'Test Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1. Test' })).toHaveAttribute('aria-current', 'page')

    await user.click(await screen.findByRole('button', { name: 'Suggest questions' }))
    const deliver = await screen.findByRole('checkbox', { name: /Do you deliver to the office/ })
    await user.click(screen.getByRole('checkbox', { name: /Can Catering assistant take my payment/ }))
    expect(deliver).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Add 3 questions' }))
    const list = await screen.findByRole('list', { name: '3 test questions' })
    expect(within(list).getAllByText('Suggested')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Check the agent' }))
    expect(await screen.findByText('2 of 3 answers are good')).toBeInTheDocument()
    expect(screen.getByText('A release needs at least 3 good answers')).toBeInTheDocument()
    const notGood = within(list).getByText('Not good').closest('div.rounded-\\[14px\\]')
    expect(notGood).not.toBeNull()
    expect(within(notGood as HTMLElement).getByText(/does not say whether the shop delivers/)).toBeInTheDocument()
  })

  it('writes a question with words in More options', async () => {
    const user = userEvent.setup()
    renderPage('agentTests')
    await user.click(await screen.findByRole('button', { name: 'Write a question' }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'When do you open?')
    await user.type(screen.getByRole('textbox', { name: /A good answer/ }), 'At 9 in the morning')
    await user.click(screen.getByText('More options'))
    await user.type(screen.getByRole('textbox', { name: 'Words the answer must have' }), '9, morning')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(await screen.findByRole('list', { name: '1 test question' })).toBeInTheDocument()
    expect(screen.getByText('At 9 in the morning')).toBeInTheDocument()
  })

  it('blocks a release in plain words and releases anyway with a reason', async () => {
    const user = userEvent.setup()
    renderPage('agentReleases')
    expect(await screen.findByText('Nothing is released yet')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('This agent has no test questions yet.')
    expect(screen.getByRole('link', { name: 'Go to Test' })).toHaveAttribute('href', agentPath('agentTests', agentId))

    await user.click(screen.getByText('Release anyway', { selector: 'summary' }))
    await user.type(screen.getByRole('textbox', { name: 'Why release it anyway' }), 'Menu demo today')
    await user.click(screen.getByRole('button', { name: 'Release anyway' }))
    expect(await screen.findByText('Release 1 is now in use.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Put it online' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Released without a passing check: Menu demo today/).length).toBeGreaterThan(0))
  })

  it('keeps the release in use and says so in plain words when the online copy cannot go back', async () => {
    await sampleQualityBackend.createAgentRelease(agentId, 'First', 'Demo')
    saveNewVersion(agentId, readCurrentSteps(agentId), 'Free delivery')
    await sampleQualityBackend.createAgentRelease(agentId, 'Second', 'Demo')
    const switchRelease = vi.spyOn(sampleQualityBackend, 'switchAgentRelease').mockRejectedValue(
      new BackendError(
        'online_switch_failed',
        'The online copy could not go back to release 1, so nothing changed: release 2 stays in use here and online. Try again in a few minutes.',
        { releaseNumber: 1, inUseNumber: 2 },
      ),
    )
    const user = userEvent.setup()
    renderPage('agentReleases')
    await user.click(await screen.findByRole('button', { name: 'Go back to this release' }))
    await user.click(screen.getByRole('button', { name: 'Yes, use it' }))
    expect(
      await screen.findByText('The online copy could not go back to release 1, so nothing changed: release 2 stays in use here and online. Try again in a few minutes.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/That did not work/)).not.toBeInTheDocument()
    expect(switchRelease).toHaveBeenCalledWith(agentId, 1)
    const releases = screen.getByRole('list', { name: 'All releases' })
    expect(within(releases).getAllByText('In use')).toHaveLength(1)
    expect(within(releases).getByText('Second').closest('li')).toHaveTextContent('In use')
    switchRelease.mockRestore()
  })

  it('speaks Indonesian', async () => {
    setLocale('id')
    renderPage('agentReleases')
    expect(await screen.findByText('Belum ada yang dirilis')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '2. Rilis' })).toBeInTheDocument()
  })
})
