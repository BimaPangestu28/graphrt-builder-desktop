import { applyDeployEvent, currentDeployStep, deployProgressPercent, describeCliNeed, describeDeploymentStatus, describeTimeAgo, plainErrorMessage } from '../deployDisplay'
import { mergeRunsByPlace, toOnlineRunRecord, toPlaceFilter } from '@/pages/runs/onlineRuns'

describe('deploy progress', () => {
  it('moves the bar per step and names the running one', () => {
    let states = {}
    expect(deployProgressPercent(states)).toBe(0)
    states = applyDeployEvent(states, { kind: 'step', agentId: 'a', step: 'preparing', status: 'done', message: null })
    states = applyDeployEvent(states, { kind: 'step', agentId: 'a', step: 'secrets', status: 'running', message: null })
    states = applyDeployEvent(states, { kind: 'log', agentId: 'a', line: 'ignored' })
    expect(deployProgressPercent(states)).toBe(38)
    expect(currentDeployStep(states)).toBe('secrets')
  })
})

describe('plain words', () => {
  it('describes statuses, the tools and times without technical terms', () => {
    expect(describeDeploymentStatus('needs_attention').label).toBe('needs attention')
    expect(describeCliNeed({ status: 'not_installed', version: '0.9.0', downloadSizeBytes: 9_400_000 })).toContain('download ~9 MB')
    expect(describeCliNeed({ status: 'not_available', version: null, downloadSizeBytes: null })).toMatch(/not available yet.*graphrt deploy --direct.*server image/)
    const now = new Date('2026-11-24T12:00:00Z')
    expect(describeTimeAgo('2026-11-24T10:00:00Z', now)).toBe('2 hours ago')
    expect(describeTimeAgo(null, now)).toBe('not yet')
    expect(plainErrorMessage(new Error('invalid input: paste your key'))).toBe('Paste your key')
  })
})

describe('online runs', () => {
  const onlineRun = { agentId: 'a1', sourceName: 'Menu chatbot', place: 'Fly.io', run: { id: 'r1', workflow: 'menu', status: 'failed', startedAt: '2026-11-24T09:12:00Z', finishedAt: '2026-11-24T09:12:05Z', error: 'The AI service was busy' } }

  it('maps a cloud run to an Online row', () => {
    const record = toOnlineRunRecord(onlineRun, new Date('2026-11-24T12:00:00Z'))
    expect(record).toMatchObject({ place: 'online', status: 'failed', result: 'The AI service was busy', agentName: 'Menu chatbot' })
    expect(record.timing).toContain('ran online on Fly.io')
  })

  it('filters by place and merges newest first', () => {
    const local = { id: 'l', agentName: 'x', startedBy: 'You', when: '', result: '', status: 'done' as const, timing: '', steps: [], output: '', rawLog: [], startedAt: '2026-11-24T10:00:00Z', place: 'local' as const }
    const online = toOnlineRunRecord(onlineRun)
    expect(mergeRunsByPlace([local], [online], 'all').map((record) => record.id)).toEqual(['l', online.id])
    expect(mergeRunsByPlace([local], [online], 'online')).toEqual([online])
    expect(toPlaceFilter('online')).toBe('online')
    expect(toPlaceFilter('elsewhere')).toBe('all')
  })
})
