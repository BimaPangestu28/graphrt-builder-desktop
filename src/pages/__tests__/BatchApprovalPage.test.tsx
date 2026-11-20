import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ApprovalAnswer, PendingApproval, RunReview } from '@/api/runReviewTypes'
import { resetSampleRunReview, sampleReviewRunId, sampleRunReviewBackend } from '@/api/sampleBackend/runReview'
import type { Run } from '@/api/types'
import { routePaths, runReviewPath } from '@/routes'
import { LocationProbe } from '@/test/runTestUtils'
import { BatchApprovalPage } from '../BatchApprovalPage'

function renderBatchApprovalPage(initialEntry: string = routePaths.batchApproval) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BatchApprovalPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function buildPending(index: number, changes: Partial<PendingApproval> = {}): PendingApproval {
  const frame = `each_order[${index}]`
  return {
    id: `${frame}/confirm`,
    kind: 'form',
    nodeId: 'confirm',
    frame,
    resumeKey: `${frame}/confirm`,
    stepTitle: 'Confirm the order',
    prompt: `Confirm order ${index + 1}?`,
    fields: [{ name: 'note', label: 'Note', fieldType: 'text', required: true, defaultValue: `Note ${index + 1}` }],
    actions: [
      { id: 'confirm', title: 'Confirm' },
      { id: 'drop', title: 'Drop' },
    ],
    timeoutMs: null,
    expiresAt: null,
    onTimeout: null,
    toolCall: null,
    container: { nodeId: 'each_order', nodeType: 'iteration', title: 'For each order', index, total: 3, finished: index, item: { name: `[ORDER ${index + 1}]` } },
    ...changes,
  }
}

function buildReview(changes: Partial<RunReview>): RunReview {
  return {
    runId: 'run-seq',
    agentId: 'orders',
    agentName: 'Order desk',
    trigger: 'schedule',
    status: 'paused',
    startedAt: new Date().toISOString(),
    pending: [],
    otherPauseKinds: [],
    answered: [],
    ...changes,
  }
}

/**
 * A mocked backend for a sequential iteration over 3 orders: graphrt asks about one order at a
 * time, and the next question exists only after the current one is answered.
 */
function mockSequentialRun(itemOverrides: Array<Partial<PendingApproval>> = []) {
  let answeredCount = 0
  const answerCalls: Array<Record<string, ApprovalAnswer>> = []
  const currentReview = (): RunReview =>
    answeredCount >= 3
      ? buildReview({ status: 'succeeded' })
      : buildReview({ pending: [buildPending(answeredCount, itemOverrides[answeredCount])], answered: [] })
  vi.spyOn(sampleRunReviewBackend, 'getRunReview').mockImplementation(async () => currentReview())
  vi.spyOn(sampleRunReviewBackend, 'answerApprovals').mockImplementation(async (_runId, answers) => {
    answerCalls.push(answers)
    answeredCount += 1
    return { id: 'run-seq', status: 'running' } as Run
  })
  return answerCalls
}

describe('BatchApprovalPage', () => {
  beforeEach(() => {
    resetSampleRunReview()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the latest run waiting for answers and lists its questions with their items', async () => {
    renderBatchApprovalPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Review 12 items' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Current location')).toHaveTextContent(runReviewPath(sampleReviewRunId)))
    expect(screen.getByText(/^Maps leads to WhatsApp · scheduled run · /)).toBeInTheDocument()
    expect(screen.getByText('12 of 12 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Send: [PLACE NAME 4]' })).toBeChecked()
    expect(screen.getByText('Cafe · score 4')).toBeInTheDocument()
    expect(screen.getByText('3 of 15 done · For each place')).toBeInTheDocument()
    expect(screen.getByText('Ask me before sending')).toBeInTheDocument()
    expect(screen.queryByText(/Daily limit/)).not.toBeInTheDocument()
  })

  it('updates the send count when a question is unticked', async () => {
    renderBatchApprovalPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Send: [PLACE NAME 2]' }))
    expect(screen.getByRole('button', { name: 'Send 11 selected' })).toBeInTheDocument()
    expect(screen.getByText('Unticked ones get “Skip”')).toBeInTheDocument()
  })

  it('selects everything with the bulk checkbox and reveals hidden questions', async () => {
    renderBatchApprovalPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Send: [PLACE NAME 2]' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '11 of 12 selected' }))
    expect(screen.getByRole('button', { name: 'Send 12 selected' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 8 more' }))
    expect(screen.getByRole('checkbox', { name: 'Send: [PLACE NAME 12]' })).toBeChecked()
  })

  it('sends every answer in one resume, with edits and unticked ones skipped', async () => {
    const answerSpy = vi.spyOn(sampleRunReviewBackend, 'answerApprovals')
    renderBatchApprovalPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit answer for [PLACE NAME 2]' }))
    const messageField = screen.getByRole('textbox', { name: 'Message for [PLACE NAME 2]' })
    fireEvent.change(messageField, { target: { value: 'Halo!' } })
    expect(screen.queryByRole('textbox', { name: 'Message for [PLACE NAME 1]' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send: [PLACE NAME 3]' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send 11 selected' }))

    expect(await screen.findByText(/The run finished\. You answered 12\./)).toBeInTheDocument()
    const answers = answerSpy.mock.calls[0][1]
    expect(Object.keys(answers)).toHaveLength(12)
    expect(answers['for_each_place[4]/approve_message']).toEqual({ action: 'send', values: { message: 'Halo!' } })
    expect(answers['for_each_place[5]/approve_message']).toMatchObject({ action: 'skip' })
    expect(screen.getByRole('link', { name: 'See what it did' })).toBeInTheDocument()
  })

  it('answers everything with the second action from "Skip all"', async () => {
    const answerSpy = vi.spyOn(sampleRunReviewBackend, 'answerApprovals')
    renderBatchApprovalPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Skip all' }))
    await screen.findByText(/The run finished/)
    expect(Object.values(answerSpy.mock.calls[0][1]).every((answer) => 'action' in answer && answer.action === 'skip')).toBe(true)
  })

  it('reviews a sequential iteration one item at a time', async () => {
    const answerCalls = mockSequentialRun()
    renderBatchApprovalPage(runReviewPath('run-seq'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Review 1 item' })).toBeInTheDocument()
    expect(screen.getByText('0 of 3 done · For each order')).toBeInTheDocument()
    expect(screen.getByText('Confirm order 1?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 1 selected' }))

    expect(await screen.findByText('Confirm order 2?')).toBeInTheDocument()
    expect(answerCalls[0]).toEqual({ 'each_order[0]/confirm': { action: 'confirm', values: { note: 'Note 1' } } })
    expect(screen.getByText('1 of 3 done · For each order')).toBeInTheDocument()
  })

  it('answers all remaining items one after another, labelled as such', async () => {
    const answerCalls = mockSequentialRun()
    renderBatchApprovalPage(runReviewPath('run-seq'))
    const answerAllButton = await screen.findByRole('button', { name: 'Confirm all remaining' })
    expect(screen.getByText(/graphrt asks about the next items only after these are answered/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note for [ORDER 1]' }), { target: { value: 'Edited' } })
    fireEvent.click(answerAllButton)

    expect(await screen.findByText(/The run finished\./)).toBeInTheDocument()
    expect(answerCalls).toEqual([
      { 'each_order[0]/confirm': { action: 'confirm', values: { note: 'Edited' } } },
      { 'each_order[1]/confirm': { action: 'confirm', values: { note: 'Note 2' } } },
      { 'each_order[2]/confirm': { action: 'confirm', values: { note: 'Note 3' } } },
    ])
  })

  it('stops answering automatically at an item with an empty required field', async () => {
    const answerCalls = mockSequentialRun([{}, { fields: [{ name: 'note', label: 'Note', fieldType: 'text', required: true, defaultValue: null }] }])
    renderBatchApprovalPage(runReviewPath('run-seq'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm all remaining' }))
    expect(await screen.findByText('Stopped answering automatically: [ORDER 2] needs you')).toBeInTheDocument()
    expect(answerCalls).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Confirm 1 selected' })).toBeDisabled()
    expect(screen.getByText('Fill in the required fields of [ORDER 2] first')).toBeInTheDocument()
  })

  it('offers every action of a question with more than two', async () => {
    const actions = [
      { id: 'confirm', title: 'Confirm' },
      { id: 'hold', title: 'Hold' },
      { id: 'drop', title: 'Drop' },
    ]
    vi.spyOn(sampleRunReviewBackend, 'getRunReview').mockResolvedValue(buildReview({ pending: [buildPending(0, { actions }), buildPending(1, { actions })] }))
    const answerSpy = vi.spyOn(sampleRunReviewBackend, 'answerApprovals').mockResolvedValue({ id: 'run-seq', status: 'running' } as Run)
    renderBatchApprovalPage(runReviewPath('run-seq'))
    const answerSelect = await screen.findByRole('combobox', { name: 'Answer for [ORDER 2]' })
    expect(within(answerSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['Confirm', 'Hold', 'Drop'])
    fireEvent.change(answerSelect, { target: { value: 'hold' } })
    fireEvent.click(screen.getByRole('button', { name: 'Answer 2' }))
    await waitFor(() => expect(answerSpy).toHaveBeenCalled())
    expect(answerSpy.mock.calls[0][1]).toEqual({
      'each_order[0]/confirm': { action: 'confirm', values: { note: 'Note 1' } },
      'each_order[1]/confirm': { action: 'hold', values: { note: 'Note 2' } },
    })
  })

  it('says when nothing waits for an answer', async () => {
    vi.spyOn(sampleRunReviewBackend, 'getRunReview').mockResolvedValue(null)
    renderBatchApprovalPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Nothing to review' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Runs' })).toHaveAttribute('href', routePaths.runs)
  })

  it('shows an error for an unknown run', async () => {
    renderBatchApprovalPage(runReviewPath('missing-run'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No run missing-run')
  })

  it('reviews the tool calls an agent waits to make and answers them in one resume', async () => {
    const toolCallQuestion = (callId: string, tool: string): PendingApproval => ({
      ...buildPending(0),
      id: `find_leads#${callId}`,
      kind: 'toolCall',
      nodeId: 'find_leads',
      frame: '',
      resumeKey: 'find_leads',
      stepTitle: 'Find and contact leads',
      prompt: null,
      fields: [],
      actions: [
        { id: 'allow', title: 'Allow' },
        { id: 'decline', title: 'Decline' },
      ],
      container: null,
      toolCall: { callId, name: tool, provider: 'whatsapp-web', tool, arguments: { phone: '+62 812', api_key: '[hidden]' }, reason: null },
    })
    vi.spyOn(sampleRunReviewBackend, 'getRunReview').mockResolvedValue(buildReview({ pending: [toolCallQuestion('c1', 'send_message'), toolCallQuestion('c2', 'send_file')] }))
    const answerSpy = vi.spyOn(sampleRunReviewBackend, 'answerApprovals').mockResolvedValue({ id: 'run-seq', status: 'running' } as Run)
    renderBatchApprovalPage(runReviewPath('run-seq'))

    expect(await screen.findByRole('heading', { level: 1, name: 'Review 2 items' })).toBeInTheDocument()
    expect(screen.getByText('whatsapp-web › send_message')).toBeInTheDocument()
    expect(screen.getAllByText('phone: +62 812 · api_key: [hidden]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow: whatsapp-web › send_file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow 1 selected' }))

    await waitFor(() => expect(answerSpy).toHaveBeenCalled())
    expect(answerSpy.mock.calls[0][1]).toEqual({ find_leads: { approvals: { c1: true, c2: false } } })
  })
})
