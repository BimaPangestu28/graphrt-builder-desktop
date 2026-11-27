import { callBackend, isDesktopApp } from './client'
import type { AgentLearning, FeedbackOutcome, LearningUse, Lesson, LessonDecision, RunFeedback, RunSuggestions } from './learningTypes'
import { sampleLearningBackend } from './sampleBackend/learning'

/**
 * What agents learned: lessons, the ones waiting for the owner, and feedback on runs.
 * Outside the desktop app every call goes to the sample learning backend.
 */

/** Every lesson of the agent, its switches and its history. */
export function getAgentLearning(agentId: string): Promise<AgentLearning> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.getAgentLearning(agentId)
  return callBackend('get_agent_learning', { agentId })
}

/** Approves, rejects or retires a lesson. Only this (the owner's click) approves one. */
export function decideLesson(agentId: string, lessonId: string, decision: LessonDecision): Promise<Lesson> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.decideLesson(agentId, lessonId, decision)
  return callBackend('decide_lesson', { agentId, lessonId, decision })
}

/** @throws BackendError - `invalid_input` for text that cannot be a lesson */
export function editLesson(agentId: string, lessonId: string, text: string): Promise<Lesson> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.editLesson(agentId, lessonId, text)
  return callBackend('edit_lesson', { agentId, lessonId, text })
}

export function deleteLesson(agentId: string, lessonId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.deleteLesson(agentId, lessonId)
  return callBackend('delete_lesson', { agentId, lessonId })
}

/** Makes one person's lesson apply to everyone the agent serves. */
export function applyLessonToEveryone(agentId: string, lessonId: string): Promise<Lesson> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.applyLessonToEveryone(agentId, lessonId)
  return callBackend('apply_lesson_to_everyone', { agentId, lessonId })
}

/**
 * Forgets a person: every lesson about them and every lesson that came from them.
 *
 * @returns How many lessons were removed (number)
 */
export function forgetLearningPerson(agentId: string, user: string): Promise<number> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.forgetLearningPerson(agentId, user)
  return callBackend('forget_learning_person', { agentId, user })
}

/** Adds a note the owner wrote; it applies at once. */
export function addLearningNote(agentId: string, text: string): Promise<Lesson> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.addLearningNote(agentId, text)
  return callBackend('add_learning_note', { agentId, text })
}

/** Turns "learn automatically" on or off (off by default). */
export function setAutoLearn(agentId: string, enabled: boolean): Promise<boolean> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.setAutoLearn(agentId, enabled)
  return callBackend('set_auto_learn', { agentId, enabled })
}

/**
 * Makes the agent's steps read what it learned, or stop (a new version of the agent).
 *
 * @throws BackendError - `builder_busy` while the builder is changing the agent
 */
export function setAgentUsesLearning(agentId: string, enabled: boolean): Promise<LearningUse> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.setAgentUsesLearning(agentId, enabled)
  return callBackend('set_agent_uses_learning', { agentId, enabled })
}

/**
 * Records thumbs up or down on a finished run. A comment becomes a proposal that waits for
 * the owner; secrets in it are hidden before anything is saved.
 */
export function recordRunFeedback(runId: string, feedback: RunFeedback): Promise<FeedbackOutcome> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.recordRunFeedback(runId, feedback)
  return callBackend('record_run_feedback', { runId, feedback })
}

/**
 * Asks the person's default model to read the agent's latest runs and suggest notes. Every
 * suggestion waits for the owner; none is used before they approve it.
 *
 * @throws BackendError - `missing_credentials` when no model is connected, `model` when the
 *   model fails
 */
export function suggestNotesFromRuns(agentId: string): Promise<RunSuggestions> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleLearningBackend.suggestNotesFromRuns(agentId)
  return callBackend('suggest_notes_from_runs', { agentId })
}
