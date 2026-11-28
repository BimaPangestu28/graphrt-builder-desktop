import { conflictLatestVersion, invalidGraphProblems } from '../agentGraph'
import { setLocale } from '@/i18n'
import { BackendError, isBackendErrorWithCode, parseBackendErrorDetails, toBackendError } from '../client'

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

describe('deploy_failed details', () => {
  it('keeps a provider refusal with its fix and drops what it cannot read', () => {
    const raw = { code: 'deploy_failed', message: 'Project acme has no billing account', details: { provider: 'google_cloud', kind: 'billing_disabled', message: 'Project acme has no billing account', technical: 'HTTP 403', project: 'acme', service: null, role: null, fix: { kind: 'open_page', url: 'https://console.cloud.google.com/billing/linkedaccount?project=acme' } } }
    const error = toBackendError(raw)
    expect(isBackendErrorWithCode(error, 'deploy_failed') && error.details).toEqual({ ...raw.details })
    const signIn = toBackendError({ ...raw, details: { ...raw.details, kind: 'unauthorized', fix: { kind: 'sign_in_again' } } })
    expect(isBackendErrorWithCode(signIn, 'deploy_failed') && signIn.details?.fix).toEqual({ kind: 'sign_in_again' })
    expect(parseBackendErrorDetails('deploy_failed', { ...raw.details, fix: { kind: 'open_page' } })).toMatchObject({ fix: null })
    expect(parseBackendErrorDetails('deploy_failed', { kind: 'x', message: 'y' })).toBeNull()
    expect(parseBackendErrorDetails('deploy_failed', { ...raw.details, provider: 'aws', fix: { kind: 'connect_again', provider: 'aws' } })).toMatchObject({ provider: 'aws', fix: { kind: 'connect_again', provider: 'aws' } })
  })
})

describe('toBackendError', () => {
  afterEach(() => setLocale('en'))

  it('keeps the code and message of a backend error', () => {
    const error = toBackendError({ code: 'not_found', message: 'agent not found' })
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('agent not found')
  })

  it('reports anything else as an internal error', () => {
    expect(toBackendError('boom')).toMatchObject({ code: 'internal', message: 'boom' })
  })

  it('explains an unusable system keyring in the language of the app', () => {
    const rawError = { code: 'credential_store_unavailable', message: 'English text from the backend', details: { reason: 'no_default_keyring' } }

    setLocale('en')
    expect(toBackendError(rawError).message).toContain('no default password keyring yet')
    expect(toBackendError(rawError).message).toContain('"Passwords and Keys"')

    setLocale('id')
    const indonesian = toBackendError(rawError)
    expect(indonesian.message).toContain('belum punya keyring kata sandi default')
    expect(indonesian.details).toEqual({ reason: 'no_default_keyring' })
  })

  it('names each keyring problem differently', () => {
    const messageFor = (reason: string) => toBackendError({ code: 'credential_store_unavailable', message: 'fallback', details: { reason } }).message
    expect(messageFor('not_running')).toContain('no password keyring running')
    expect(messageFor('locked')).toContain('is locked')
  })

  it('says in the language of the app that nothing changed when the online copy could not go back', () => {
    const rawError = { code: 'online_switch_failed', message: 'English text from the backend', details: { releaseNumber: 1, inUseNumber: 2 } }
    setLocale('en')
    const error = toBackendError(rawError)
    expect(error.details).toEqual({ releaseNumber: 1, inUseNumber: 2 })
    expect(error.message).toBe(
      'The online copy could not go back to release 1, so nothing changed: release 2 stays in use here and online. Try again in a few minutes.',
    )
    setLocale('id')
    expect(toBackendError(rawError).message).toContain('tidak ada yang berubah. Rilis 2 tetap dipakai di sini dan online')
    expect(toBackendError({ ...rawError, details: { releaseNumber: 'one' } }).message).toBe('English text from the backend')
  })

  it('falls back to the backend wording for a keyring problem it does not know', () => {
    const error = toBackendError({ code: 'credential_store_unavailable', message: 'The keyring is on holiday.', details: { reason: 'on_holiday' } })
    expect(error.message).toBe('The keyring is on holiday.')
    expect(error.details).toBeNull()
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
