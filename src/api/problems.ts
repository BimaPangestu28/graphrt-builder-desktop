import { callBackend, isDesktopApp } from './client'
import { sampleProblemsBackend } from './sampleBackend/problems'
import type { FailedRunReport, Problem } from './problemTypes'
import type { Run } from './types'

/** Problems of screen 23: what went wrong, one failed run explained, and retries. */

/** Every problem the backend detects now: failed runs, missing keys, plugins, browser, schedules. */
export function listProblems(): Promise<Problem[]> {
  if (!isDesktopApp()) return sampleProblemsBackend.listProblems()
  return callBackend('list_problems')
}

/** One failed run explained: cause, fix, steps and graphrt's error. */
export function getFailedRunReport(runId: string): Promise<FailedRunReport> {
  if (!isDesktopApp()) return sampleProblemsBackend.getFailedRunReport(runId)
  return callBackend('get_failed_run_report', { runId })
}

/**
 * Starts a new run of the same agent with the same inputs. graphrt cannot resume a failed
 * run, so this always starts from the beginning.
 */
export function retryRun(runId: string): Promise<Run> {
  if (!isDesktopApp()) return sampleProblemsBackend.retryRun(runId)
  return callBackend('retry_run', { runId })
}
