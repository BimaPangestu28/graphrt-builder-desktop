import { reportFrontendError } from '@/api/crashReports'
import type { FrontendErrorSource } from '@/api/crashReportTypes'

/**
 * Sends errors the window could not handle to the backend, which scrubs them and saves
 * a crash report on this computer (nothing is sent anywhere else). Covers uncaught
 * exceptions (`error`), unhandled promise rejections and the React error boundary.
 *
 * The same message is reported once per session, and at most
 * {@link maxReportsPerSession} reports are sent, so an error in a render loop cannot
 * fill the crash reports folder.
 */

const maxReportsPerSession = 10
const reportedMessages = new Set<string>()

/**
 * The in-app route (the hash path) without its query string or fragment, so workflow
 * inputs or search text in the URL never reach a report.
 *
 * @param hash - `window.location.hash`, e.g. `#/agents/a1/run?input=x` (string)
 * @returns The path, e.g. `/agents/a1/run` (string)
 */
export function routeFromHash(hash: string): string {
  const pathWithQuery = hash.startsWith('#') ? hash.slice(1) : hash
  return pathWithQuery.split('?')[0].split('#')[0] || '/'
}

function describeThrownValue(thrownValue: unknown): { message: string; stack: string | null } {
  if (thrownValue instanceof Error) {
    return { message: `${thrownValue.name}: ${thrownValue.message}`, stack: thrownValue.stack ?? null }
  }
  if (typeof thrownValue === 'string') return { message: thrownValue, stack: null }
  // Other values (objects, numbers) could hold user data; keep only their type.
  return { message: `Non-error value thrown (${typeof thrownValue})`, stack: null }
}

/**
 * Reports one error. Never throws: a failed report is logged to the console only.
 *
 * @param thrownValue - What was thrown or rejected (unknown)
 * @param source - How it was caught (FrontendErrorSource)
 * @param componentStack - React's component stack, for the error boundary (string | null)
 */
export function sendFrontendErrorReport(thrownValue: unknown, source: FrontendErrorSource, componentStack: string | null = null): void {
  const { message, stack } = describeThrownValue(thrownValue)
  if (reportedMessages.has(message) || reportedMessages.size >= maxReportsPerSession) return
  reportedMessages.add(message)
  const route = typeof window === 'undefined' ? null : routeFromHash(window.location.hash)
  reportFrontendError({ message, stack, componentStack, route, source }).catch((reportError: unknown) => {
    console.warn('graphrt: could not save a crash report', reportError)
  })
}

/**
 * Listens for uncaught errors and unhandled rejections on `target`.
 *
 * @param target - The window to listen on (Window)
 * @returns A function that removes the listeners (() => void)
 */
export function installFrontendErrorReporting(target: Window = window): () => void {
  const handleError = (event: ErrorEvent) => sendFrontendErrorReport(event.error ?? event.message, 'window_error')
  const handleRejection = (event: PromiseRejectionEvent) => sendFrontendErrorReport(event.reason, 'unhandled_rejection')
  target.addEventListener('error', handleError)
  target.addEventListener('unhandledrejection', handleRejection)
  return () => {
    target.removeEventListener('error', handleError)
    target.removeEventListener('unhandledrejection', handleRejection)
  }
}

/** Forgets which messages were reported (use in test `beforeEach`). */
export function resetFrontendErrorReporting(): void {
  reportedMessages.clear()
}
