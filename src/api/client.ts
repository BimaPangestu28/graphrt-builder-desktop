import type { BackendErrorCode } from './types'

/**
 * Low-level bridge to the Rust backend.
 *
 * In the desktop app every call goes through Tauri `invoke`. In the browser
 * (`pnpm dev`) and in tests there is no backend, so feature modules fall back to
 * sample data: they check {@link isDesktopApp} and return mocks instead.
 */

/** True inside the Tauri window; false in a plain browser or jsdom. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Error thrown by {@link callBackend} with the backend's stable code. */
export class BackendError extends Error {
  readonly code: BackendErrorCode
  /** Structured data some codes carry (`version_conflict`: `{ baseVersion, latestVersion }`, `invalid_graph`: `{ problems }`); null otherwise. */
  readonly details: unknown

  constructor(code: BackendErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.details = details ?? null
  }
}

function toBackendError(rawError: unknown): BackendError {
  if (rawError && typeof rawError === 'object' && 'code' in rawError && 'message' in rawError) {
    const { code, message, details } = rawError as { code: BackendErrorCode; message: string; details?: unknown }
    return new BackendError(code, message, details)
  }
  return new BackendError('internal', typeof rawError === 'string' ? rawError : 'Something went wrong')
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
  if (!isDesktopApp()) return () => {}
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
