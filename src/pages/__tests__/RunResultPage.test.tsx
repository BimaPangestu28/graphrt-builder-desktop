import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resumeRun, startRun } from '@/api/runs'
import { sampleRunReviewBackend } from '@/api/sampleBackend/runReview'
import type { RunSummary } from '@/api/runSummaryTypes'
import { sampleRunSummaryBackend } from '@/api/sampleBackend/runSummary'
import { resetSampleRuns, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '@/api/sampleBackend/runs'
import { agentPath, routePaths, sampleAgentId } from '@/routes'
import { RunResultPage } from '@/pages/RunResultPage'
import { LocationProbe } from '@/test/runTestUtils'

function renderRunResultPage(initialEntry: string = routePaths.runResult) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePaths.runResult} element={<RunResultPage />} />
        <Route path={routePaths.scheduleAgent} element={<p>Schedule screen</p>} />
        <Route path={routePaths.batchApproval} element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Plays the sample test run to the end and returns its id. */
async function finishSampleRun(action: 'approve' | 'skip'): Promise<string> {
  vi.useFakeTimers()
  const run = await startRun(sampleAgentId, 'test', { keyword: 'cafe', city: '[CITY]' })
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * sampleStepsUntilApproval)
  await resumeRun(run.id, { approve_message: { action, values: { message: 'Hi' } } })
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * 5)
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
    visuals: [],
    rejectedVisuals: [],
    errorMessage: null,
    ...changes,
  }
}

describe('RunResultPage', () => {
  beforeEach(() => {
    resetSampleRuns()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the latest finished test run of the agent without ?runId=', async () => {
    renderRunResultPage()
    expect(await screen.findByText(/^Yesterday \d\d:\d\d · on this computer$/)).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('Test with cafe · Bandar Lampung · catering menu')).toBeInTheDocument()
    expect(screen.getByText('Places found')).toBeInTheDocument()
  })

  it('says so when the agent has no finished test', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockResolvedValue([])
    renderRunResultPage()
    expect(await screen.findByText('No finished test yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Test it' })).toHaveAttribute('href', agentPath('testRun', sampleAgentId))
    expect(screen.queryByText('$0.004')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('offers the items as a CSV download', async () => {
    const runId = await finishSampleRun('approve')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    const exportLink = await screen.findByRole('link', { name: 'Export CSV' })
    expect(exportLink).toHaveAttribute('download', `run-${runId.slice(0, 8)}.csv`)
    expect(decodeURIComponent(exportLink.getAttribute('href') ?? '')).toContain('"[PLACE NAME 1]","[PHONE]","Sent"')
  })

  it('opens the schedule dialog from "What next?"', async () => {
    renderRunResultPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Put it on a schedule' }))
    expect(screen.getByText('Schedule screen')).toBeInTheDocument()
  })

  it('runs it now with the same inputs and opens the review', async () => {
    const runId = await finishSampleRun('approve')
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    fireEvent.click(await screen.findByRole('button', { name: 'Run it now with the same inputs' }))
    expect(await screen.findByLabelText('Current location')).toHaveTextContent(/^\/runs\/review\?runId=sample-run-2$/)
    expect(startRunSpy).toHaveBeenCalledWith(sampleAgentId, 'manual', { keyword: 'cafe', city: '[CITY]' })
  })

  it('does not offer "run it now" when the run inputs are unknown', async () => {
    vi.spyOn(sampleRunReviewBackend, 'getRunInputs').mockResolvedValue(null)
    renderRunResultPage()
    expect(await screen.findByText('Test this agent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run it now with the same inputs' })).not.toBeInTheDocument()
  })

  it('loads the run summary from ?runId= and shows its headline, counters and items', async () => {
    const runId = await finishSampleRun('approve')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    expect(screen.getByText('Loading the run…')).toBeInTheDocument()
    expect(await screen.findByText(/^Today \d\d:\d\d · on this computer$/)).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('Sent the test message to [PLACE NAME 1].')).toBeInTheDocument()
    expect(screen.getByText('Places found')).toBeInTheDocument()
    expect(screen.getByText('Messages sent')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByText(/You approved 1, skipped 0/)).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Phone', 'Status'])
    expect(within(table).getByRole('cell', { name: 'Sent' })).toBeInTheDocument()
    expect(screen.getByText('Test with cafe · [CITY]')).toBeInTheDocument()
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
  })

  it('says when a run reported neither items nor counts', async () => {
    vi.spyOn(sampleRunSummaryBackend, 'getRunSummary').mockResolvedValue(buildSummary({ durationMs: null }))
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'run-1' }))
    expect(await screen.findByText('This run did not list the things it handled or report any counts.')).toBeInTheDocument()
    expect(screen.queryByRole('term')).not.toBeInTheDocument()
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
