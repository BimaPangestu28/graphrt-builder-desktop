import type { RunRecord } from './runRecordTypes'
import { chooseRunsEmptyState, summarizeRunsToday, type RunsEmptyStateInput } from './runsOverview'

const noRows: RunsEmptyStateInput = {
  visibleRunCount: 0,
  localRunCount: 0,
  onlineRunCount: 0,
  agentCount: 0,
  placeFilter: 'all',
  hasAgentOrStatusFilter: false,
}

describe('chooseRunsEmptyState', () => {
  it('shows the table when there are rows', () => {
    expect(chooseRunsEmptyState({ ...noRows, visibleRunCount: 3, localRunCount: 3 })).toBeNull()
  })

  it('waits for the local runs', () => {
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: null })).toBe('loading')
  })

  it('waits for online runs and agents before saying nothing ran', () => {
    expect(chooseRunsEmptyState({ ...noRows, onlineRunCount: null })).toBe('loading')
    expect(chooseRunsEmptyState({ ...noRows, agentCount: null })).toBe('loading')
  })

  it('offers a new agent when there is no agent yet', () => {
    expect(chooseRunsEmptyState(noRows)).toBe('noAgents')
  })

  it('says no runs yet when agents exist but none ran', () => {
    expect(chooseRunsEmptyState({ ...noRows, agentCount: 2 })).toBe('noRunsYet')
  })

  it('says no online runs on the Online filter without other filters', () => {
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 4, agentCount: 2, placeFilter: 'online' })).toBe('noOnlineRuns')
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 4, onlineRunCount: null, placeFilter: 'online' })).toBe('loading')
  })

  it('offers to clear filters when runs exist but none match', () => {
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 4, agentCount: 2, hasAgentOrStatusFilter: true })).toBe('noMatch')
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 4, onlineRunCount: 2, placeFilter: 'online', hasAgentOrStatusFilter: true })).toBe('noMatch')
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 0, onlineRunCount: 2, placeFilter: 'local', agentCount: 1 })).toBe('noMatch')
  })

  it('does not call a filtered list empty while online runs are still loading if local runs exist', () => {
    expect(chooseRunsEmptyState({ ...noRows, localRunCount: 4, onlineRunCount: null, agentCount: null, hasAgentOrStatusFilter: true })).toBe('noMatch')
  })
})

function record(id: string, status: RunRecord['status'], startedAt?: string): RunRecord {
  return { id, agentName: 'Agent', startedBy: 'You', when: '', result: '', status, timing: '', steps: [], output: '', rawLog: [], startedAt }
}

describe('summarizeRunsToday', () => {
  const now = new Date(2026, 10, 26, 14, 0)
  const today = new Date(2026, 10, 26, 9, 30).toISOString()
  const yesterday = new Date(2026, 10, 25, 9, 30).toISOString()

  it('counts runs started today by status', () => {
    const summary = summarizeRunsToday(
      [record('a', 'done', today), record('b', 'failed', today), record('c', 'running', today), record('d', 'done', yesterday), record('e', 'failed', yesterday)],
      now,
    )
    expect(summary).toEqual({ started: 3, done: 1, failed: 1, needsYou: 0 })
  })

  it('counts every run waiting for the user, whatever day it started', () => {
    expect(summarizeRunsToday([record('a', 'needsYou', yesterday), record('b', 'needsYou', today), record('c', 'needsYou')], now)).toEqual({
      started: 1,
      done: 0,
      failed: 0,
      needsYou: 3,
    })
  })

  it('skips runs without a readable start time', () => {
    expect(summarizeRunsToday([record('a', 'done'), record('b', 'done', 'not a date')], now)).toEqual({ started: 0, done: 0, failed: 0, needsYou: 0 })
  })
})
