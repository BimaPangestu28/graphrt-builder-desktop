import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import type { Problem } from '@/api/problemTypes'
import { resetSampleProblems, sampleFailedRunId, sampleProblemsBackend } from '@/api/sampleBackend/problems'
import { ErrorStatesPage } from '@/pages/ErrorStatesPage'
import { connectionsPluginsPath, routePaths } from '@/routes'

function renderErrorStatesPage(initialPath: string = routePaths.errorStates) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ErrorStatesPage />
    </MemoryRouter>,
  )
}

describe('ErrorStatesPage', () => {
  beforeEach(() => resetSampleProblems())

  afterEach(() => vi.restoreAllMocks())

  it('explains the newest failed run and lists the other problems', async () => {
    renderErrorStatesPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Could not read your email' })).toBeInTheDocument()
    expect(screen.getByText('Failed after 3 tries')).toBeInTheDocument()
    expect(screen.getByText(/a retry starts a new run/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect Gmail' })).toHaveAttribute('href', routePaths.connections)
    const otherProblems = screen.getByRole('complementary', { name: 'Other problems' })
    expect(within(otherProblems).getByRole('link', { name: 'Scan QR again' })).toHaveAttribute('href', connectionsPluginsPath)
    expect(within(otherProblems).queryByRole('article', { name: 'Could not read your email' })).not.toBeInTheDocument()
  })

  it('retries the failed run from the start', async () => {
    const retrySpy = vi.spyOn(sampleProblemsBackend, 'retryRun')
    renderErrorStatesPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry from the start' }))
    expect(await screen.findByRole('status')).toHaveTextContent('A new run started from the beginning')
    expect(retrySpy).toHaveBeenCalledWith(sampleFailedRunId)
    expect(screen.getByRole('link', { name: 'Follow it in Runs' })).toHaveAttribute('href', routePaths.runs)
  })

  it('shows why a retry failed', async () => {
    vi.spyOn(sampleProblemsBackend, 'retryRun').mockRejectedValue(new BackendError('missing_credentials', 'no API key is set for openai'))
    renderErrorStatesPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry from the start' }))
    expect(await screen.findByRole('status')).toHaveTextContent('no API key is set for openai')
  })

  it('opens the run named in the address', async () => {
    const reportSpy = vi.spyOn(sampleProblemsBackend, 'getFailedRunReport')
    renderErrorStatesPage(`${routePaths.errorStates}?runId=${sampleFailedRunId}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Could not read your email' })).toBeInTheDocument()
    expect(reportSpy).toHaveBeenCalledWith(sampleFailedRunId)
  })

  it('maps problem actions to the screens that fix them', async () => {
    renderErrorStatesPage()
    const scheduleCard = await screen.findByRole('article', { name: 'The Mac was asleep at 09:00' })
    expect(within(scheduleCard).getByRole('link', { name: 'Change schedule rules' })).toHaveAttribute('href', '/agents/maps-leads/schedule')
    const stepCard = screen.getByRole('article', { name: 'A step kept timing out' })
    expect(within(stepCard).getByRole('link', { name: 'Ask chat to fix this step' })).toHaveAttribute('href', '/agents/maps-leads/steps')
  })

  it('installs the browser from its problem card', async () => {
    const browserProblem: Problem = {
      id: 'browser_missing',
      kind: 'browser_missing',
      title: 'The browser for web steps is not installed',
      detail: 'Maps leads open web pages and need it',
      needsAttention: true,
      agentId: null,
      agentName: null,
      runId: null,
      occurredAt: null,
      actions: [{ kind: 'install_browser', label: 'Install the browser', agentId: null, runId: null }],
    }
    vi.spyOn(sampleProblemsBackend, 'listProblems').mockResolvedValue([browserProblem])
    renderErrorStatesPage()
    const card = await screen.findByRole('article', { name: browserProblem.title })
    fireEvent.click(within(card).getByRole('button', { name: 'Install the browser' }))
    expect(await within(card).findByRole('status')).toHaveTextContent('The browser is installed')
  })

  it('says so when nothing went wrong', async () => {
    vi.spyOn(sampleProblemsBackend, 'listProblems').mockResolvedValue([])
    renderErrorStatesPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'No failed runs' })).toBeInTheDocument()
    expect(screen.getByText('Nothing else needs you right now')).toBeInTheDocument()
  })

  it('shows an error when problems cannot be checked', async () => {
    vi.spyOn(sampleProblemsBackend, 'listProblems').mockRejectedValue(new BackendError('database', 'Database is locked'))
    renderErrorStatesPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
  })
})
