import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resumeRun, startRun } from '@/api/runs'
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

describe('RunResultPage', () => {
  beforeEach(() => {
    resetSampleRuns()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the succeeded test with stats and places', () => {
    renderRunResultPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '[PLACE NAME 1]' })).toBeInTheDocument()
    expect(screen.getByText('15 more places')).toBeInTheDocument()
  })

  it('offers the places as a CSV download', () => {
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

  it('loads the run from ?runId= and fills stats from its outputs', async () => {
    const runId = await finishSampleRun('approve')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    expect(screen.getByText('Loading the run…')).toBeInTheDocument()
    expect(await screen.findByText(/^Today \d\d:\d\d · on this Mac$/)).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByText(/^The message reached \[PLACE NAME 1\] at \d\d:\d\d\. Everything worked$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run now for the other 17 places' })).toBeInTheDocument()
  })

  it('says nothing was sent for a skipped test', async () => {
    const runId = await finishSampleRun('skip')
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId }))
    expect(await screen.findByText('The test finished. Nothing was sent')).toBeInTheDocument()
  })

  it('shows an error for an unknown run', async () => {
    renderRunResultPage(agentPath('runResult', sampleAgentId, { runId: 'missing-run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No run missing-run')
  })
})
