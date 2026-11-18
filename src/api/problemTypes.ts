import type { RunStatus } from './types'

/**
 * Payloads of the "When something goes wrong" screen (23). Mirrors the serde types in
 * `src-tauri/src/problems/models.rs`; keep both sides in sync.
 */

export type ProblemKind =
  | 'failed_run'
  | 'missing_credentials'
  | 'plugin_missing'
  | 'plugin_not_loaded'
  | 'plugin_untrusted'
  | 'browser_missing'
  | 'schedule_invalid'
  | 'schedule_failing'

/** What a problem button does; each maps to a screen or a command. */
export type ProblemActionKind = 'open_run' | 'retry_run' | 'open_connections' | 'open_plugins' | 'open_builder' | 'open_schedule' | 'install_browser'

export interface ProblemAction {
  kind: ProblemActionKind
  label: string
  agentId: string | null
  runId: string | null
}

export interface Problem {
  /** Stable id, e.g. `failed_run:<run id>`. */
  id: string
  kind: ProblemKind
  title: string
  detail: string
  /** Still waiting on the user (amber border). */
  needsAttention: boolean
  agentId: string | null
  agentName: string | null
  runId: string | null
  /** RFC 3339, for failed runs. */
  occurredAt: string | null
  actions: ProblemAction[]
}

export type FailedRunStepState = 'done' | 'failed' | 'pending'

export interface FailedRunStep {
  id: string
  name: string
  state: FailedRunStepState
  /** Short note next to a failed step, e.g. "Failed after 3 tries". */
  note: string | null
}

/** graphrt keeps no snapshot of a failed run, so a retry always starts over. */
export interface RetryAvailability {
  canRetry: boolean
  reason: string | null
}

export interface FailedRunReport {
  runId: string
  agentId: string
  agentName: string
  status: RunStatus
  startedAt: string
  title: string
  explanation: string
  fixSteps: string[]
  fixAction: ProblemAction | null
  steps: FailedRunStep[]
  failedStepId: string | null
  technicalDetails: string
  retry: RetryAvailability
}
