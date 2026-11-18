import type { RunStatus, RunTrigger } from './types'

/**
 * What a paused run waits for (screen 19, and the approval card of screen 06).
 * Mirrors the serde types in `src-tauri/src/run_review.rs`; keep both sides in sync.
 *
 * Every question comes from a graphrt `human-input` pause: its pause reason's `data` is
 * `{ prompt, fields, actions, timeout_ms }`, and the run resumes with `{ action, values }`
 * under {@link PendingApproval.resumeKey}.
 */

/** One form field of a `human-input` node (`data.fields[]`). */
export interface ApprovalField {
  name: string
  label: string
  /** The field's `type` as written in the workflow, e.g. `text` or `paragraph`. */
  fieldType: string
  required: boolean
  /** Rendered default; null when none. */
  defaultValue: unknown
}

/** One action (button) of a `human-input` node (`data.actions[]`). */
export interface ApprovalAction {
  id: string
  title: string
}

/** Where a question sits inside an `iteration` / `loop` body. */
export interface ContainerPosition {
  nodeId: string
  /** `iteration`, `loop`, or null when the flow could not be read. */
  nodeType: string | null
  title: string | null
  /** 0-based item index (iteration) or round (loop). */
  index: number
  /** Items the iteration goes through; null when graphrt's snapshot did not say. */
  total: number | null
  /** Items already finished; null when unknown. */
  finished: number | null
  /** The current item; null when unknown. */
  item: unknown
}

/** A question the run waits on right now. */
export interface PendingApproval {
  nodeId: string
  /** graphrt frame (`""` at the top level, `each_place[3]` inside an iteration). */
  frame: string
  /** Key of this answer in `resumeRun`'s `nodeInputs`. */
  resumeKey: string
  /** The paused step's title from the flow, when known. */
  stepTitle: string | null
  prompt: string | null
  fields: ApprovalField[]
  actions: ApprovalAction[]
  timeoutMs: number | null
  container: ContainerPosition | null
}

/** An answer already given in this run. */
export interface AnsweredApproval {
  nodeId: string
  frame: string
  action: string
  index: number | null
  answeredAt: string
}

export interface RunReview {
  runId: string
  agentId: string
  agentName: string
  trigger: RunTrigger
  status: RunStatus
  startedAt: string
  /** Questions to answer now; empty unless the run is paused on human input. */
  pending: PendingApproval[]
  /** Pause kinds this screen cannot answer. */
  otherPauseKinds: string[]
  answered: AnsweredApproval[]
}

/** The answer to one question: the chosen action and the form values. */
export interface ApprovalAnswer {
  action: string
  values: Record<string, unknown>
}

/** Workflow inputs of a run (the start node's variables). */
export type RunInputs = Record<string, unknown>
