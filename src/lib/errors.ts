import { messages } from '@/i18n'
/**
 * Turning anything a promise rejects with into something a screen can show.
 *
 * Backend calls reject with `BackendError` (an Error), but Tauri, plugins and
 * third-party code can also throw strings or plain `{ message }` objects. Every
 * hook and screen goes through these two helpers so the fallback wording and the
 * handling of odd values are the same everywhere.
 */

/** Shown when a thrown value carries no usable message. */
export const genericErrorMessage = 'Something went wrong'

function readMessage(rawError: unknown): string | null {
  if (typeof rawError === 'string') return rawError.trim() ? rawError : null
  if (rawError && typeof rawError === 'object' && 'message' in rawError) {
    const { message } = rawError as { message: unknown }
    if (typeof message === 'string' && message.trim()) return message
  }
  return null
}

/**
 * Normalises a thrown value into an Error so screens can read `error.message`.
 *
 * @param rawError - Whatever was thrown or rejected (unknown)
 * @returns The same Error, or a new one carrying its message or the generic one (Error)
 *
 * @example
 * toError('Disk full').message // 'Disk full'
 * toError(undefined).message // 'Something went wrong'
 */
export function toError(rawError: unknown): Error {
  if (rawError instanceof Error) return rawError
  return new Error(readMessage(rawError) ?? messages().platform.genericError)
}

/**
 * The message to show for a failed load or action.
 *
 * @param rawError - Whatever was thrown or rejected (unknown)
 * @returns Its message, or "Something went wrong" when it has none (string)
 *
 * @example
 * toErrorMessage(new Error('Not found')) // 'Not found'
 * toErrorMessage({ code: 1 }) // 'Something went wrong'
 */
export function toErrorMessage(rawError: unknown): string {
  return readMessage(rawError) ?? messages().platform.genericError
}
