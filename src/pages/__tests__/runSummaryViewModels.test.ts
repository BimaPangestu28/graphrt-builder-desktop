import type { AgentRunStats, RunSummary } from '@/api/runSummaryTypes'
import type { Run } from '@/api/types'
import { formatCounterLabel, formatCounterValue, pickHeadlineCounter } from '@/pages/agent-run/runCounters'
import { buildItemTable, buildRunResultView, formatDurationMs, toneForItemStatus } from '@/pages/agent-run/runResultSummary'
import { buildPausedRunItems, buildRecentRunRows, describeAgentRunStats } from '@/pages/home-dashboard/homeViewModel'
import { agentPath } from '@/routes'

const now = new Date('2026-11-18T12:00:00')
const agentName = (agentId: string) => (agentId === 'agent-1' ? 'Cafe offers' : agentId)

function buildRun(changes: Partial<Run>): Run {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    agentVersion: 1,
    trigger: 'manual',
    status: 'succeeded',
    startedAt: new Date('2026-11-18T09:00:00').toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    pauseReasons: null,
    ...changes,
  }
}

function buildSummary(changes: Partial<RunSummary>): RunSummary {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    status: 'succeeded',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 41_000,
    steps: { succeeded: 0, failed: 0, skipped: 0 },
    approvals: { approved: 0, skipped: 0, waiting: 0 },
    usage: null,
    headline: null,
    items: [],
    counters: [],
    errorMessage: null,
    ...changes,
  }
}

describe('run counters', () => {
  it('labels and formats counters', () => {
    expect(formatCounterLabel('messages_sent')).toBe('Messages sent')
    expect(formatCounterLabel('aiCostUsd')).toBe('AI cost')
    expect(formatCounterValue('ai_cost_usd', 0.0041)).toBe('$0.004')
    expect(formatCounterValue('rows_added', 1240)).toBe('1,240')
    expect(formatCounterValue('score', 4.567)).toBe('4.57')
  })

  it('prefers an action counter for Home cards', () => {
    const counters = [
      { name: 'places_found', value: 18 },
      { name: 'aiCostUsd', value: 0.1 },
      { name: 'messages_sent', value: 4 },
    ]
    expect(pickHeadlineCounter(counters)?.name).toBe('messages_sent')
    expect(pickHeadlineCounter(counters.slice(0, 2))?.name).toBe('places_found')
    expect(pickHeadlineCounter([{ name: 'cost_usd', value: 1 }])).toBeNull()
  })
})

describe('run result view', () => {
  it('builds a generic table with up to two short extra columns', () => {
    const items = [
      { title: 'Order 1', status: 'sent', phone: '+62 1', note: 'x'.repeat(60), total: 12 },
      { title: 'Order 2', status: 'failed', phone: '+62 2', total: 7 },
    ]
    const table = buildItemTable(items)
    expect(table?.columns).toEqual(['Name', 'Phone', 'Total', 'Status'])
    expect(table?.rows[0]).toMatchObject({ cells: ['Order 1', '+62 1', '12'], status: 'Sent', statusTone: 'ok' })
    expect(table?.rows[1].statusTone).toBe('danger')
    expect(table?.moreLabel).toBeNull()
    expect(buildItemTable([])).toBeNull()
  })

  it('lists at most ten items and counts the rest', () => {
    const items = Array.from({ length: 13 }, (_, index) => ({ name: `Place ${index + 1}` }))
    const table = buildItemTable(items)
    expect(table?.rows).toHaveLength(10)
    expect(table?.rows[0].status).toBe('Done')
    expect(table?.moreLabel).toBe('3 more')
  })

  it('turns a summary into tiles, activity and reply', () => {
    const view = buildRunResultView(
      buildSummary({
        headline: 'Sent 2 of 3 offers.',
        counters: [
          { name: 'places_found', value: 3 },
          { name: 'messages_sent', value: 2 },
        ],
        usage: { promptTokens: 1000, completionTokens: 240, totalTokens: 1240 },
        steps: { succeeded: 6, failed: 0, skipped: 1 },
        approvals: { approved: 2, skipped: 1, waiting: 0 },
      }),
    )
    expect(view.stats).toEqual([
      { label: 'Places found', value: '3' },
      { label: 'Messages sent', value: '2' },
      { label: 'Time', value: '41s' },
      { label: 'AI tokens', value: '1,240' },
    ])
    expect(view.activity).toBe('6 steps done · 1 skipped · You approved 2, skipped 1')
    expect(view.builderReply).toBe('Sent 2 of 3 offers.')
    expect(view.placesFound).toBe(3)
    expect(view.table).toBeNull()
  })

  it('describes runs without a headline by status', () => {
    expect(buildRunResultView(buildSummary({ status: 'paused', durationMs: null })).builderReply).toBe('The run is waiting for you')
    expect(buildRunResultView(buildSummary({ status: 'failed', errorMessage: 'boom', headline: 'ignored' })).builderReply).toBe('The run did not finish: boom')
    expect(buildRunResultView(buildSummary({})).activity).toBeNull()
    expect(buildRunResultView(null).table?.moreLabel).toBe('15 more places')
  })

  it('formats durations and status tones', () => {
    expect(formatDurationMs(9_400)).toBe('9s')
    expect(formatDurationMs(125_000)).toBe('2m 05s')
    expect(formatDurationMs(2 * 3_600_000 + 7 * 60_000)).toBe('2h 07m')
    expect(toneForItemStatus('Skipped')).toBe('neutral')
  })
})

describe('home view model', () => {
  const stats: AgentRunStats = {
    agentId: 'agent-1',
    runsThisWeek: 3,
    succeeded: 2,
    failed: 1,
    paused: 0,
    lastRunStatus: 'failed',
    lastRunAt: new Date('2026-11-18T09:00:00').toISOString(),
    counters: [{ name: 'messages_sent', value: 47 }],
  }

  it('describes an agent card from its weekly stats', () => {
    expect(describeAgentRunStats(stats, now)).toEqual([{ count: 47, label: 'messages sent this week' }, { label: 'Last run failed · Today 09:00' }])
    expect(describeAgentRunStats({ ...stats, counters: [] }, now)[0]).toEqual({ count: 3, label: 'runs this week' })
    expect(describeAgentRunStats({ ...stats, runsThisWeek: 0, counters: [], lastRunStatus: null, lastRunAt: null }, now)).toEqual([{ label: 'No runs yet' }])
    expect(describeAgentRunStats(undefined, now)).toEqual([])
  })

  it('lists paused runs linking to the run', () => {
    const pausedRun = buildRun({ id: 'run-9', status: 'paused', pauseReasons: [{ node_id: 'ask', kind: 'human_input', data: { prompt: 'Send this?' } }] })
    const [item] = buildPausedRunItems([pausedRun], agentName, now)
    expect(item).toMatchObject({
      title: 'Cafe offers is waiting for you',
      detail: 'Send this? · Today 09:00 run · paused for your review',
      actionLabel: 'Review',
      actionPath: agentPath('testRun', 'agent-1', { runId: 'run-9' }),
      isPrimaryAction: true,
    })
  })

  it('uses the summary headline as the recent run result', () => {
    const rows = buildRecentRunRows(
      [
        buildRun({ id: 'a', outputs: { summary: 'Sent 4 offers.' } }),
        buildRun({ id: 'b', status: 'failed', errorMessage: 'Maps key missing' }),
        buildRun({ id: 'c', status: 'running' }),
      ],
      agentName,
      now,
    )
    expect(rows.map((row) => [row.agentName, row.startedAt, row.resultSummary, row.status])).toEqual([
      ['Cafe offers', 'Today 09:00', 'Sent 4 offers.', 'Done'],
      ['Cafe offers', 'Today 09:00', 'Maps key missing', 'Failed'],
      ['Cafe offers', 'Today 09:00', 'Still running', 'Running'],
    ])
  })
})
