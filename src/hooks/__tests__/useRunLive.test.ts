import { act, renderHook } from '@testing-library/react'
import { startRun } from '@/api/runs'
import { resetSampleRuns, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '@/api/sampleBackend/runs'
import type { RunEventRecord } from '@/api/types'
import { appendRunEvent, createFrameBatcher, mergeRunEvents, useRunLive } from '../useRunLive'

async function advanceSteps(stepCount: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * stepCount)
  })
}

function buildEventRecord(seq: number): RunEventRecord {
  return { runId: 'run-1', seq, event: { type: 'node_started', node_id: `node_${seq}` }, createdAt: '2026-11-18T00:00:00Z' }
}

describe('mergeRunEvents', () => {
  it('orders by seq and drops duplicates', () => {
    const merged = mergeRunEvents([buildEventRecord(2), buildEventRecord(1)], [buildEventRecord(2), buildEventRecord(3)])
    expect(merged.map((record) => record.seq)).toEqual([1, 2, 3])
  })

  it('keeps run_succeeded when a status_changed signal reuses its seq', () => {
    const succeeded: RunEventRecord = { ...buildEventRecord(4), event: { type: 'run_succeeded' } }
    const statusSignal: RunEventRecord = { ...buildEventRecord(4), event: { type: 'status_changed' } }
    const merged = mergeRunEvents([succeeded], [statusSignal])
    expect(merged.map((record) => record.event.type)).toEqual(['run_succeeded'])
  })

  it('joins live chunks that share a seq and prefers the stored coalesced row', () => {
    const chunk = (text: string, coalesced?: number): RunEventRecord => ({
      ...buildEventRecord(5),
      event: { type: 'node_chunk', node_id: 'write', chunk: text, ...(coalesced ? { coalesced } : {}) },
    })
    const live = mergeRunEvents(mergeRunEvents([], [chunk('Hel')]), [chunk('lo')])
    expect(live[0].event.chunk).toBe('Hello')

    const withStored = mergeRunEvents(live, [chunk('Hello!', 3)])
    expect(withStored[0].event.chunk).toBe('Hello!')
    expect(mergeRunEvents(withStored, [chunk(' late')])[0].event.chunk).toBe('Hello!')
  })
})

describe('appendRunEvent', () => {
  it('appends an event newer than the last one', () => {
    const currentEvents = [buildEventRecord(1), buildEventRecord(2)]
    const appended = appendRunEvent(currentEvents, buildEventRecord(3))
    expect(appended.map((record) => record.seq)).toEqual([1, 2, 3])
    expect(appended[0]).toBe(currentEvents[0])
  })

  it('joins a live chunk into the last row with the same seq', () => {
    const chunk = (text: string): RunEventRecord => ({ ...buildEventRecord(5), event: { type: 'node_chunk', node_id: 'write', chunk: text } })
    const joined = appendRunEvent([buildEventRecord(4), chunk('Hel')], chunk('lo'))
    expect(joined).toHaveLength(2)
    expect(joined[1].event.chunk).toBe('Hello')
  })

  it('falls back to a full merge for an out-of-order event', () => {
    const merged = appendRunEvent([buildEventRecord(1), buildEventRecord(3)], buildEventRecord(2))
    expect(merged.map((record) => record.seq)).toEqual([1, 2, 3])
  })

  it('returns the same list for a status signal', () => {
    const currentEvents = [buildEventRecord(1)]
    expect(appendRunEvent(currentEvents, { ...buildEventRecord(1), event: { type: 'status_changed' } })).toBe(currentEvents)
  })
})

describe('createFrameBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the first event over at once and the rest of the burst after the frame', () => {
    const onBatch = vi.fn()
    const batcher = createFrameBatcher<number>(onBatch)
    batcher.add(1)
    batcher.add(2)
    batcher.add(3)
    expect(onBatch.mock.calls).toEqual([[[1]]])
    vi.advanceTimersByTime(16)
    expect(onBatch.mock.calls).toEqual([[[1]], [[2, 3]]])
  })

  it('drops queued events on cancel', () => {
    const onBatch = vi.fn()
    const batcher = createFrameBatcher<number>(onBatch)
    batcher.add(1)
    batcher.add(2)
    batcher.cancel()
    vi.advanceTimersByTime(50)
    expect(onBatch).toHaveBeenCalledTimes(1)
  })
})

describe('useRunLive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSampleRuns()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('loads a stored run with its events', async () => {
    const { result } = renderHook(() => useRunLive('maps-leads-0900'))
    expect(result.current.isLoading).toBe(true)
    await advanceSteps(0)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.run?.status).toBe('succeeded')
    expect(result.current.events.length).toBeGreaterThan(5)
  })

  it('applies live events and reloads the run when it pauses', async () => {
    const run = await startRun('maps-leads', 'test', {})
    const { result } = renderHook(() => useRunLive(run.id))
    await advanceSteps(0)
    expect(result.current.events).toHaveLength(0)
    await advanceSteps(3)
    expect(result.current.events.map(({ event }) => event.type)).toEqual(['run_started', 'node_started', 'node_succeeded'])
    await advanceSteps(sampleStepsUntilApproval - 3)
    expect(result.current.run?.status).toBe('paused')
    expect(result.current.run?.pauseReasons?.[0].node_id).toBe('approve_message')
  })

  it('ignores events of other runs', async () => {
    const { result } = renderHook(() => useRunLive('maps-leads-0900'))
    await advanceSteps(0)
    const eventCount = result.current.events.length
    await startRun('maps-leads', 'test', {})
    await advanceSteps(5)
    expect(result.current.events).toHaveLength(eventCount)
  })

  it('unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn()
    vi.spyOn(sampleRunsBackend, 'subscribeToRunEvents').mockResolvedValue(unsubscribe)
    const { unmount } = renderHook(() => useRunLive('maps-leads-0900'))
    await advanceSteps(0)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reports a run that cannot be loaded', async () => {
    const { result } = renderHook(() => useRunLive('missing'))
    await advanceSteps(0)
    expect(result.current.error?.message).toBe('No run missing')
    expect(result.current.run).toBeNull()
  })

  it('follows nothing without a run id', () => {
    const subscribeSpy = vi.spyOn(sampleRunsBackend, 'subscribeToRunEvents')
    const { result } = renderHook(() => useRunLive(null))
    expect(result.current).toEqual({ run: null, events: [], error: null, isLoading: false })
    expect(subscribeSpy).not.toHaveBeenCalled()
  })
})
