import type { Run, Trigger } from '@/api/types'
import { getRunHistoryWindow, toPastRuns } from '@/pages/scheduler/schedulerViewModel'

function buildTrigger(id: string, agentId: string): Trigger {
  return {
    id,
    agentId,
    cronExpression: '0 0 7 * * *',
    timezone: 'Asia/Jakarta',
    enabled: true,
    missedRunPolicy: 'run_once',
    inputs: {},
    lastFiredAt: null,
    nextFireAt: null,
    createdAt: '2026-11-01T00:00:00Z',
  }
}

function buildRun(id: string, agentId: string, startedAt: string, status: Run['status'], outputs: Run['outputs'] = null): Run {
  return { id, agentId, agentVersion: 1, trigger: 'schedule', status, startedAt, finishedAt: null, outputs, errorMessage: null, pauseReasons: null }
}

describe('toPastRuns', () => {
  const triggers = [buildTrigger('trigger-a', 'agent-a')]

  it('places runs on their agent trigger, on the local day they started', () => {
    // 23:30 UTC on the 16th is 06:30 on the 17th in Jakarta.
    const runs = [buildRun('run-1', 'agent-a', '2026-11-16T23:30:00Z', 'succeeded', { messages_sent: 3 })]
    expect(toPastRuns(runs, triggers, 'Asia/Jakarta')).toEqual([
      { triggerId: 'trigger-a', runId: 'run-1', date: '2026-11-17', outcome: 'done', summary: '3 sent' },
    ])
  })

  it('maps every status to an outcome and drops runs of agents without a trigger', () => {
    const runs = [
      buildRun('failed', 'agent-a', '2026-11-17T00:00:00Z', 'failed'),
      buildRun('aborted', 'agent-a', '2026-11-17T00:00:00Z', 'aborted'),
      buildRun('paused', 'agent-a', '2026-11-17T00:00:00Z', 'paused'),
      buildRun('running', 'agent-a', '2026-11-17T00:00:00Z', 'running'),
      buildRun('orphan', 'agent-gone', '2026-11-17T00:00:00Z', 'failed'),
    ]
    const pastRuns = toPastRuns(runs, triggers, 'UTC')
    expect(pastRuns.map((pastRun) => [pastRun.runId, pastRun.outcome, pastRun.summary])).toEqual([
      ['failed', 'failed', 'Failed'],
      ['aborted', 'failed', 'Stopped'],
      ['paused', 'needsYou', 'Needs you'],
      ['running', 'running', 'Running'],
    ])
  })
})

describe('getRunHistoryWindow', () => {
  it('covers the dates with a day of margin on each side', () => {
    expect(getRunHistoryWindow(['2026-11-16', '2026-11-22'])).toEqual({ since: '2026-11-15T00:00:00.000Z', until: '2026-11-24T00:00:00.000Z' })
  })
})
