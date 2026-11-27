import { BackendError, toBackendError } from '@/api/client'
import { setLocale } from '@/i18n'
import { dictionaries } from '@/i18n/messages'
import { explainBackendError, explainErrorKind, pluginNameFromNodeType, type ErrorFamily } from '../errorHelp'

describe('explainErrorKind', () => {
  it.each<[string, ErrorFamily, string | null]>([
    ['invalid_input', 'invalidInput', null],
    ['setup_required', 'setupRequired', 'pluginSettings'],
    ['permission_denied', 'permissionDenied', 'pluginSettings'],
    ['not_found', 'notFound', 'pluginSettings'],
    ['timeout', 'timedOut', null],
    ['cancelled', 'cancelled', null],
    ['rate_limited', 'rateLimited', null],
    ['auth_error', 'signInRejected', 'pluginSettings'],
    ['api_error', 'serviceProblem', null],
    ['upstream_error', 'serviceProblem', null],
    ['network_error', 'unreachable', null],
    ['conflict', 'alreadyExists', null],
    ['plugin_error', 'pluginProblem', 'pluginPage'],
    ['plugin_exception', 'pluginProblem', 'pluginPage'],
    ['plugin_crashed', 'pluginStopped', 'pluginPage'],
    ['plugin_start', 'pluginStopped', 'pluginPage'],
    ['plugin_protocol', 'pluginMismatch', 'pluginPage'],
    ['model_auth', 'modelSignInRejected', 'connections'],
    ['model_rate_limit', 'rateLimited', null],
    ['model_context_length', 'modelTextTooLong', 'connections'],
    ['egress_blocked', 'addressNotAllowed', null],
    ['limit_exceeded', 'runLimit', null],
    ['missing_credentials', 'missingKey', 'connections'],
  ])('explains %s as %s', (kind, family, remedy) => {
    const help = explainErrorKind(kind)
    expect(help).toMatchObject({ family, remedy })
    expect(help?.headline).toBe(dictionaries.en.errorHelp.families[family].headline)
  })

  it('knows nothing of a kind it was not told about, or of no kind', () => {
    expect(explainErrorKind('something_new')).toBeNull()
    expect(explainErrorKind('')).toBeNull()
    expect(explainErrorKind(null)).toBeNull()
    expect(explainErrorKind(undefined)).toBeNull()
    // Inherited object keys are not kinds.
    expect(explainErrorKind('toString')).toBeNull()
  })

  it('speaks the app language, and Indonesian differs from English for every family', () => {
    setLocale('id')
    expect(explainErrorKind('setup_required')).toMatchObject({
      headline: 'Plugin ini belum selesai disiapkan',
      nextStep: expect.stringContaining('Buka pengaturan plugin'),
    })
    for (const family of Object.keys(dictionaries.en.errorHelp.families) as ErrorFamily[]) {
      expect(dictionaries.id.errorHelp.families[family].headline, family).not.toBe(dictionaries.en.errorHelp.families[family].headline)
    }
  })
})

describe('pluginNameFromNodeType', () => {
  it('reads the plugin of a plugin step and nothing for built-in steps', () => {
    expect(pluginNameFromNodeType('document-templates.render_pdf')).toBe('document-templates')
    expect(pluginNameFromNodeType('whatsapp-web.send_message')).toBe('whatsapp-web')
    expect(pluginNameFromNodeType('llm')).toBeNull()
    expect(pluginNameFromNodeType('.odd')).toBeNull()
    expect(pluginNameFromNodeType('Not A Plugin.step')).toBeNull()
    expect(pluginNameFromNodeType(null)).toBeNull()
  })
})

describe('explainBackendError', () => {
  it('explains a failed plugin step by the kind the plugin reported, keeping its message', () => {
    const error = toBackendError({ code: 'plugin_step_failed', message: 'DOCUMENT_TEMPLATES_OUTPUT_DIR is not set', details: { kind: 'setup_required' } })
    expect(error.message).toBe('DOCUMENT_TEMPLATES_OUTPUT_DIR is not set')
    expect(explainBackendError(error)?.family).toBe('setupRequired')
  })

  it('explains backend codes that are error kinds', () => {
    expect(explainBackendError(new BackendError('invalid_input', 'invalid input: the folder does not exist'))?.family).toBe('invalidInput')
    expect(explainBackendError(new BackendError('missing_credentials', 'not set up yet: OPENAI_API_KEY'))?.family).toBe('missingKey')
    expect(explainBackendError(new BackendError('workflow', 'workflow error: unknown node'))?.family).toBe('agentSteps')
  })

  it('reads a download that failed as an unreachable service, other internal errors not at all', () => {
    expect(explainBackendError(new BackendError('internal', 'download failed: error sending request for url'))?.family).toBe('unreachable')
    expect(explainBackendError(new BackendError('internal', 'could not write /tmp/x: disk full'))).toBeNull()
  })

  it('leaves errors that are already in plain words, and values that are no backend error', () => {
    expect(explainBackendError(new BackendError('missing_plugins', 'this agent needs plugins that are not installed: Email'))).toBeNull()
    expect(explainBackendError(new BackendError('credential_store_unavailable', 'locked'))).toBeNull()
    expect(explainBackendError(new BackendError('plugin_step_failed', 'no kind'))).toBeNull()
    expect(explainBackendError(new Error('invalid_input'))).toBeNull()
    expect(explainBackendError('setup_required')).toBeNull()
  })
})
