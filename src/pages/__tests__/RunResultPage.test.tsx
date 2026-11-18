import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resumeRun, startRun } from '@/api/runs'
import type { RunSummary } from '@/api/runSummaryTypes'
import { sampleRunSummaryBackend } from '@/api/sampleBackend/runSummary'
import { resetSampleRuns, sampleRunStepDelayMs } from '@/api/sampleBackend/runs'
import { agentPath, routePaths, sampleAgentId } from '@/routes'
import { RunResultPage } from '@/pages/RunResultPage'

function renderRunResultPage(initialEntry: string = routePaths.runResult) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePaths.runResult} element={<RunResultPage />} />
        <Route path={routePaths.scheduleAgent} element={<p>Schedule screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Plays the sample test run to the end and returns its id. */
async function finishSampleRun(action: 'approve' | 'skip'): Promise<string> {
  vi.useFakeTimers()
  const run = await startRun(sampleAgentId, 'test', {})
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * 10)
  await resumeRun(run.id, { approve_message: { action, values: { message: 'Hi' } } })
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * 4)
  vi.useRealTimers()
  return run.id
}

function buildSummary(changes: Partial<RunSummary>): RunSummary {
  return {
    runId: 'run-1',
    agentId: sampleAgentId,
    status: 'succeeded',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 65_000,
    steps: { succeeded: 3, failed: 0, skipped: 0 },
    approvals: { approved: 0, skipped: 0, waiting: 0 },
    usage: null,
    headline: null,
    items: [],
    counters: [],
    errorMessage: null,
    ...changes,
  }
}

describe('RunResultPage', () => {
  beforeEach(() => {
    resetSampleRuns()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the mockup result without a run', () => {
    renderRunResultPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '[PLACE NAME 1]' })).toBeInTheDocument()
    expect(screen.getByText('15 more places')).toBeInTheDocument()
  })

  it('offers the table as a CSV download', () => {
    renderRunResultPage()
    const exportLink = screen.getByRole('link', { name: 'Export CSV' })
    expect(exportLink).toHaveAttribute('download', 'maps-leads-test-run.csv')
    expect(decodeURIComponent(exportLink.getAttribute('href') ?? '')).toContain('"[PLACE NAME 1]","[PHONE]","Sent"')
  })

  it('opens the schedule dialog from "What next?"', () => {
    renderRunResultPage()
    fireEvent.click(screen.getByRole('button', { name: 'Run it every weekday on new places' }))
    expect(screen.getByText('Schedule screen')).toBeInTheDocument()
  })

  it('loads the run summary from ?runId= and shows its headline, counters and items', async () => {
    const runId = await finishSampleRun('approve')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    expect(screen.getByText('Loading the run…')).toBeInTheDocument()
    expect(await screen.findByText(/^Today \d\d:\d\d · on this Mac$/)).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('Sent the test message to [PLACE NAME 1].')).toBeInTheDocument()
    expect(screen.getByText('Places found')).toBeInTheDocument()
    expect(screen.getByText('Messages sent')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByText(/You approved 1, skipped 0/)).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Phone', 'Status'])
    expect(within(table).getByRole('cell', { name: 'Sent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run now for the other 17 places' })).toBeInTheDocument()
  })

  it('shows the headline of a skipped test', async () => {
    const runId = await finishSampleRun('skip')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    expect(await screen.findByText('Skipped the test message, so nothing was sent.')).toBeInTheDocument()
    expect(screen.getByText(/You approved 0, skipped 1/)).toBeInTheDocument()
  })

  it('falls back gracefully for a run without items or a headline', async () => {
    vi.spyOn(sampleRunSummaryBackend, 'getRunSummary').mockResolvedValue(buildSummary({ counters: [{ name: 'rows_added', value: 4 }] }))
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'run-1' }))
    expect(await screen.findByText('This run did not list the things it handled.')).toBeInTheDocument()
    expect(screen.getByText('The run finished')).toBeInTheDocument()
    expect(screen.getByText('Rows added')).toBeInTheDocument()
    expect(screen.getByText('1m 05s')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export CSV' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run it now for everything' })).toBeInTheDocument()
  })

  it('says why a failed run did not finish', async () => {
    vi.spyOn(sampleRunSummaryBackend, 'getRunSummary').mockResolvedValue(
      buildSummary({ status: 'failed', errorMessage: 'Maps key is missing', headline: null }),
    )
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'run-1' }))
    expect(await screen.findByText('The run did not finish: Maps key is missing')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('shows an error for an unknown run', async () => {
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'missing-run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No run missing-run')
  })

  it('shows a backend error from the summary', async () => {
    vi.spyOn(sampleRunSummaryBackend, 'getRunSummary').mockRejectedValue(new BackendError('database', 'database is locked'))
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'run-1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})
