/**
 * What an agent learned, as the "What this agent learned" screen reads it (the Rust
 * `learning::models` views). A lesson is one short note. Only an approved lesson is ever
 * used in a run, and a run never writes one.
 */

export type LessonStatus = 'proposed' | 'approved' | 'rejected' | 'retired'

/**
 * How far a lesson can be trusted: `owner` wrote it, `user` is a verified person's own
 * words, `derived` came from what a run read or produced or from feedback nobody verified.
 */
export type LessonTrust = 'owner' | 'user' | 'derived'

export type LessonRisk = 'low' | 'high'

/** Where a lesson came from. */
export type LessonSignal = 'manual' | 'feedback' | 'run_outcome' | 'reflection'

export type LessonKind = 'preference' | 'fact' | 'procedure' | 'correction'

/** Why a lesson is marked high risk. */
export interface LessonRiskReason {
  /** Stable code the UI translates, e.g. `sending`. */
  code: string
  /** The runtime's English sentence, shown only for codes the UI does not know. */
  message: string
}

export interface Lesson {
  id: string
  text: string
  kind: LessonKind
  status: LessonStatus
  trust: LessonTrust
  risk: LessonRisk
  riskReasons: LessonRiskReason[]
  /** The one person it applies to; null applies to everyone the agent serves. */
  user: string | null
  signal: LessonSignal
  runId: string | null
  author: string | null
  /** A short excerpt of the run it came from (secrets already hidden). */
  evidence: string | null
  createdAt: string | null
  updatedAt: string | null
  /** For a proposal: when it lapses without a decision. */
  expiresAt: string | null
  decidedBy: string | null
}

export type LessonHistoryAction = 'add' | 'propose' | 'approve' | 'auto_approve' | 'reject' | 'retire' | 'edit' | 'promote' | 'delete' | 'forget' | 'expire' | 'policy'

export interface LessonHistoryEntry {
  at: string | null
  /** `owner` for what was done in this app, `system` for what happened by itself, else who. */
  actor: string
  /** One of {@link LessonHistoryAction}; a newer runtime may send others. */
  action: string
  lessonId: string | null
  /** The lesson's text now, when it still exists. */
  lessonText: string | null
}

/** Whether the agent's steps read what it learned. */
export interface LearningUse {
  /** How many steps could read lessons (none: the agent cannot use them as built). */
  capableSteps: number
  readingSteps: number
}

export interface AgentLearning {
  agentId: string
  /** Every lesson, newest change first. */
  lessons: Lesson[]
  /** "Learn automatically". Off unless the owner turned it on. */
  autoLearn: boolean
  /** Newest first. */
  history: LessonHistoryEntry[]
  usage: LearningUse
}

export type LessonDecision = 'approve' | 'reject' | 'retire'

/** Thumbs up or down on a finished run, with an optional comment. */
export interface RunFeedback {
  helpful: boolean
  comment: string | null
}

export interface FeedbackOutcome {
  /** Lessons now waiting for the owner because of this feedback. */
  proposed: Lesson[]
  /** Why a comment did not become a proposal, when it did not. */
  notRecorded: string | null
}
