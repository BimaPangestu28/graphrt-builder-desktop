import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { pendingApproval } from '@/data/testRun'
import { routePaths } from '@/routes'
import { TestRunPage } from '@/pages/TestRunPage'
import { LocationProbe, flushBackendCalls, playSampleRunSteps, stepsAfterApproval, stepsUntilApproval } from '@/test/runTestUtils'

function renderTestRunPage(initialEntry: string = routePaths.testRun) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePaths.testRun} element={<TestRunPage />} />
        <Route path={routePaths.runResult} element={<p>Run result screen</p>} />
        <Route path={routePaths.builder} element={<p>Builder screen</p>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

async function renderPausedTestRun() {
  renderTestRunPage()
  await flushBackendCalls()
  await playSampleRunSteps(stepsUntilApproval)
}

describe('TestRunPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSampleRuns()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts a test run and puts its id in the URL', async () => {
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderTestRunPage()
    expect(screen.getByText('Starting the test…')).toBeInTheDocument()
    await flushBackendCalls()
    expect(startRunSpy).toHaveBeenCalledTimes(1)
    expect(startRunSpy).toHaveBeenCalledWith('maps-leads', 'test', expect.objectContaining({ keyword: 'cafe', city: 'Bandar Lampung' }))
    expect(screen.getByLabelText('Current location')).toHaveTextContent(`${routePaths.testRun}?runId=sample-run-1`)
  })

  it('fills in steps from live run events', async () => {
    renderTestRunPage()
    await flushBackendCalls()
    await playSampleRunSteps(6)
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(5)
    expect(within(steps[1]).getByText('18 places · 1.2s')).toBeInTheDocument()
    expect(steps[2]).toHaveTextContent('Running')
    expect(steps[4]).toHaveTextContent('Not started')
    expect(screen.queryByRole('heading', { name: 'Send this message?' })).not.toBeInTheDocument()
  })

  it('shows the paused test run with the drafted message to approve', async () => {
    await renderPausedTestRun()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for you')).toBeInTheDocument()
    expect(screen.getByText(/^1 of 18 places · started/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message, edit before sending if needed')).toHaveValue(pendingApproval.draftMessage)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('reopens a paused run from ?runId= without starting another', async () => {
    renderTestRunPage()
    await flushBackendCalls()
    await playSampleRunSteps(stepsUntilApproval)
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderTestRunPage(`${routePaths.testRun}?runId=sample-run-1`)
    await flushBackendCalls()
    expect(startRunSpy).not.toHaveBeenCalled()
    expect(screen.getAllByRole('heading', { name: 'Send this message?' })).toHaveLength(2)
  })

  it('disables approval while the message is empty', async () => {
    await renderPausedTestRun()
    fireEvent.change(screen.getByLabelText('Message, edit before sending if needed'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeDisabled()
  })

  it('resumes with the edited message and goes to the run result on success', async () => {
    const resumeRunSpy = vi.spyOn(sampleRunsBackend, 'resumeRun')
    await renderPausedTestRun()
    fireEvent.change(screen.getByLabelText('Message, edit before sending if needed'), { target: { value: 'Hello there' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }))
    await flushBackendCalls()
    expect(resumeRunSpy).toHaveBeenCalledWith('sample-run-1', { approve_message: { action: 'approve', values: { message: 'Hello there' } } })
    await playSampleRunSteps(stepsAfterApproval)
    await flushBackendCalls()
    expect(screen.getByText('Run result screen')).toBeInTheDocument()
    expect(screen.getByLabelText('Current location')).toHaveTextContent(`${routePaths.runResult}?runId=sample-run-1`)
  })

  it('skips the place through resumeRun, and can test again', async () => {
    const resumeRunSpy = vi.spyOn(sampleRunsBackend, 'resumeRun')
    await renderPausedTestRun()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this place' }))
    await flushBackendCalls()
    expect(resumeRunSpy).toHaveBeenCalledWith('sample-run-1', { approve_message: { action: 'skip', values: {} } })
    expect(screen.getByRole('heading', { name: 'Skipped this place' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send this message?' })).not.toBeInTheDocument()
    await playSampleRunSteps(stepsAfterApproval)
    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.queryByText('Run result screen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))
    await flushBackendCalls()
    expect(screen.getByLabelText('Current location')).toHaveTextContent('runId=sample-run-2')
    await playSampleRunSteps(stepsUntilApproval)
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
  })

  it('aborts the run when stopped and goes back to the steps', async () => {
    const abortRunSpy = vi.spyOn(sampleRunsBackend, 'abortRun')
    await renderPausedTestRun()
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await flushBackendCalls()
    expect(abortRunSpy).toHaveBeenCalledWith('sample-run-1')
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })

  it('shows an error when the run cannot start', async () => {
    vi.spyOn(sampleRunsBackend, 'startRun').mockRejectedValue(new BackendError('missing_credentials', 'Add an OpenAI key first'))
    renderTestRunPage()
    await flushBackendCalls()
    expect(screen.getByRole('alert')).toHaveTextContent('Add an OpenAI key first')
  })

  it('keeps the approval card and shows the error when resuming fails', async () => {
    vi.spyOn(sampleRunsBackend, 'resumeRun').mockRejectedValue(new BackendError('workflow', 'The run snapshot is gone'))
    await renderPausedTestRun()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }))
    await flushBackendCalls()
    expect(screen.getByRole('alert')).toHaveTextContent('The run snapshot is gone')
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
  })
})
