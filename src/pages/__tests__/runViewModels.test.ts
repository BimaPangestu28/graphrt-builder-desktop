import type { Run, RunEventRecord } from '@/api/types'
import { readPendingApprovals } from '@/api/pauseReasons'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { countRunsForFilter, toRunFilter, toRunRecord } from '@/pages/runs/runViewModel'
import { toScheduleTrigger } from '@/pages/scheduler/schedulerViewModel'

function buildEvent(seq: number, type: string, nodeId: string, fields: Record<string, unknown> = {}): RunEventRecord {
  return { runId: 'run-1', seq, event: { type, node_id: nodeId, ...fields }, createdAt: '2026-11-18T06:00:00Z' }
}

const baseRun: Run = {
  id: 'run-1',
  agentId: 'maps-leads',
  agentVersion: 1,
  trigger: 'test',
  status: 'paused',
  startedAt: '2026-11-18T06:00:00Z',
  finishedAt: null,
  outputs: null,
  errorMessage: null,
  pauseReasons: [{ node_id: 'approve', kind: 'human_input', data: { draft: 'Hello' } }],
}

describe('run progress', () => {
  it('lays events over the expected steps and leaves out nodes the summary does not list', () => {
    const steps = buildRunStepViews(
      [
        { id: 'search', label: 'Search' },
        { id: 'approve', label: 'Approve' },
        { id: 'send', label: 'Send' },
      ],
      [buildEvent(1, 'node_started', 'search'), buildEvent(2, 'node_succeeded', 'search', { duration_ms: 1200 }), buildEvent(3, 'node_paused', 'approve'), buildEvent(4, 'node_failed', 'extra_check')],
    )
    expect(steps.map((step) => [step.label, step.state, step.durationMs])).toEqual([
      ['Search', 'done', 1200],
      ['Approve', 'waiting', null],
      ['Send', 'pending', null],
    ])
  })

  it('reads the question from graphrt human-input pause data', () => {
    const run: Run = {
      ...baseRun,
      pauseReasons: [
        {
          frame: 'each[2]',
          node_id: 'approve',
          kind: 'human_input',
          data: {
            prompt: 'Approve [ITEM]?',
            fields: [{ name: 'note', label: 'Note', type: 'text', required: false, default: 'Hello' }],
            actions: [{ id: 'yes', title: 'Yes please' }, { id: 'no' }],
            timeout_ms: 60000,
          },
        },
        { frame: '', node_id: null, kind: 'external', data: null },
      ],
    }
    expect(readPendingApprovals(run)).toEqual([
      {
        id: 'each[2]/approve',
        kind: 'form',
        nodeId: 'approve',
        frame: 'each[2]',
        resumeKey: 'each[2]/approve',
        stepTitle: null,
        prompt: 'Approve [ITEM]?',
        fields: [{ name: 'note', label: 'Note', fieldType: 'text', required: false, defaultValue: 'Hello' }],
        actions: [
          { id: 'yes', title: 'Yes please' },
          { id: 'no', title: 'no' },
        ],
        timeoutMs: 60000,
        expiresAt: null,
        onTimeout: null,
        toolCall: null,
        container: { nodeId: 'each', nodeType: null, title: null, index: 2, total: null, finished: null, item: null },
      },
    ])
    expect(readPendingApprovals({ ...run, status: 'running' })).toEqual([])
    expect(readPendingApprovals(baseRun)[0]).toMatchObject({ resumeKey: 'approve', container: null, fields: [], actions: [] })
  })
})

describe('runs screen mapping', () => {
  it('maps filters to the backend RunFilter', () => {
    expect(toRunFilter('all', 'all')).toEqual({ agentId: undefined, status: undefined })
    expect(toRunFilter('maps-leads', 'needsYou')).toEqual({ agentId: 'maps-leads', status: 'paused' })
  })

  it('maps a paused test run to a row that continues the test', () => {
    const record = toRunRecord(baseRun, 'Maps leads to WhatsApp', new Date('2026-11-18T07:00:00Z'))
    expect(record).toMatchObject({ status: 'needsYou', startedBy: 'You', result: 'Waiting for you' })
    expect(record.followUp?.path).toBe('/agents/maps-leads/test?runId=run-1')
  })

  it('shows a stopped (aborted) run as a neutral "Stopped", not a failure', () => {
    const stoppedRun: Run = { ...baseRun, status: 'aborted', pauseReasons: null, finishedAt: '2026-11-18T06:01:00Z' }
    expect(toRunRecord(stoppedRun, 'Maps leads')).toMatchObject({ status: 'stopped', result: 'Stopped' })
    const failedRun: Run = { ...stoppedRun, status: 'failed', errorMessage: 'boom' }
    expect(toRunRecord(failedRun, 'Maps leads').status).toBe('failed')
    expect(countRunsForFilter([stoppedRun, failedRun, stoppedRun], 'failed')).toBe(1)
  })

  it('explains a failed run in plain words and keeps the raw error as the title', () => {
    const rawError =
      'connection: iteration item 0 failed: error sending request: client error (Connect): dns error: error resolving DNS: failed to lookup address information: nodename nor servname provided, or not known'
    const failedRun: Run = { ...baseRun, status: 'failed', pauseReasons: null, errorMessage: rawError }
    expect(toRunRecord(failedRun, 'Maps leads')).toMatchObject({ result: "Could not reach the server: that address doesn't exist", resultTitle: rawError })
  })

  it('shows what a paused run waits for', () => {
    const pausedRun: Run = { ...baseRun, pauseReasons: [{ node_id: 'approve', kind: 'human_input', data: { prompt: 'Send **this** to Kopi Kenangan?' } }] }
    expect(toRunRecord(pausedRun, 'Maps leads').result).toBe('Send **this** to Kopi Kenangan?')
  })

  it('says which day a run started: Today, Yesterday or the date', () => {
    const now = new Date(2026, 10, 19, 12, 0)
    const startedAt = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute).toISOString()
    expect(toRunRecord({ ...baseRun, startedAt: startedAt(19, 9, 56) }, 'Maps leads', now).when).toBe('Today 09:56')
    expect(toRunRecord({ ...baseRun, startedAt: startedAt(18, 18, 20) }, 'Maps leads', now).when).toBe('Yesterday 18:20')
    expect(toRunRecord({ ...baseRun, startedAt: startedAt(12, 9, 56) }, 'Maps leads', now).when).toBe('12 Nov 09:56')
  })
})

describe('scheduler mapping', () => {
  it('defaults the block name to the agent name', () => {
    const trigger = { id: 't2', agentId: 'x', cronExpression: '0 0 7 * * *', timezone: 'UTC', enabled: false, missedRunPolicy: 'run_once', inputs: {}, lastFiredAt: null, nextFireAt: null, createdAt: '2026-11-18T00:00:00Z' } as const
    expect(toScheduleTrigger(trigger, 'Digest').shortName).toBe('Digest')
  })

  it('turns a cron trigger into a calendar recurrence', () => {
    const scheduleTrigger = toScheduleTrigger(
      {
        id: 't1',
        agentId: 'maps-leads',
        cronExpression: '0 0 9 * * Mon-Fri',
        timezone: 'Asia/Jakarta',
        enabled: true,
        missedRunPolicy: 'run_once',
        inputs: {},
        lastFiredAt: null,
        nextFireAt: null,
        createdAt: '2026-11-18T00:00:00Z',
      },
      'Maps leads to WhatsApp',
      'Maps leads',
    )
    expect(scheduleTrigger).toMatchObject({ shortName: 'Maps leads', description: 'Weekdays at 09:00', recurrence: { hour: 9, weekdays: [1, 2, 3, 4, 5] } })
  })
})
