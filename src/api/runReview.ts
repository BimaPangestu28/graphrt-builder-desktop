import { callBackend, isDesktopApp } from './client'
import { sampleRunReviewBackend } from './sampleBackend/runReview'
import type { ApprovalAnswer, RunInputs, RunReview } from './runReviewTypes'
import type { Run } from './types'

/** Reviewing paused runs (screen 19) and the inputs runs started with (screens 06, 07). */

/**
 * What a run waits for: its pending questions (with iteration position) and answers so far.
 *
 * @param runId - The run, or null for the latest run waiting on human input (string | null)
 * @returns The review, or null when no run id was given and nothing waits (RunReview | null)
 * @throws BackendError - `not_found` when the run does not exist
 */
export function getRunReview(runId: string | null): Promise<RunReview | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunReviewBackend.getRunReview(runId)
  return callBackend('get_run_review', { runId })
}

/**
 * Answers one or more pending questions and resumes the run.
 *
 * @param runId - The paused run (string)
 * @param answersByResumeKey - `{ [pendingApproval.resumeKey]: { action, values } }`
 * @returns The resumed run (Run)
 * @throws BackendError - `invalid_input` when the run is not paused
 *
 * @example
 * await answerApprovals(runId, { 'each_place[0]/approve': { action: 'send', values: { message } } })
 */
export function answerApprovals(runId: string, answersByResumeKey: Record<string, ApprovalAnswer>): Promise<Run> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunReviewBackend.answerApprovals(runId, answersByResumeKey)
  return callBackend('resume_run', { runId, nodeInputs: answersByResumeKey })
}

/** Inputs the run started with; null for runs recorded before inputs were kept. */
export function getRunInputs(runId: string): Promise<RunInputs | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunReviewBackend.getRunInputs(runId)
  return callBackend('get_run_inputs', { runId })
}

/** Inputs of the agent's latest run, to prefill the next one; null when it never ran. */
export function getLastRunInputs(agentId: string): Promise<RunInputs | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunReviewBackend.getLastRunInputs(agentId)
  return callBackend('get_last_run_inputs', { agentId })
}
