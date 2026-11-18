import type { RunEventPayload } from '@/api/types'
import { sampleDraftMessage } from '../sampleTestRun'
import { resetSampleRuns, sampleApprovalNodeId, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '../runs'

async function playSteps(stepCount: number) {
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * stepCount)
}

describe('sample runs backend', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSampleRuns()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds the Runs screen history, newest first, with event logs', async () => {
    const runs = await sampleRunsBackend.listRuns()
    expect(runs.map((run) => run.id)).toEqual([
      'lead-tracker-1340',
      'maps-leads-0900',
      'catering-assistant-0852',
      'morning-digest-0700',
      'maps-leads-test',
      'morning-digest-yesterday',
    ])
    expect(runs[0].status).toBe('running')
    const events = await sampleRunsBackend.listRunEvents('maps-leads-0900')
    expect(events.map((record) => record.seq)).toEqual(events.map((_, index) => index + 1))
    expect(events.some(({ event }) => event.type === 'node_succeeded' && event.title === 'You approved 11 of 12')).toBe(true)
  })

  it('filters runs by agent, status and limit', async () => {
    expect(await sampleRunsBackend.listRuns({ agentId: 'morning-digest' })).toHaveLength(2)
    expect((await sampleRunsBackend.listRuns({ status: 'paused' })).map((run) => run.id)).toEqual(['catering-assistant-0852'])
    expect(await sampleRunsBackend.listRuns({ limit: 2 })).toHaveLength(2)
  })

  it('plays a test run to a pause with the drafted message', async () => {
    const payloads: RunEventPayload[] = []
    await sampleRunsBackend.subscribeToRunEvents((payload) => payloads.push(payload))
    const run = await sampleRunsBackend.startRun('maps-leads', 'test', { keyword: 'cafe' })
    expect(run.status).toBe('running')
    expect(payloads).toHaveLength(0)

    await playSteps(sampleStepsUntilApproval)
    const eventTypes = payloads.map((payload) => payload.event.type)
    expect(eventTypes.slice(0, 2)).toEqual(['run_started', 'node_started'])
    expect(eventTypes.slice(-3)).toEqual(['node_paused', 'run_paused', 'status_changed'])
    expect(payloads.every((payload) => payload.runId === run.id && payload.agentId === 'maps-leads')).toBe(true)

    const pausedRun = await sampleRunsBackend.getRun(run.id)
    expect(pausedRun.status).toBe('paused')
    expect(pausedRun.pauseReasons).toEqual([
      {
        frame: '',
        node_id: sampleApprovalNodeId,
        kind: 'human_input',
        data: expect.objectContaining({
          fields: [expect.objectContaining({ name: 'message', default: sampleDraftMessage })],
          actions: [
            { id: 'approve', title: 'Approve and send' },
            { id: 'skip', title: 'Skip this place' },
          ],
        }),
      },
    ])
    expect(await sampleRunsBackend.listRunEvents(run.id)).toHaveLength(payloads.length)
  })

  it('resumes an approved run to success with the edited message', async () => {
    const run = await sampleRunsBackend.startRun('maps-leads', 'test', {})
    await playSteps(sampleStepsUntilApproval)
    const resumedRun = await sampleRunsBackend.resumeRun(run.id, { [sampleApprovalNodeId]: { action: 'approve', values: { message: 'Edited' } } })
    expect(resumedRun.status).toBe('running')
    await playSteps(5)
    const finishedRun = await sampleRunsBackend.getRun(run.id)
    expect(finishedRun.status).toBe('succeeded')
    expect(finishedRun.outputs).toMatchObject({ sent_message: 'Edited', messages_sent: 1, places_found: 18, summary: 'Sent the test message to [PLACE NAME 1].' })
    expect(finishedRun.finishedAt).not.toBeNull()
  })

  it('resumes a skipped run to success without sending', async () => {
    const run = await sampleRunsBackend.startRun('maps-leads', 'test', {})
    await playSteps(sampleStepsUntilApproval)
    await sampleRunsBackend.resumeRun(run.id, { [sampleApprovalNodeId]: { action: 'skip', values: {} } })
    await playSteps(4)
    const finishedRun = await sampleRunsBackend.getRun(run.id)
    expect(finishedRun.status).toBe('succeeded')
    expect(finishedRun.outputs).toMatchObject({ skipped: true, messages_sent: 0 })
    const events = await sampleRunsBackend.listRunEvents(run.id)
    expect(events.filter(({ event }) => event.type === 'node_skipped').map(({ event }) => event.node_id)).toEqual(['send_whatsapp'])
  })

  it('rejects resuming a run that is not paused or a malformed answer', async () => {
    const run = await sampleRunsBackend.startRun('maps-leads', 'test', {})
    await expect(sampleRunsBackend.resumeRun(run.id, {})).rejects.toMatchObject({ code: 'invalid_input' })
    await playSteps(sampleStepsUntilApproval)
    await expect(sampleRunsBackend.resumeRun(run.id, { [sampleApprovalNodeId]: { action: 'maybe' } })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('aborts a running run and stops its script', async () => {
    const run = await sampleRunsBackend.startRun('maps-leads', 'test', {})
    await playSteps(2)
    await sampleRunsBackend.abortRun(run.id)
    const eventCountAfterAbort = (await sampleRunsBackend.listRunEvents(run.id)).length
    await playSteps(sampleStepsUntilApproval)
    expect((await sampleRunsBackend.getRun(run.id)).status).toBe('aborted')
    expect(await sampleRunsBackend.listRunEvents(run.id)).toHaveLength(eventCountAfterAbort)
  })

  it('stops sending events after unsubscribing', async () => {
    const onRunEvent = vi.fn()
    const unsubscribe = await sampleRunsBackend.subscribeToRunEvents(onRunEvent)
    unsubscribe()
    await sampleRunsBackend.startRun('maps-leads', 'test', {})
    await playSteps(3)
    expect(onRunEvent).not.toHaveBeenCalled()
  })

  it('reports unknown runs as not found', async () => {
    await expect(sampleRunsBackend.getRun('nope')).rejects.toMatchObject({ code: 'not_found' })
    await expect(sampleRunsBackend.listRunEvents('nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})
