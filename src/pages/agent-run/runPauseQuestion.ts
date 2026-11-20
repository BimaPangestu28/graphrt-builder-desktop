import { readPendingApprovals } from '@/api/pauseReasons'
import type { Run } from '@/api/types'
import { describeTimeLeft } from './approvalDisplay'

/** "Wants to use send_message" / "Wants to use 3 tools" for a run waiting on tool approvals. */
function describeToolApproval(run: Run): string | null {
  const toolCalls = readPendingApprovals(run).flatMap((approval) => (approval.toolCall ? [approval.toolCall] : []))
  if (toolCalls.length === 0) return null
  if (toolCalls.length > 1) return `Wants to use ${toolCalls.length} tools`
  return `Wants to use ${toolCalls[0].tool ?? toolCalls[0].name}`
}

/**
 * The question a paused run asks (human-input `prompt`, the sample data's `question`, or the
 * tool an agent waits to use).
 *
 * @param run - A run, usually with status `paused` (Run)
 * @returns The question, or null when the pause carries none (string | null)
 *
 * @example
 * readPauseQuestion(pausedRun) // "Send this message to Kopi Kenangan?"
 * readPauseQuestion(agentWaitingRun) // "Wants to use send_message"
 */
export function readPauseQuestion(run: Run): string | null {
  const pauseReason = run.pauseReasons?.[0]
  if (pauseReason?.kind === 'tool_approval') return describeToolApproval(run)
  const pauseData = pauseReason?.data
  if (typeof pauseData === 'string') return pauseData
  if (!pauseData || typeof pauseData !== 'object') return null
  const { question, prompt } = pauseData as Record<string, unknown>
  if (typeof question === 'string' && question.length > 0) return question
  return typeof prompt === 'string' && prompt.length > 0 ? prompt : null
}

/**
 * The soonest deadline among the run's questions.
 *
 * @param run - A paused run (Run)
 * @param now - Current time in ms (number)
 * @returns "Expires in 2h", or null when nothing expires (string | null)
 */
export function readPauseDeadline(run: Run, now: number): string | null {
  const deadlines = readPendingApprovals(run)
    .flatMap((approval) => (approval.expiresAt ? [approval.expiresAt] : []))
    .sort((first, second) => Date.parse(first) - Date.parse(second))
  return describeTimeLeft(deadlines[0] ?? null, now)
}
