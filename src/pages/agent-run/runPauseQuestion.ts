import type { Run } from '@/api/types'

/**
 * The question a paused run asks (human-input `prompt`, or the sample data's `question`).
 *
 * @param run - A run, usually with status `paused` (Run)
 * @returns The question, or null when the pause carries none (string | null)
 *
 * @example
 * readPauseQuestion(pausedRun) // "Send this message to Kopi Kenangan?"
 */
export function readPauseQuestion(run: Run): string | null {
  const pauseData = run.pauseReasons?.[0]?.data
  if (typeof pauseData === 'string') return pauseData
  if (!pauseData || typeof pauseData !== 'object') return null
  const { question, prompt } = pauseData as Record<string, unknown>
  if (typeof question === 'string' && question.length > 0) return question
  return typeof prompt === 'string' && prompt.length > 0 ? prompt : null
}
