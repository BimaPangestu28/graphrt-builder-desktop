import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { addSampleRun, resetSampleRuns } from '@/api/sampleBackend/runs'
import type { GraphrtEvent } from '@/api/types'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { NodesView } from '../NodesView'

/**
 * The run clock ticks every second while a run is active. Only the elapsed-time badge of a
 * running step (and the run bar) may follow it: node cards must not re-render per tick.
 * Each card renders one `NodeDecoration`, so counting its renders counts card renders.
 */
const decorationRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('../run/NodeDecorations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../run/NodeDecorations')>()
  function CountedNodeDecoration(props: Parameters<typeof actual.NodeDecoration>[0]) {
    decorationRenders.count += 1
    return actual.NodeDecoration(props)
  }
  return { ...actual, NodeDecoration: CountedNodeDecoration }
})

const agentId = 'maps-leads'

const runningEvents: GraphrtEvent[] = [
  { type: 'run_started', resumed: false },
  { type: 'node_started', node_id: 'ask_input', frame: '' },
  { type: 'node_succeeded', node_id: 'ask_input', frame: '', outputs: {}, elapsed_ms: 0 },
  { type: 'node_started', node_id: 'search_maps', frame: '' },
]

describe('Nodes view clock', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSampleRuns()
    decorationRenders.count = 0
  })
  afterEach(() => vi.useRealTimers())

  it('updates the elapsed time of a running step without re-rendering the node cards', async () => {
    // Fake clock that still advances on its own, so the backend's timeouts and React Flow work.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    addSampleRun(agentId, { events: runningEvents })
    render(
      <MemoryRouter>
        <NodesView agent={readStoredAgent(agentId)} autosaveDelayMs={null} />
      </MemoryRouter>,
    )
    const canvas = await screen.findByTestId('node-canvas')
    const runningChip = await waitFor(() => {
      const chip = within(canvas).getByTestId('run-status-search_maps')
      expect(chip).toHaveAttribute('data-status', 'running')
      return chip
    })
    // Let the first load settle (layout, validation, recent runs) before counting.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))

    const elapsedBefore = runningChip.textContent
    const rendersBefore = decorationRenders.count
    expect(rendersBefore).toBeGreaterThan(0)
    act(() => vi.advanceTimersByTime(3_000))

    expect(runningChip.textContent).not.toBe(elapsedBefore)
    expect(decorationRenders.count).toBe(rendersBefore)
  })
})
