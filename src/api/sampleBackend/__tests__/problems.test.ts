import { BackendError } from '../../client'
import type { ProblemAction } from '../../problemTypes'
import { getProblemActionPath } from '@/pages/error-states/problemActions'
import { resetSampleProblems, sampleFailedRunId, sampleProblemsBackend } from '../problems'
import { resetSampleScheduleRules, sampleScheduleRulesBackend } from '../scheduleRules'

describe('sample problems backend', () => {
  beforeEach(() => resetSampleProblems())

  it('lists the design problems with the failed run first', async () => {
    const problems = await sampleProblemsBackend.listProblems()
    expect(problems[0]).toMatchObject({ kind: 'failed_run', runId: sampleFailedRunId })
    expect(problems.map((problem) => problem.title)).toContain('WhatsApp was logged out')
  })

  it('explains the sample failed run and says retries start over', async () => {
    const report = await sampleProblemsBackend.getFailedRunReport(sampleFailedRunId)
    expect(report.failedStepId).toBe('read_emails')
    expect(report.technicalDetails).toContain('a retry starts a new run')
    await expect(sampleProblemsBackend.getFailedRunReport('nope')).rejects.toBeInstanceOf(BackendError)
  })

  it('retries as a new manual run', async () => {
    const run = await sampleProblemsBackend.retryRun(sampleFailedRunId)
    expect(run).toMatchObject({ id: 'sample-retry-1', trigger: 'manual', status: 'running' })
  })
})

describe('sample schedule rules backend', () => {
  beforeEach(() => resetSampleScheduleRules())

  it('stores the limit and rejects out-of-range values', async () => {
    expect(await sampleScheduleRulesBackend.getScheduleRules()).toEqual({ maxConcurrentRuns: 2 })
    await sampleScheduleRulesBackend.updateScheduleRules({ maxConcurrentRuns: 1 })
    expect(await sampleScheduleRulesBackend.getScheduleRules()).toEqual({ maxConcurrentRuns: 1 })
    await expect(sampleScheduleRulesBackend.updateScheduleRules({ maxConcurrentRuns: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('lists scheduled runs inside the window only', async () => {
    const runs = await sampleScheduleRulesBackend.listScheduledRuns('2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z')
    expect(runs.map((run) => run.id)).toEqual(['morning-digest-yesterday', 'maps-leads-tuesday'])
    await expect(sampleScheduleRulesBackend.listScheduledRuns('2026-11-18T00:00:00Z', '2026-11-17T00:00:00Z')).rejects.toBeInstanceOf(BackendError)
  })
})

describe('getProblemActionPath', () => {
  const baseAction: ProblemAction = { kind: 'open_run', label: 'Open', agentId: 'agent-1', runId: 'run-1' }

  it('maps navigation actions to routes and commands to none', () => {
    expect(getProblemActionPath(baseAction)).toBe('/runs/problems?runId=run-1')
    expect(getProblemActionPath({ ...baseAction, kind: 'open_connections' })).toBe('/connections')
    expect(getProblemActionPath({ ...baseAction, kind: 'open_plugins' })).toBe('/connections?section=plugins')
    expect(getProblemActionPath({ ...baseAction, kind: 'open_builder' })).toBe('/agents/agent-1/steps')
    expect(getProblemActionPath({ ...baseAction, kind: 'open_schedule' })).toBe('/agents/agent-1/schedule')
    expect(getProblemActionPath({ ...baseAction, kind: 'retry_run' })).toBeNull()
    expect(getProblemActionPath({ ...baseAction, kind: 'install_browser' })).toBeNull()
  })
})
