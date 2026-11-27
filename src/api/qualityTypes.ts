/**
 * Tests, checks and releases of an agent (the Rust `quality` module). Shapes match the
 * backend's serde output.
 */

/** One question the agent is checked with. */
export interface AgentTest {
  id: string
  agentId: string
  question: string
  /** What a good answer says; empty: the answer only has to address the question. */
  goodAnswer: string
  /** Advanced: words the answer must contain. */
  mustInclude: string[]
  /** Advanced: words the answer must not contain. */
  mustNotInclude: string[]
  /** Suggested by the app and not changed yet. */
  suggested: boolean
  createdAt: string
  updatedAt: string
}

/** What the person writes for a test. */
export interface TestInput {
  question: string
  goodAnswer: string
  mustInclude: string[]
  mustNotInclude: string[]
  suggested: boolean
}

export type CheckStatus = 'running' | 'finished' | 'failed'

/** Why an answer was not good. */
export type NotGoodReason =
  | { kind: 'judge'; text: string }
  | { kind: 'missing_words'; words: string[] }
  | { kind: 'unwanted_words'; words: string[] }
  | { kind: 'no_answer'; message: string }

/** What moved for one question since the check before. */
export type QuestionChange = 'now_good' | 'now_not_good' | 'new'

export interface QuestionResult {
  testId: string
  question: string
  good: boolean
  answer: string
  goodBecause: string | null
  notGoodBecause: NotGoodReason[]
  change: QuestionChange | null
}

export interface PreviousCheck {
  checkId: string
  agentVersion: number
  good: number
  total: number
}

export interface CheckView {
  id: string
  agentVersion: number
  status: CheckStatus
  startedAt: string
  finishedAt: string | null
  good: number
  total: number
  requiredPercent: number
  /** Good answers needed at `requiredPercent`. */
  needed: number
  enoughGood: boolean
  /** The tests changed after this check ran. */
  testsChangedSince: boolean
  errorMessage: string | null
  questions: QuestionResult[]
  previous: PreviousCheck | null
}

/** Why the latest version cannot be released (yet). */
export type ReleaseBlock =
  | { kind: 'already_released'; number: number }
  | { kind: 'check_running' }
  | { kind: 'no_tests' }
  | { kind: 'not_checked' }
  | { kind: 'tests_changed' }
  | { kind: 'check_did_not_finish' }
  | { kind: 'not_enough_good'; good: number; total: number; needed: number; requiredPercent: number }

export type ReleaseReadiness =
  | { status: 'ready'; checkId: string; good: number; total: number }
  | { status: 'blocked'; block: ReleaseBlock; canOverride: boolean; checkId: string | null }

/** A released version. Never changes. */
export interface Release {
  agentId: string
  number: number
  agentVersion: number
  notes: string
  checkId: string | null
  passed: number | null
  total: number | null
  requiredPercent: number
  /** Set when released although the check did not allow it. */
  overrideReason: string | null
  createdAt: string
}

/** Advanced: how strict releases are. */
export interface QualitySettings {
  requiredPercent: number
  timesEach: number
}

export interface QualityOverview {
  agentId: string
  currentVersion: number
  tests: AgentTest[]
  latestCheck: CheckView | null
  readiness: ReleaseReadiness
  /** Newest first. */
  releases: Release[]
  inUse: Release | null
  settings: QualitySettings
  /** The agent has an input a question can be asked with. */
  canCheck: boolean
}

export interface SuggestedTest {
  question: string
  goodAnswer: string
}

/** `agent-check-event`: progress of a running check. */
export interface CheckProgress {
  agentId: string
  checkId: string
  done: number
  total: number
  finished: boolean
}

/** What happened online when another release was put in use. */
export type OnlineSwitch = { kind: 'not_online' } | { kind: 'already_online' } | { kind: 'switched'; label: string } | { kind: 'needs_update' }

export interface ReleaseSwitchOutcome {
  release: Release
  online: OnlineSwitch
}
