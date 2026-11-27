import { messages } from '@/i18n'
import { genericErrorMessage } from '@/lib/errors'
import type { GraphProblem } from './agentGraphTypes'
import type { BackendErrorCode } from './types'

/**
 * Low-level bridge to the Rust backend.
 *
 * In the desktop app every call goes through Tauri `invoke`. In the browser
 * (`pnpm dev`) and in tests there is no backend, so feature modules fall back to
 * sample data: they check `__SAMPLE_BACKEND__ && !isDesktopApp()` and return mocks
 * instead. `__SAMPLE_BACKEND__` is a build-time constant (see vite.config.ts), false in
 * the production desktop build, so the sample backend is not shipped there.
 */

/** True inside the Tauri window; false in a plain browser or jsdom. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** `version_conflict`: the edit was made on `baseVersion`, the agent is at `latestVersion` now. */
export interface VersionConflictDetails {
  baseVersion: number
  latestVersion: number
}

/** `invalid_graph`: the blocking problems of the edited graph. */
export interface InvalidGraphDetails {
  problems: GraphProblem[]
}

/** Why the system keyring cannot be used (the backend's `CredentialStoreProblem`). */
export type CredentialStoreProblemReason = 'no_default_keyring' | 'not_running' | 'locked'

const credentialStoreProblemReasons: readonly string[] = ['no_default_keyring', 'not_running', 'locked'] satisfies CredentialStoreProblemReason[]

/** `credential_store_unavailable`: what is wrong with the system keyring. */
export interface CredentialStoreUnavailableDetails {
  reason: CredentialStoreProblemReason
}

/** `needs_newer_app`: the plugin needs a newer version of the app; nothing was installed. */
export interface NeedsNewerAppDetails {
  /** The oldest app version that can use the plugin, or null when only "a newer one" is known. */
  minVersion: string | null
  /** The version of the app that refused. */
  appVersion: string | null
}

/** `draft_not_valid`: the last technical problem of the draft, for a "details" line. */
export interface DraftNotValidDetails {
  problem: string
}

/** `plugin_step_failed`: the error kind the plugin reported (`setup_required`, `auth_error`…). */
export interface PluginStepFailedDetails {
  kind: string
}

/** Structured data per error code; codes not listed carry none. */
export interface BackendErrorDetailsByCode {
  credential_store_unavailable: CredentialStoreUnavailableDetails
  version_conflict: VersionConflictDetails
  invalid_graph: InvalidGraphDetails
  builder_busy: null
  needs_newer_app: NeedsNewerAppDetails
  draft_not_valid: DraftNotValidDetails
  plugin_step_failed: PluginStepFailedDetails
}

/** The details a code carries: its entry in {@link BackendErrorDetailsByCode}, else null. */
export type BackendErrorDetails<Code extends BackendErrorCode = BackendErrorCode> = Code extends keyof BackendErrorDetailsByCode
  ? BackendErrorDetailsByCode[Code] | null
  : null

/**
 * Error thrown by {@link callBackend} with the backend's stable code.
 *
 * `details` is typed by `code` (see {@link BackendErrorDetailsByCode}); narrow with
 * {@link isBackendErrorWithCode} to read it. It is null when the backend sent none
 * or sent a shape this version of the app does not understand.
 */
export class BackendError<Code extends BackendErrorCode = BackendErrorCode> extends Error {
  readonly code: Code
  readonly details: BackendErrorDetails<Code>

  constructor(code: Code, message: string, details?: BackendErrorDetails<Code>) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.details = (details ?? null) as BackendErrorDetails<Code>
  }
}

/**
 * Whether `error` is a {@link BackendError} with `code`, narrowing its `details`.
 *
 * @example
 * if (isBackendErrorWithCode(error, 'version_conflict')) error.details?.latestVersion
 */
export function isBackendErrorWithCode<Code extends BackendErrorCode>(error: unknown, code: Code): error is BackendError<Code> {
  return error instanceof BackendError && error.code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Keeps the details of the codes that carry any, when they have the expected shape. */
export function parseBackendErrorDetails(code: BackendErrorCode, rawDetails: unknown): BackendErrorDetails {
  if (!isRecord(rawDetails)) return null
  if (code === 'version_conflict') {
    const { baseVersion, latestVersion } = rawDetails
    return typeof baseVersion === 'number' && typeof latestVersion === 'number' ? { baseVersion, latestVersion } : null
  }
  if (code === 'invalid_graph') {
    return Array.isArray(rawDetails.problems) ? { problems: rawDetails.problems as GraphProblem[] } : null
  }
  if (code === 'credential_store_unavailable') {
    const { reason } = rawDetails
    return typeof reason === 'string' && credentialStoreProblemReasons.includes(reason) ? { reason: reason as CredentialStoreProblemReason } : null
  }
  if (code === 'draft_not_valid') {
    return typeof rawDetails.problem === 'string' ? { problem: rawDetails.problem } : null
  }
  if (code === 'plugin_step_failed') {
    return typeof rawDetails.kind === 'string' && rawDetails.kind ? { kind: rawDetails.kind } : null
  }
  if (code === 'needs_newer_app') {
    const { minVersion, appVersion } = rawDetails
    return { minVersion: typeof minVersion === 'string' ? minVersion : null, appVersion: typeof appVersion === 'string' ? appVersion : null }
  }
  return null
}

/**
 * What is wrong with the system keyring and how to fix it, in the user's language.
 */
function describeCredentialStoreProblem(reason: CredentialStoreProblemReason): string {
  const t = messages().platform
  if (reason === 'no_default_keyring') return t.keyringNoDefault
  if (reason === 'not_running') return t.keyringNotRunning
  return t.keyringLocked
}

/**
 * What a backend error says on screen. The backend writes English; an error people can act
 * on without reading a technical reason is said in the app's language instead. Screens show
 * `error.message` as is, so the translation happens where the error is built.
 */
function localizedBackendMessage(code: BackendErrorCode, backendMessage: string, details: BackendErrorDetails): string {
  if (code === 'credential_store_unavailable') {
    // The backend's own wording stays the fallback for a reason this version does not know.
    const reason = (details as CredentialStoreUnavailableDetails | null)?.reason
    return reason ? describeCredentialStoreProblem(reason) : backendMessage
  }
  if (code === 'draft_not_valid') return messages().newAgent.modelCouldNotWriteAgent
  if (code !== 'needs_newer_app') return backendMessage
  const { minVersion = null, appVersion = null } = (details as NeedsNewerAppDetails | null) ?? {}
  if (appVersion === null) return backendMessage
  const t = messages().plugins
  return minVersion === null ? t.errorNeedsNewerApp(appVersion) : t.errorNeedsAppVersion(minVersion, appVersion)
}

/**
 * Turns what a Tauri command rejected with into a {@link BackendError}.
 *
 * @example
 * toBackendError({ code: 'not_found', message: 'agent not found' }).code // 'not_found'
 * toBackendError('boom').code // 'internal'
 */
export function toBackendError(rawError: unknown): BackendError {
  if (isRecord(rawError) && typeof rawError.code === 'string' && typeof rawError.message === 'string') {
    const code = rawError.code as BackendErrorCode
    const details = parseBackendErrorDetails(code, rawError.details)
    return new BackendError(code, localizedBackendMessage(code, rawError.message, details), details)
  }
  return new BackendError('internal', typeof rawError === 'string' ? rawError : genericErrorMessage)
}

/**
 * Calls a Tauri command. Argument keys are camelCase (Tauri converts them to the
 * Rust snake_case parameters).
 *
 * @throws BackendError - with the command's error code
 */
export async function callBackend<Result>(command: string, commandArguments?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<Result>(command, commandArguments)
  } catch (rawError) {
    throw toBackendError(rawError)
  }
}

/**
 * Subscribes to a backend event. Returns an unsubscribe function; in the browser
 * it is a no-op.
 */
export async function listenToBackend<Payload>(eventName: string, onPayload: (payload: Payload) => void): Promise<() => void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<Payload>(eventName, (event) => onPayload(event.payload))
}

/** Creates a Tauri channel for per-call progress (e.g. building an agent). */
export async function createProgressChannel<Message>(onMessage: (message: Message) => void) {
  const { Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<Message>()
  channel.onmessage = onMessage
  return channel
}
