import { BackendError } from '../client'

/**
 * Runs a sample-backend operation asynchronously, like a real command: thrown errors
 * become rejections instead of escaping synchronously.
 *
 * @param operation - Work to run on the next microtask (() => Result)
 * @returns The operation's result (Promise<Result>)
 */
export function respondWith<Result>(operation: () => Result): Promise<Result> {
  return Promise.resolve().then(operation)
}

/** Resolves after `delayMs` (sample builds and revisions pretend to take time). */
export function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Rejects blank text the way the backend's `invalid_input` check does.
 *
 * @returns The trimmed text (string)
 * @throws BackendError - `invalid_input` when `text` is blank
 */
export function requireText(text: string, message: string): string {
  const trimmedText = text.trim()
  if (!trimmedText) throw new BackendError('invalid_input', message)
  return trimmedText
}
