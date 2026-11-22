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

/**
 * Multiplier for every {@link waitFor} pause. 1 in the browser preview so builds
 * look real; the test setup sets 0 so tests do not wait on pretend work (tests that
 * step through stages with fake timers set it back with {@link setSampleDelayScale}).
 */
let sampleDelayScale = 1

/**
 * Speeds up or removes the pauses the sample builder pretends to take.
 *
 * @param scale - 1 for real pacing, 0 for none (number, at least 0)
 * @throws RangeError - When `scale` is negative or not a number
 *
 * @example
 * beforeEach(() => setSampleDelayScale(1)) // a test that advances fake timers stage by stage
 */
export function setSampleDelayScale(scale: number): void {
  if (!(scale >= 0)) throw new RangeError(`sample delay scale must be 0 or more, got ${scale}`)
  sampleDelayScale = scale
}

/** Resolves after `delayMs` times the delay scale (sample builds and revisions pretend to take time). */
export function waitFor(delayMs: number): Promise<void> {
  const scaledDelayMs = delayMs * sampleDelayScale
  return new Promise((resolve) => setTimeout(resolve, scaledDelayMs))
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
