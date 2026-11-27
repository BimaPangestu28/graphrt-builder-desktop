import { getRunSummary, listAgentRunStats } from '@/api/runSummary'
import type { GraphrtEvent, Run } from '@/api/types'
import { resetSampleAgents } from '../agents'
import { resetSampleRuns, sampleApprovalNodeId, sampleRunStepDelayMs, sampleRunsBackend, sampleStepsUntilApproval } from '../runs'
import { buildSampleAgentRunStats, sampleRunSummaryBackend, summarizeSampleRun } from '../runSummary'

const dayMs = 24 * 60 * 60 * 1000

function buildRun(changes: Partial<Run>): Run {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    agentVersion: 1,
    trigger: 'manual',
    status: 'succeeded',
    startedAt: '2026-11-18T09:00:00.000Z',
    finishedAt: '2026-11-18T09:01:30.500Z',
    outputs: null,
    errorMessage: null,
    errorType: null,
    pauseReasons: null,
    ...changes,
  }
}

async function playSampleTestRun(action: 'approve' | 'skip'): Promise<string> {
  vi.useFakeTimers()
  const run = await sampleRunsBackend.startRun('maps-leads', 'test', {})
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * sampleStepsUntilApproval)
  await sampleRunsBackend.resumeRun(run.id, { [sampleApprovalNodeId]: { action, values: { message: 'Hi' } } })
  await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * 5)
  vi.useRealTimers()
  return run.id
}

describe('sample run summary backend', () => {
  beforeEach(() => {
    resetSampleRuns()
    resetSampleAgents()
  })

  afterEach(() => vi.useRealTimers())

  it('summarizes an approved sample test run through the API wrapper', async () => {
    const runId = await playSampleTestRun('approve')
    const summary = await getRunSummary(runId)
    expect(summary).toMatchObject({
      runId,
      agentId: 'maps-leads',
      status: 'succeeded',
      headline: 'Sent the test message to [PLACE NAME 1].',
      approvals: { approved: 1, skipped: 0, waiting: 0 },
      usage: { promptTokens: 180, completionTokens: 32, totalTokens: 212 },
    })
    expect(summary.steps.succeeded).toBeGreaterThan(0)
    expect(summary.items[0]).toMatchObject({ name: '[PLACE NAME 1]', status: 'sent' })
    expect(summary.counters.map((counter) => counter.name)).toEqual(['places_found', 'messages_sent', 'aiCostUsd'])
    expect(summary.durationMs).not.toBeNull()
  })

  it('counts a skipped approval', async () => {
    const runId = await playSampleTestRun('skip')
    const summary = await sampleRunSummaryBackend.getRunSummary(runId)
    expect(summary.approvals).toEqual({ approved: 0, skipped: 1, waiting: 0 })
    expect(summary.items.every((item) => item.status !== 'sent')).toBe(true)
  })

  it('reports a paused seeded run as waiting', async () => {
    const summary = await getRunSummary('catering-assistant-0852')
    expect(summary.status).toBe('paused')
    expect(summary.approvals.waiting).toBe(1)
    expect(summary.durationMs).toBeNull()
  })

  it('rejects unknown runs with not_found', async () => {
    await expect(getRunSummary('nope')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lists weekly stats for every sample agent, summing counters', async () => {
    const stats = await listAgentRunStats()
    const mapsLeads = stats.find((agentStats) => agentStats.agentId === 'maps-leads')
    expect(mapsLeads).toMatchObject({ runsThisWeek: 2, succeeded: 2, failed: 0, paused: 0, lastRunStatus: 'succeeded' })
    expect(mapsLeads?.counters.find((counter) => counter.name === 'messages_sent')?.value).toBe(12)
    const invoiceReminders = stats.find((agentStats) => agentStats.agentId === 'invoice-reminders')
    expect(invoiceReminders).toMatchObject({ runsThisWeek: 0, lastRunStatus: null, lastRunAt: null, counters: [] })
  })

  it('lists one agent and rejects unknown agents', async () => {
    const stats = await listAgentRunStats('morning-digest')
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ agentId: 'morning-digest', runsThisWeek: 2, succeeded: 1, failed: 1 })
    await expect(listAgentRunStats('nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('summarizeSampleRun', () => {
  it('ignores bookkeeping nodes and container usage, and reads the output convention', () => {
    const events: GraphrtEvent[] = [
      { type: 'node_started', node_id: 'start', exec_id: 'e0', kind: 'start' },
      { type: 'node_succeeded', node_id: 'start', exec_id: 'e0' },
      { type: 'node_started', node_id: 'each', exec_id: 'e1', kind: 'iteration' },
      { type: 'node_started', node_id: 'draft', exec_id: 'e2', kind: 'llm' },
      { type: 'node_succeeded', node_id: 'draft', exec_id: 'e2', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      { type: 'node_started', node_id: 'ask', exec_id: 'e3', kind: 'human-input' },
      { type: 'node_succeeded', node_id: 'ask', exec_id: 'e3', outputs: { action: 'reject' } },
      { type: 'node_failed', node_id: 'send', exec_id: 'e4' },
      { type: 'node_succeeded', node_id: 'each', exec_id: 'e1', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]
    const outputs = { summary: ' Done. ', items: [{ name: 'A', status: 'sent' }, 'skip me'], rows_added: 3, ready: true }
    const summary = summarizeSampleRun(buildRun({ outputs }), events)
    expect(summary.steps).toEqual({ succeeded: 3, failed: 1, skipped: 0 })
    expect(summary.approvals).toEqual({ approved: 0, skipped: 1, waiting: 0 })
    expect(summary.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    expect(summary.headline).toBe('Done.')
    expect(summary.items).toEqual([{ name: 'A', status: 'sent' }])
    expect(summary.counters).toEqual([{ name: 'rows_added', value: 3 }])
    expect(summary.durationMs).toBe(90_500)
  })

  it('handles an empty run', () => {
    const summary = summarizeSampleRun(buildRun({ status: 'failed', outputs: null, errorMessage: 'offline' }), [])
    expect(summary).toMatchObject({ headline: null, items: [], counters: [], usage: null, errorMessage: 'offline' })
    expect(summary.steps).toEqual({ succeeded: 0, failed: 0, skipped: 0 })
  })
})

describe('buildSampleAgentRunStats', () => {
  it('counts only the last 7 days but keeps the latest run', () => {
    const nowMs = Date.parse('2026-11-18T12:00:00Z')
    const runs = [
      buildRun({ id: 'old', startedAt: new Date(nowMs - 10 * dayMs).toISOString(), outputs: { messages_sent: 40 } }),
    ]
    const stats = buildSampleAgentRunStats('agent-1', runs, nowMs)
    expect(stats).toMatchObject({ runsThisWeek: 0, counters: [], lastRunStatus: 'succeeded' })

    const weekRuns = [
      buildRun({ id: 'paused', status: 'paused', startedAt: new Date(nowMs - dayMs).toISOString() }),
      buildRun({ id: 'sent', startedAt: new Date(nowMs - 2 * dayMs).toISOString(), outputs: { messages_sent: 5 } }),
      buildRun({ id: 'sent-again', startedAt: new Date(nowMs - 3 * dayMs).toISOString(), outputs: { messages_sent: 2 } }),
      ...runs,
    ]
    expect(buildSampleAgentRunStats('agent-1', weekRuns, nowMs)).toMatchObject({
      runsThisWeek: 3,
      succeeded: 2,
      paused: 1,
      lastRunStatus: 'paused',
      counters: [{ name: 'messages_sent', value: 7 }],
    })
  })
})
