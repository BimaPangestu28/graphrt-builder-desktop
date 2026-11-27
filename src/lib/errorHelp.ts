import { BackendError, isBackendErrorWithCode } from '@/api/client'
import { messages, type Messages } from '@/i18n'

/**
 * Plain words for an error kind: plugins and graphrt report a stable kind (`invalid_input`,
 * `setup_required`, `auth_error`…) with an English message. The kind picks a short sentence in
 * the app's language and what to do next; the original message stays on screen underneath
 * (see `ErrorHelpNotice`), because only it says which value, file or setting is meant.
 *
 * Kinds come from the plugin SDK (`shared/lib` of graphrt-plugins: `PluginError` kinds and the
 * REST client's), the plugin host (`plugin_crashed`, `plugin_start`…), the model providers
 * (`model_auth`, `model_rate_limit`…) and the engine (`limit_exceeded`, `egress_blocked`…).
 */

export type ErrorFamily = keyof Messages['errorHelp']['families']

/** Where the button under the explanation goes. */
export type ErrorRemedy = 'pluginSettings' | 'pluginPage' | 'connections'

export interface ErrorHelp {
  family: ErrorFamily
  /** One short sentence: what went wrong, in the app's language. */
  headline: string
  /** What the person can do about it. */
  nextStep: string
  /** The page that fixes it, when there is one. */
  remedy: ErrorRemedy | null
}

const familyByKind: Readonly<Record<string, ErrorFamily>> = {
  invalid_input: 'invalidInput',
  type_mismatch: 'invalidInput',
  setup_required: 'setupRequired',
  missing_credentials: 'missingKey',
  secret: 'missingKey',
  permission_denied: 'permissionDenied',
  not_found: 'notFound',
  timeout: 'timedOut',
  lock_timeout: 'timedOut',
  cancelled: 'cancelled',
  rate_limited: 'rateLimited',
  model_rate_limit: 'rateLimited',
  auth_error: 'signInRejected',
  auth: 'signInRejected',
  model_auth: 'modelSignInRejected',
  api_error: 'serviceProblem',
  upstream_error: 'serviceProblem',
  http_status: 'serviceProblem',
  model_server: 'serviceProblem',
  network_error: 'unreachable',
  plugin_transport: 'unreachable',
  model_network: 'unreachable',
  http: 'unreachable',
  http_client: 'unreachable',
  conflict: 'alreadyExists',
  already_exists: 'alreadyExists',
  plugin_error: 'pluginProblem',
  plugin_exception: 'pluginProblem',
  browser_error: 'pluginProblem',
  storage_error: 'pluginProblem',
  database_error: 'pluginProblem',
  plugin_crashed: 'pluginStopped',
  plugin_start: 'pluginStopped',
  plugin_closed: 'pluginStopped',
  plugin_protocol: 'pluginMismatch',
  invalid_output: 'pluginMismatch',
  unknown_tool: 'pluginMismatch',
  unknown_kind: 'pluginMismatch',
  message_too_large: 'pluginMismatch',
  model_context_length: 'modelTextTooLong',
  model_bad_request: 'modelRefused',
  model_config: 'modelRefused',
  model_decode: 'modelRefused',
  model: 'modelRefused',
  egress_blocked: 'addressNotAllowed',
  limit_exceeded: 'runLimit',
  blocked: 'websiteBlocked',
  workflow: 'agentSteps',
  graph: 'agentSteps',
  template: 'agentSteps',
}

const remedyByFamily: Readonly<Partial<Record<ErrorFamily, ErrorRemedy>>> = {
  setupRequired: 'pluginSettings',
  permissionDenied: 'pluginSettings',
  notFound: 'pluginSettings',
  signInRejected: 'pluginSettings',
  missingKey: 'connections',
  modelSignInRejected: 'connections',
  modelTextTooLong: 'connections',
  modelRefused: 'connections',
  pluginProblem: 'pluginPage',
  pluginStopped: 'pluginPage',
  pluginMismatch: 'pluginPage',
}

/** Families whose fix is on a plugin's page; without a known plugin they have no button. */
const pluginRemedies: readonly ErrorRemedy[] = ['pluginSettings', 'pluginPage']

/**
 * The plain explanation of an error kind, or null for a kind this app does not know (the
 * caller then shows the message as it is).
 *
 * @param kind - The error kind / `error_type` (string | null | undefined)
 * @returns Headline, next step and remedy in the current language (ErrorHelp | null)
 *
 * @example
 * explainErrorKind('setup_required')?.remedy // 'pluginSettings'
 * explainErrorKind('something_new') // null
 */
export function explainErrorKind(kind: string | null | undefined): ErrorHelp | null {
  if (!kind) return null
  const family = Object.hasOwn(familyByKind, kind) ? familyByKind[kind] : undefined
  if (!family) return null
  const { headline, nextStep } = messages().errorHelp.families[family]
  return { family, headline, nextStep, remedy: remedyByFamily[family] ?? null }
}

/**
 * The plugin a step belongs to: plugin steps are named `<plugin>.<operation>`
 * (`document-templates.render_pdf`); built-in steps have no dot.
 *
 * @example
 * pluginNameFromNodeType('document-templates.render_pdf') // 'document-templates'
 * pluginNameFromNodeType('llm') // null
 */
export function pluginNameFromNodeType(nodeType: string | null | undefined): string | null {
  if (!nodeType) return null
  const dot = nodeType.indexOf('.')
  if (dot <= 0) return null
  const plugin = nodeType.slice(0, dot)
  return /^[a-z0-9][a-z0-9_-]*$/.test(plugin) ? plugin : null
}

/** Whether `remedy` needs a plugin name to point anywhere. */
export function isPluginRemedy(remedy: ErrorRemedy): boolean {
  return pluginRemedies.includes(remedy)
}

/** Download and connection failures the backend reports as `internal` (plugin installs). */
const networkFailurePattern = /download failed|dns error|failed to lookup address|connection refused|error sending request|timed out|network is unreachable|connection reset/i

/** Backend codes that already arrive in plain, translated words (see `api/client.ts`). */
const alreadyPlainCodes: readonly string[] = ['credential_store_unavailable', 'draft_not_valid', 'needs_newer_app', 'missing_plugins', 'version_conflict', 'builder_busy', 'invalid_graph', 'stopped']

/** The error kind a backend error stands for: its code, a plugin step's own kind, or none. */
function backendErrorKind(error: BackendError): string | null {
  if (alreadyPlainCodes.includes(error.code)) return null
  if (isBackendErrorWithCode(error, 'plugin_step_failed')) return error.details?.kind ?? null
  if (error.code === 'internal') return networkFailurePattern.test(error.message) ? 'network_error' : null
  return error.code
}

/**
 * The plain explanation of anything a backend call rejected with, or null when it has none
 * (unknown codes, errors already in plain words, values that are not a {@link BackendError}).
 *
 * @example
 * explainBackendError(new BackendError('invalid_input', 'invalid input: amount must be a number'))?.family // 'invalidInput'
 */
export function explainBackendError(error: unknown): ErrorHelp | null {
  if (!(error instanceof BackendError)) return null
  return explainErrorKind(backendErrorKind(error))
}
