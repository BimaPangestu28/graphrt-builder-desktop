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

/** Structured data per error code; codes not listed carry none. */
export interface BackendErrorDetailsByCode {
  version_conflict: VersionConflictDetails
  invalid_graph: InvalidGraphDetails
  builder_busy: null
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
  return null
}

function toBackendError(rawError: unknown): BackendError {
  if (isRecord(rawError) && typeof rawError.code === 'string' && typeof rawError.message === 'string') {
    const code = rawError.code as BackendErrorCode
    return new BackendError(code, rawError.message, parseBackendErrorDetails(code, rawError.details))
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
