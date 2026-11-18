import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { startRun } from '@/api/runs'
import { resetSampleRuns, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '@/api/sampleBackend/runs'
import { RunsPage } from '../RunsPage'

function renderRunsPage() {
  return render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>,
  )
}

/** Waits for the run list (header row + 6 seeded runs). */
async function findRunRows() {
  const table = screen.getByRole('table')
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

  it('shows an error when runs cannot be loaded', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockRejectedValue(new BackendError('database', 'Database is locked'))
    renderRunsPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
  })
})
