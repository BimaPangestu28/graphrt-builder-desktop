import type { Run, RunEventRecord } from '@/api/types'
import { readPendingApprovals } from '@/api/pauseReasons'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { toRunFilter, toRunRecord } from '@/pages/runs/runViewModel'
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
})

describe('scheduler mapping', () => {
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
    )
    expect(scheduleTrigger).toMatchObject({ shortName: 'Maps leads', description: 'Weekdays at 09:00', recurrence: { hour: 9, weekdays: [1, 2, 3, 4, 5] } })
  })
})
