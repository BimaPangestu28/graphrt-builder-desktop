import type { BackendErrorCode, FlowStep } from './types'

/**
 * Shapes returned by the version history commands (`compare_agent_versions`,
 * `get_version_flow_summary`). Mirrors `src-tauri/src/commands/versions.rs`.
 */

/** Why a version's steps could not be read, e.g. its document no longer compiles (`workflow`). */
export interface VersionReadError {
  code: BackendErrorCode
  message: string
}

/** The steps of one saved version, or why they could not be read. */
export interface VersionSteps {
  version: number
  /** Empty when `error` is set. */
  steps: FlowStep[]
  error: VersionReadError | null
}

export type StepChangeKind = 'added' | 'removed' | 'changed' | 'unchanged'

/** One step (graphrt node id) compared across two versions. */
export interface StepChange {
  stepId: string
  kind: StepChangeKind
  /** The step in the `from` version; null when added. */
  before: FlowStep | null
  /** The step in the `to` version; null when removed. */
  after: FlowStep | null
  /** 1-based position in the `to` version's order; null when removed. */
  position: number | null
}

/** What changes going from `from` to `to` (on screen 24: current → the version to restore). */
export interface VersionComparison {
  agentId: string
  from: VersionSteps
  to: VersionSteps
  /**
   * Follows `from`'s order; steps only in `to` come right after the step that precedes
   * them there. Empty when either side has an error.
   */
  changes: StepChange[]
}
