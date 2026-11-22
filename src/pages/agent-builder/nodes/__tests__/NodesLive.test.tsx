import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend, setSampleBuilderBusy } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readCurrentSteps, readStoredAgent, saveNewVersion } from '@/api/sampleBackend/sampleAgentStore'
import { buildSampleApprovalPauseData } from '@/api/sampleBackend/sampleTestRun'
import { addSampleRun, resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { sampleRunReviewBackend } from '@/api/sampleBackend/runReview'
import type { GraphrtEvent } from '@/api/types'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { useCanvasNotes } from '../notes/useCanvasNotes'
import { NodesView } from '../NodesView'
import { SyncBanner } from '../SyncBanner'
import { useAgentGraph } from '../useAgentGraph'

// Real ELK is slow in jsdom; these tests only need non-overlapping positions.
vi.mock('../flow/layoutEngine', () => import('./fakeElkLayout'))

const agentId = 'maps-leads'

const runningEvents: GraphrtEvent[] = [
  { type: 'run_started', resumed: false },
  { type: 'node_started', node_id: 'ask_input', frame: '' },
  { type: 'node_succeeded', node_id: 'ask_input', frame: '', outputs: {}, elapsed_ms: 0 },
  { type: 'node_started', node_id: 'search_maps', frame: '' },
]

function renderNodesView(props: Partial<Parameters<typeof NodesView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <NodesView agent={readStoredAgent(agentId)} autosaveDelayMs={null} {...props} />
    </MemoryRouter>,
  )
}

async function findCanvas() {
  const canvas = await screen.findByTestId('node-canvas')
  await waitFor(() => expect(within(canvas).getByTestId('node-search_maps')).toBeInTheDocument())
  return canvas
}

describe('Nodes view live run, problems, sync and notes', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSampleRuns()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a test that is still going on the nodes, with the run bar and Stop run', async () => {
    const run = addSampleRun(agentId, { events: runningEvents })
    const abortSpy = vi.spyOn(sampleRunsBackend, 'abortRun')
    renderNodesView()
    await findCanvas()

    await waitFor(() => expect(screen.getByTestId('run-status-search_maps')).toHaveAttribute('data-status', 'running'))
    expect(screen.getByTestId('run-status-ask_input')).toHaveTextContent('Done')
    expect(screen.getByTestId('run-status-write_message')).toHaveTextContent('Not started')
    const runBar = screen.getByRole('region', { name: 'Test run' })
    expect(within(runBar).getByRole('status')).toHaveTextContent(/Running · \d+:\d\d · 1 of 4 steps done/)
    expect(within(runBar).getByRole('link', { name: 'Steps view' })).toHaveAttribute('href', `/agents/${agentId}/test?runId=${run.id}`)

    fireEvent.click(within(runBar).getByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(abortSpy).toHaveBeenCalledWith(run.id))
  })

  it('opens the question of a waiting node with Review and sends the answer', async () => {
    const pausedEvents: GraphrtEvent[] = [
      ...runningEvents,
      { type: 'node_succeeded', node_id: 'search_maps', frame: '', outputs: {}, elapsed_ms: 900 },
      { type: 'node_started', node_id: 'for_each_place', frame: '' },
      { type: 'node_progress', node_id: 'for_each_place', frame: '', name: 'iteration_next', data: { index: 0, total: 1 } },
      { type: 'node_started', node_id: 'approve_message', frame: 'for_each_place[0]' },
      { type: 'node_paused', node_id: 'approve_message', frame: 'for_each_place[0]' },
      { type: 'run_paused' },
    ]
    const run = addSampleRun(agentId, { events: pausedEvents, status: 'paused', pauseReasons: [{ frame: '', node_id: 'approve_message', kind: 'human_input', data: buildSampleApprovalPauseData() }] })
    const answerSpy = vi.spyOn(sampleRunReviewBackend, 'answerApprovals').mockResolvedValue({ ...run, status: 'running' })
    renderNodesView()
    await findCanvas()

    const chip = await screen.findByTestId('run-status-approve_message')
    await waitFor(() => expect(chip).toHaveAttribute('data-status', 'waiting'))
    expect(screen.getByTestId('loop-counters')).toHaveTextContent('1 of 1')
    fireEvent.click(within(screen.getByTestId('run-details-approve_message')).getByRole('button', { name: 'Review' }))

    const review = await screen.findByRole('dialog', { name: 'Review' })
    fireEvent.click(within(review).getByRole('button', { name: 'Approve and send' }))
    await waitFor(() => expect(answerSpy).toHaveBeenCalledWith(run.id, { approve_message: expect.objectContaining({ action: 'approve' }) }))
  })

  it('starts a test from the Nodes view with the last inputs', async () => {
    const startSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderNodesView()
    await findCanvas()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(startSpy).toHaveBeenCalledWith(agentId, 'test', expect.objectContaining({ keyword: 'cafe' })))
    expect(await screen.findByRole('region', { name: 'Test run' })).toBeInTheDocument()
  })

  it('lists blocking problems with Show node and Fix with builder, and turns Test off with the reason', async () => {
    const loaded = await sampleAgentGraphBackend.getAgentGraph(agentId)
    const broken: AgentGraph = {
      ...loaded,
      problems: [{ severity: 'error', code: 'node_config', message: 'Send WhatsApp message needs a phone number', nodeId: 'send_whatsapp', edgeId: null }],
    }
    vi.spyOn(sampleAgentGraphBackend, 'getAgentGraph').mockResolvedValue(broken)
    const askBuilder = vi.fn()
    renderNodesView({ onAskBuilder: askBuilder })
    await findCanvas()

    const panel = screen.getByRole('region', { name: 'Problems' })
    expect(panel).toHaveTextContent('1 problem to fix before it runs')
    expect(panel).toHaveTextContent('Test is off until this is fixed: 1 problem, Settings need fixing in Send WhatsApp')
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled()
    expect(within(screen.getByTestId('node-send_whatsapp')).getByTestId('node-problem-chip')).toHaveTextContent('Settings need fixing')

    fireEvent.click(within(panel).getByRole('button', { name: 'Show node' }))
    expect(await screen.findByRole('complementary', { name: 'Step settings' })).toHaveTextContent('Send WhatsApp')
    fireEvent.click(within(panel).getByRole('button', { name: 'Fix with builder' }))
    expect(askBuilder).toHaveBeenCalledWith('Fix Send WhatsApp: Send WhatsApp message needs a phone number')
  })

  it('validates on request and says when nothing was found', async () => {
    const validateSpy = vi.spyOn(sampleAgentGraphBackend, 'validateAgentGraph')
    renderNodesView()
    await findCanvas()
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(await screen.findByText('Validate found no problems')).toBeInTheDocument()
    expect(validateSpy).toHaveBeenCalledWith(agentId, 7, expect.objectContaining({ nodes: expect.any(Array) }))
  })

  it('adds a sticky note from the toolbar and saves its text', async () => {
    renderNodesView()
    const canvas = await findCanvas()
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    const textBox = await within(canvas).findByRole('textbox', { name: 'Note text' })
    fireEvent.change(textBox, { target: { value: 'Ask Sari about the menu' } })
    fireEvent.blur(textBox)
    await waitFor(async () => expect((await sampleAgentGraphBackend.getCanvasNotes(agentId, 7)).notes).toMatchObject([{ text: 'Ask Sari about the menu', color: 'yellow' }]), { timeout: 3000 })
  })
})

describe('canvas notes', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('loads, moves and removes notes, saving each change', async () => {
    await sampleAgentGraphBackend.saveCanvasNotes(agentId, 7, [{ noteId: 'n1', x: 0, y: 0, w: 200, h: 100, text: 'Keep', color: 'blue' }])
    const { result } = renderHook(() => useCanvasNotes(agentId, 7))
    await waitFor(() => expect(result.current.notes).toHaveLength(1))

    act(() => result.current.updateNote('n1', { x: 40, y: 80 }))
    await waitFor(async () => expect((await sampleAgentGraphBackend.getCanvasNotes(agentId, 7)).notes[0]).toMatchObject({ x: 40, y: 80 }), { timeout: 3000 })
    act(() => result.current.removeNote('n1'))
    await waitFor(async () => expect((await sampleAgentGraphBackend.getCanvasNotes(agentId, 7)).notes).toEqual([]), { timeout: 3000 })
  })
})

/** The hook and the banner together, like the Nodes view uses them. */
function SyncHarness({ currentVersion }: { currentVersion: number }) {
  const controller = useAgentGraph({ agentId, currentVersion })
  return (
    <>
      <SyncBanner controller={controller} />
      <button type="button" onClick={() => controller.updateNode('write_message', { title: 'Mine' }, 'renamed it')}>
        Edit
      </button>
      <span data-testid="status">{controller.status}</span>
      <span data-testid="title">{controller.graph?.nodes.find((node) => node.id === 'write_message')?.title}</span>
    </>
  )
}

describe('SyncBanner', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('queues an edit while the builder works and asks per step when the builder changed it too', async () => {
    const view = render(<SyncHarness currentVersion={7} />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'))
    act(() => setSampleBuilderBusy(agentId, true))
    expect(await screen.findByText(/The builder is changing this agent/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('queued-edits')).toHaveTextContent('1 edit waiting: title of Write a short message')

    saveNewVersion(agentId, readCurrentSteps(agentId).map((step) => (step.id === 'write_message' ? { ...step, title: 'The builder’s title' } : step)), 'Chat change')
    act(() => setSampleBuilderBusy(agentId, false))
    view.rerender(<SyncHarness currentVersion={8} />)

    const card = await screen.findByTestId('conflict-write_message')
    expect(card).toHaveTextContent('The builder also changed Write a short message')
    fireEvent.click(within(card).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'))
    expect(screen.getByTestId('title')).toHaveTextContent('Mine')
    expect(readStoredAgent(agentId).currentVersion).toBe(9)
  })
})
