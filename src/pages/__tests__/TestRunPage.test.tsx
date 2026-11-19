import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { sampleBuilderBackend } from '@/api/sampleBackend/builder'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { sampleDraftMessage } from '@/api/sampleBackend/sampleTestRun'
import type { FlowSummary, Run } from '@/api/types'
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

async function startTestFromForm() {
  renderTestRunPage()
  await flushBackendCalls()
  fireEvent.click(screen.getByRole('button', { name: 'Start the test' }))
  await flushBackendCalls()
}

async function renderPausedTestRun() {
  await startTestFromForm()
  await playSampleRunSteps(stepsUntilApproval)
}

function buildFlowSummary(changes: Partial<FlowSummary>): FlowSummary {
  return { steps: [], inputs: [], modelProviders: [], env: [], ...changes }
}

function buildPausedRun(pauseData: unknown): Run {
  return {
    id: 'custom-run',
    agentId: 'maps-leads',
    agentVersion: 1,
    trigger: 'test',
    status: 'paused',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    pauseReasons: [{ frame: '', node_id: 'check_order', kind: 'human_input', data: pauseData }],
  }
}

describe('TestRunPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSampleRuns()
    resetSamplePlugins()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows a form from the flow inputs, prefilled from the last run, before starting', async () => {
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderTestRunPage()
    await flushBackendCalls()
    expect(startRunSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Filled in from the last run')).toBeInTheDocument()
    expect(screen.getByLabelText('Keyword')).toHaveValue('cafe')
    expect(screen.getByLabelText('City')).toHaveValue('Bandar Lampung')
    expect(screen.getByLabelText('Offer')).toHaveValue('catering menu')
    expect(screen.getAllByRole('listitem').map((step) => step.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Not started')]))

    fireEvent.change(screen.getByLabelText('City'), { target: { value: '[CITY]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start the test' }))
    await flushBackendCalls()
    expect(startRunSpy).toHaveBeenCalledWith('maps-leads', 'test', { keyword: 'cafe', city: '[CITY]', offer: 'catering menu' })
    expect(screen.getByLabelText('Current location')).toHaveTextContent(`${routePaths.testRun}?runId=sample-run-1`)
    expect(screen.getByText('Test with cafe · [CITY] · catering menu')).toBeInTheDocument()
  })

  it('keeps Start disabled while a required input is empty', async () => {
    renderTestRunPage()
    await flushBackendCalls()
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: ' ' } })
    expect(screen.getByRole('button', { name: 'Start the test' })).toBeDisabled()
    expect(screen.getByText('Fill in Keyword')).toBeInTheDocument()
  })

  it('builds controls from graphrt input types and sends typed values', async () => {
    vi.spyOn(sampleBuilderBackend, 'getFlowSummary').mockResolvedValue(
      buildFlowSummary({
        inputs: [
          { name: 'tier', label: 'Tier', required: true, inputType: 'select', options: ['free', 'pro'], defaultValue: 'pro' },
          { name: 'count', label: 'How many', required: false, inputType: 'number', defaultValue: 10 },
          { name: 'notify', label: 'Tell me when done', required: false, inputType: 'checkbox' },
          { name: 'brief', label: 'Brief', required: true, inputType: 'paragraph' },
          { name: 'extra', label: 'Extra data', required: false, inputType: 'json' },
        ],
      }),
    )
    vi.spyOn(sampleRunsBackend, 'getLastRunInputs').mockResolvedValue(null)
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderTestRunPage()
    await flushBackendCalls()
    expect(screen.getByText('These go to the first step of the agent')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tier' })).toHaveValue('pro')
    expect(screen.getByRole('spinbutton', { name: 'How many (optional)' })).toHaveValue(10)
    expect(screen.getByRole('button', { name: 'Start the test' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Brief' }), { target: { value: 'Line one\nLine two' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tell me when done (optional)' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Extra data (optional)' }), { target: { value: '{ "a": 1' } })
    expect(screen.getByText('Extra data is not valid JSON')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Extra data (optional)' }), { target: { value: '{ "a": 1 }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start the test' }))
    await flushBackendCalls()
    expect(startRunSpy).toHaveBeenCalledWith('maps-leads', 'test', { tier: 'pro', count: 10, notify: true, brief: 'Line one\nLine two', extra: { a: 1 } })
  })

  it('fills in steps from the flow summary and live run events, without bookkeeping nodes', async () => {
    await startTestFromForm()
    await playSampleRunSteps(9)
    const steps = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent?.split(',')[0])).toEqual([
      'Search Google Maps',
      'For each place',
      'Write a short message',
      'Ask me before sending',
      'Send WhatsApp',
    ])
    expect(within(steps[0]).getByText('1.2s')).toBeInTheDocument()
    expect(within(steps[1]).getByText(/^1 of 1 · \[PLACE NAME 1\]/)).toBeInTheDocument()
    expect(within(steps[1]).getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1')
    expect(steps[2]).toHaveTextContent('Running')
    expect(steps[4]).toHaveTextContent('Not started')
    expect(screen.queryByText(/Ask for keyword, city and offer/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send this message?' })).not.toBeInTheDocument()
  })

  it('opens the writing model step with its streamed text and closes it when it finishes', async () => {
    await startTestFromForm()
    await playSampleRunSteps(9)
    const writeButton = screen.getByRole('button', { name: /^Write a short message/ })
    expect(writeButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Streaming text')).toHaveTextContent(/^Hi \[PLACE NAME\] team, we run a catering/)
    expect(screen.getByLabelText('Streaming text')).not.toHaveTextContent('menu?')

    await playSampleRunSteps(3)
    expect(writeButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(writeButton)
    expect(writeButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Final text')).toHaveTextContent(sampleDraftMessage)
    expect(screen.getByText('212 tokens (180 in · 32 out)')).toBeInTheDocument()

    const searchButton = screen.getByRole('button', { name: /^Search Google Maps/ })
    fireEvent.click(searchButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('1 item • [PLACE NAME 1]')).toBeInTheDocument()
  })

  it('narrates the run in the chat column and links to the approval', async () => {
    await renderPausedTestRun()
    const feed = screen.getByRole('log', { name: 'Run updates' })
    expect(within(feed).getByText('Search Google Maps: found 18 places')).toBeInTheDocument()
    expect(within(feed).getByText('Place 1 of 1: [PLACE NAME 1] — waiting for you')).toBeInTheDocument()
    fireEvent.click(within(feed).getByRole('button', { name: 'Waiting for your approval' }))
    expect(document.activeElement).toHaveAttribute('id', 'approval-card')
  })

  it('ticks the elapsed time in the header while running', async () => {
    await startTestFromForm()
    await playSampleRunSteps(1)
    expect(screen.getByText(/^Running · 0:00 · 0 of 2 steps done$/)).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText(/^Running · 0:01/)).toBeInTheDocument()
  })

  it('after a failure explains the error, offers Run again and Edit steps, and marks the sidebar', async () => {
    const rawError = 'connection: error sending request: client error (Connect): dns error: failed to lookup address information: nodename nor servname provided, or not known'
    const failedRun: Run = { ...buildPausedRun(null), status: 'failed', pauseReasons: null, finishedAt: new Date().toISOString(), errorMessage: rawError }
    vi.spyOn(sampleRunsBackend, 'getRun').mockResolvedValue(failedRun)
    vi.spyOn(sampleRunsBackend, 'getRunInputs').mockResolvedValue({ keyword: 'cafe', city: 'Bandar Lampung', offer: 'catering menu' })
    vi.spyOn(sampleRunsBackend, 'listRunEvents').mockResolvedValue(
      [
        { type: 'run_started' },
        { type: 'node_started', node_id: 'for_each_place', frame: '', kind: 'iteration' },
        { type: 'node_progress', node_id: 'for_each_place', frame: '', name: 'iteration_next', data: { index: 0, total: 1 } },
        { type: 'node_started', node_id: 'send_whatsapp', frame: 'for_each_place[0]', kind: 'http-request' },
        { type: 'node_failed', node_id: 'send_whatsapp', frame: 'for_each_place[0]', error: rawError, handled: false, elapsed_ms: 30 },
        { type: 'node_failed', node_id: 'for_each_place', frame: '', error: `connection: iteration item 0 failed: ${rawError}`, handled: false },
        { type: 'run_failed', error: `connection: iteration item 0 failed: ${rawError}` },
      ].map((event, index) => ({ runId: 'custom-run', seq: index + 1, event, createdAt: new Date().toISOString() })),
    )
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderTestRunPage(`${routePaths.testRun}?runId=custom-run`)
    await flushBackendCalls()

    expect(screen.queryByRole('button', { name: 'Stop run' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit steps' })).toBeInTheDocument()
    expect(screen.getByText('Test failed')).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Run updates' })).toHaveTextContent('Failed at Send WhatsApp (Place 1 of 1): Could not reach the server: that address doesn\'t exist')

    const sendButton = screen.getByRole('button', { name: /^Send WhatsApp/ })
    expect(sendButton).toHaveAttribute('aria-expanded', 'true')
    const sendRow = sendButton.closest('li') as HTMLElement
    expect(within(sendRow).getByText("Could not reach the server: that address doesn't exist")).toBeInTheDocument()
    expect(within(sendRow).getByText('Technical details')).toBeInTheDocument()
    expect(within(sendRow).getByRole('link', { name: 'Ask the builder to fix this step' })).toHaveAttribute('href', '/agents/maps-leads/steps')

    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    await flushBackendCalls()
    expect(startRunSpy).toHaveBeenCalledWith('maps-leads', 'test', { keyword: 'cafe', city: 'Bandar Lampung', offer: 'catering menu' })
  })

  it('shows the paused step with the prompt, fields and actions from the pause', async () => {
    await renderPausedTestRun()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
    expect(screen.getByText('To [PLACE NAME] · [PHONE NUMBER] · 4.6 rating, 312 reviews')).toBeInTheDocument()
    expect(screen.getByText('Waiting for you')).toBeInTheDocument()
    expect(screen.getByLabelText('Message, edit before sending if needed')).toHaveValue(sampleDraftMessage)
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Skip this place' })).toBeEnabled()
  })

  it('renders any human-input pause: custom actions as buttons and fields as inputs', async () => {
    vi.spyOn(sampleRunsBackend, 'getRun').mockResolvedValue(
      buildPausedRun({
        prompt: 'Confirm order [ORDER ID]?',
        fields: [
          { name: 'note', label: 'Note to the kitchen', type: 'text', required: true, default: null },
          { name: 'urgent', label: 'Rush it', type: 'checkbox', required: false, default: false },
          { name: 'boxes', label: 'Boxes', type: 'number', required: false, default: 30 },
        ],
        actions: [
          { id: 'confirm', title: 'Confirm order' },
          { id: 'hold', title: 'Hold' },
          { id: 'cancel', title: 'Cancel order' },
        ],
        timeout_ms: null,
      }),
    )
    vi.spyOn(sampleRunsBackend, 'listRunEvents').mockResolvedValue([])
    const resumeRunSpy = vi.spyOn(sampleRunsBackend, 'resumeRun').mockResolvedValue(buildPausedRun(null))
    renderTestRunPage(`${routePaths.testRun}?runId=custom-run`)
    await flushBackendCalls()

    expect(screen.getByRole('heading', { name: 'Confirm order [ORDER ID]?' })).toBeInTheDocument()
    const actionNames = ['Confirm order', 'Hold', 'Cancel order']
    actionNames.forEach((name) => expect(screen.getByRole('button', { name })).toBeDisabled())
    expect(screen.getByText('Fill in Note to the kitchen to answer')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Boxes (optional)' })).toHaveValue(30)

    fireEvent.change(screen.getByRole('textbox', { name: 'Note to the kitchen' }), { target: { value: 'No peanuts' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rush it (optional)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))
    await flushBackendCalls()
    expect(resumeRunSpy).toHaveBeenCalledWith('custom-run', { check_order: { action: 'hold', values: { note: 'No peanuts', urgent: true, boxes: 30 } } })
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

  it('answers with the second action and still shows the result', async () => {
    const resumeRunSpy = vi.spyOn(sampleRunsBackend, 'resumeRun')
    await renderPausedTestRun()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this place' }))
    await flushBackendCalls()
    expect(resumeRunSpy).toHaveBeenCalledWith('sample-run-1', { approve_message: { action: 'skip', values: { message: sampleDraftMessage } } })
    expect(screen.queryByRole('heading', { name: 'Send this message?' })).not.toBeInTheDocument()
    await playSampleRunSteps(stepsAfterApproval)
    await flushBackendCalls()
    expect(screen.getByText('Run result screen')).toBeInTheDocument()
  })

  it('disables every action while a required field is empty', async () => {
    await renderPausedTestRun()
    fireEvent.change(screen.getByLabelText('Message, edit before sending if needed'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip this place' })).toBeDisabled()
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
    await startTestFromForm()
    expect(screen.getByRole('alert')).toHaveTextContent('Add an OpenAI key first')
    expect(screen.getByRole('button', { name: 'Start the test' })).toBeEnabled()
  })

  it('shows the plugin setup card in the chat when the start is refused for missing plugins', async () => {
    vi.spyOn(sampleRunsBackend, 'startRun').mockRejectedValue(new BackendError('missing_plugins', 'Install whatsapp-api first'))
    await startTestFromForm()
    await flushBackendCalls()
    expect(screen.getByRole('alert')).toHaveTextContent('Set up its plugins in the chat, then start again')
    const chat = screen.getByRole('region', { name: 'Chat' })
    const setupMessage = within(chat).getByRole('group', { name: 'This agent needs 2 plugins · 0 ready' })
    expect(within(setupMessage).getByRole('button', { name: 'Install & trust whatsapp-api' })).toBeInTheDocument()
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
