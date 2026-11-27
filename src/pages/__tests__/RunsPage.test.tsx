import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { startRun } from '@/api/runs'
import { sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { sampleLearningBackend } from '@/api/sampleBackend/learning'
import { resetSampleRuns, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '@/api/sampleBackend/runs'
import { RunsPage } from '../RunsPage'

function renderRunsPage(initialEntry = '/runs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RunsPage />
    </MemoryRouter>,
  )
}

/** Waits for the run list (header row + 6 seeded runs). */
async function findRunRows() {
  const table = await screen.findByRole('table')
  await within(table).findByText('Gmail sign-in expired')
  return within(table).getAllByRole('row')
}

describe('RunsPage', () => {
  beforeEach(() => {
    resetSampleRuns()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading row before the runs arrive', () => {
    renderRunsPage()
    expect(screen.getByText('Loading runs…')).toBeInTheDocument()
  })

  it('lists runs and opens the scheduled Maps leads run by default', async () => {
    renderRunsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument()
    expect(await findRunRows()).toHaveLength(7)
    expect(screen.getByRole('heading', { level: 2, name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(await screen.findByText('You approved 11 of 12')).toBeInTheDocument()
    expect(screen.getByText(/47m 12s · \$0\.05 AI cost/)).toBeInTheDocument()
  })

  it('opens the run named in ?runId= (links from Home)', async () => {
    renderRunsPage('/runs?runId=morning-digest-0700')
    await findRunRows()
    expect(await screen.findByRole('heading', { level: 2, name: 'Morning email digest' })).toBeInTheDocument()
  })

  it('shows the run steps with the same expandable step list as the Test run screen', async () => {
    renderRunsPage()
    await findRunRows()
    const stepList = await screen.findByRole('list', { name: 'Steps' })
    const searchButton = within(stepList).getByRole('button', { name: /^Search Google Maps/ })
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(searchButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(stepList).getAllByRole('listitem')).toHaveLength(5)
  })

  it('lists a finished test run in flow order from its version, without bookkeeping nodes', async () => {
    vi.useFakeTimers()
    try {
      const startedRun = await startRun('maps-leads', 'test', { keyword: 'cafe' })
      await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * sampleStepsUntilApproval)
      await sampleRunsBackend.resumeRun(startedRun.id, { approve_message: { action: 'approve', values: { message: 'Hi' } } })
      await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * 5)
    } finally {
      vi.useRealTimers()
    }
    renderRunsPage()
    await findRunRows()
    fireEvent.click(screen.getAllByRole('button', { name: /^Show run: Maps leads to WhatsApp/ })[0])
    const stepList = await screen.findByRole('list', { name: 'Steps' })
    await vi.waitFor(() => expect(within(stepList).getAllByRole('listitem')).toHaveLength(5))
    expect(within(stepList).getAllByRole('listitem').map((step) => step.textContent?.split(',')[0])).toEqual([
      'Search Google Maps',
      'For each place',
      'Write a short message',
      'Ask me before sending',
      'Send WhatsApp',
    ])
    fireEvent.click(within(stepList).getByRole('button', { name: /^Write a short message/ }))
    expect(within(stepList).getByLabelText('Final text')).toHaveTextContent(/^Hi \[PLACE NAME\] team/)
  })

  it('lets a finished run that ran for real be rated, and its comment waits as a note', async () => {
    const record = vi.spyOn(sampleLearningBackend, 'recordRunFeedback')
    renderRunsPage()
    await findRunRows()
    // The run opened by default was started by a schedule, not by a test.
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByRole('heading', { level: 2, name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    const feedback = within(panel).getByRole('group', { name: 'Was this what you wanted?' })
    fireEvent.click(within(feedback).getByRole('button', { name: 'No, something was off' }))
    fireEvent.change(within(feedback).getByLabelText('What should it do differently next time?'), { target: { value: 'Skip places without a phone number' } })
    await act(async () => {
      fireEvent.click(within(feedback).getByRole('button', { name: 'Send' }))
    })
    expect(record).toHaveBeenCalledWith(expect.any(String), { helpful: false, comment: 'Skip places without a phone number' })
    expect(await within(panel).findByText('Your note is waiting for your approval.')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'See what it learned' })).toBeInTheDocument()
  })

  it('does not ask for a rating while a run is still running or waiting', async () => {
    const run = await startRun('maps-leads', 'manual', { keyword: 'cafe' })
    renderRunsPage(`/runs?runId=${run.id}`)
    await findRunRows()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Was this what you wanted?' })).not.toBeInTheDocument()
  })

  it('filters by status through the backend filter', async () => {
    const listRunsSpy = vi.spyOn(sampleRunsBackend, 'listRuns')
    renderRunsPage()
    await findRunRows()
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }))
    expect(listRunsSpy).toHaveBeenLastCalledWith({ agentId: undefined, status: 'failed', limit: undefined })
    const table = screen.getByRole('table')
    expect(await within(table).findByText('Gmail sign-in expired')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
  })

  it('filters by agent', async () => {
    renderRunsPage()
    await findRunRows()
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: 'morning-digest' } })
    expect(await screen.findByRole('button', { name: 'Running 0' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))
  })

  it('switches and closes the detail panel', async () => {
    renderRunsPage()
    await findRunRows()
    fireEvent.click(screen.getByRole('button', { name: /^Show run: Catering assistant/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Inbox' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show raw log' }))
    expect(await screen.findByLabelText('Raw log')).toHaveTextContent('approval requested')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('adds a run that starts while the screen is open', async () => {
    renderRunsPage()
    await findRunRows()
    await act(async () => {
      await startRun('maps-leads', 'test', {})
    })
    const table = screen.getByRole('table')
    await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(8))
    expect(within(table).getAllByText('Running')).toHaveLength(3)
  })

  it('shows plain-language errors, stopped runs and paused questions in the table', async () => {
    const rawError = 'connection: iteration item 0 failed: error sending request: dns error: failed to lookup address information: nodename nor servname provided, or not known'
    const run = { agentId: 'maps-leads', agentVersion: 1, trigger: 'manual', startedAt: new Date().toISOString(), finishedAt: null, outputs: null, errorMessage: null, pauseReasons: null } as const
    vi.spyOn(sampleRunsBackend, 'listRuns').mockResolvedValue([
      { ...run, id: 'failed-run', status: 'failed', errorMessage: rawError },
      { ...run, id: 'stopped-run', status: 'aborted' },
      { ...run, id: 'paused-run', status: 'paused', pauseReasons: [{ node_id: 'approve', kind: 'human_input', data: { prompt: '## Send to\n**Kopi Kenangan**?' } }] },
    ])
    renderRunsPage()
    const table = await screen.findByRole('table')
    const friendlyError = await within(table).findByText("Could not reach the server: that address doesn't exist")
    expect(friendlyError.closest('td')).toHaveAttribute('title', rawError)
    expect(within(table).queryByText(/dns error/)).not.toBeInTheDocument()
    const [, , stoppedRow, pausedRow] = within(table).getAllByRole('row')
    expect(within(stoppedRow).getAllByText('Stopped')).toHaveLength(2)
    expect(within(stoppedRow).queryByText('Failed')).not.toBeInTheDocument()
    expect(within(pausedRow).getByText('Send to Kopi Kenangan?')).toBeInTheDocument()
    // When: relative for recent runs, the exact day and time on hover; a waiting run has no duration yet.
    const pausedWhen = within(pausedRow).getByText('just now')
    expect(pausedWhen.closest('td')).toHaveAttribute('title', expect.stringMatching(/^Today \d\d:\d\d/))
    expect(within(pausedRow).getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Failed 1' })).toBeInTheDocument()
  })

  it('shows an error when runs cannot be loaded', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockRejectedValue(new BackendError('database', 'Database is locked'))
    renderRunsPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
  })

  it('sums up today and colours the status counts', async () => {
    renderRunsPage()
    await findRunRows()
    const summary = screen.getByRole('region', { name: 'Today at a glance' })
    expect(within(summary).getByText('Runs today').nextSibling).toHaveTextContent(/^\d+$/)
    expect(within(summary).getByText('Needs you').nextSibling).toHaveTextContent('1')
    const statusGroup = screen.getByRole('group', { name: 'Status' })
    expect(within(statusGroup).getByRole('button', { name: 'Needs you 1' })).toBeInTheDocument()
  })

  it('offers to clear the filters when runs exist but none match', async () => {
    renderRunsPage()
    await findRunRows()
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: 'morning-digest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Running 0' }))
    expect(await screen.findByText('No runs match these filters')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await findRunRows()).toHaveLength(7)
    expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('all')
  })

  it('offers a new agent when there are no agents and no runs', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockResolvedValue([])
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockResolvedValue([])
    renderRunsPage()
    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
    const page = screen.getByRole('region', { name: 'All runs' })
    expect(within(page).getByRole('link', { name: 'New agent' })).toHaveAttribute('href', '/new')
    expect(screen.queryByRole('toolbar', { name: 'Filter runs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Today at a glance' })).not.toBeInTheDocument()
  })

  it('says no runs yet when agents exist but none has run', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockResolvedValue([])
    renderRunsPage()
    expect(await screen.findByText('No runs yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to your agents' })).toHaveAttribute('href', '/home')
    expect(within(screen.getByRole('region', { name: 'All runs' })).queryByRole('link', { name: 'New agent' })).not.toBeInTheDocument()
  })
})
