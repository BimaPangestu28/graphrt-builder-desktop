import { conflictLatestVersion, invalidGraphProblems } from '../agentGraph'
import { BackendError, isBackendErrorWithCode, parseBackendErrorDetails } from '../client'

describe('parseBackendErrorDetails', () => {
  it('keeps well-formed version_conflict details', () => {
    expect(parseBackendErrorDetails('version_conflict', { baseVersion: 2, latestVersion: 3 })).toEqual({ baseVersion: 2, latestVersion: 3 })
  })

  it('drops version_conflict details with the wrong shape', () => {
    expect(parseBackendErrorDetails('version_conflict', { latestVersion: '3' })).toBeNull()
  })

  it('keeps invalid_graph problems', () => {
    const problems = [{ code: 'dangling_edge', message: 'Edge goes nowhere', nodeId: null }]
    expect(parseBackendErrorDetails('invalid_graph', { problems })).toEqual({ problems })
  })

  it('returns null for codes without details', () => {
    expect(parseBackendErrorDetails('not_found', { anything: true })).toBeNull()
    expect(parseBackendErrorDetails('builder_busy', undefined)).toBeNull()
  })
})

describe('isBackendErrorWithCode', () => {
  it('narrows to the matching code only', () => {
    const conflict = new BackendError('version_conflict', 'moved on', { baseVersion: 1, latestVersion: 4 })
    expect(isBackendErrorWithCode(conflict, 'version_conflict')).toBe(true)
    expect(isBackendErrorWithCode(conflict, 'invalid_graph')).toBe(false)
    expect(isBackendErrorWithCode(new Error('plain'), 'version_conflict')).toBe(false)
  })
})

describe('agent graph error readers', () => {
  it('reads the latest version of a conflict', () => {
    expect(conflictLatestVersion(new BackendError('version_conflict', 'moved on', { baseVersion: 1, latestVersion: 4 }))).toBe(4)
    expect(conflictLatestVersion(new BackendError('version_conflict', 'moved on'))).toBeNull()
    expect(conflictLatestVersion(new BackendError('not_found', 'gone'))).toBeNull()
  })

  it('reads the problems of an invalid graph', () => {
    expect(invalidGraphProblems(new BackendError('invalid_graph', 'bad'))).toEqual([])
    expect(invalidGraphProblems(new Error('other'))).toEqual([])
  })
})
