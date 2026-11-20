import type { RunStatus, RunTrigger } from './types'

/**
 * What a paused run waits for (screen 19, and the approval card of screen 06).
 * Mirrors the serde types in `src-tauri/src/run_review.rs`; keep both sides in sync.
 *
 * A `form` question comes from a graphrt `human-input` pause: its pause reason's `data` is
 * `{ prompt, fields, actions, timeout_ms }`, and the run resumes with `{ action, values }`
 * under {@link PendingApproval.resumeKey}. A `toolCall` question is one call of a `tool_approval`
 * pause (a "Run an agent" step whose tools ask first): its actions are Allow / Decline and the
 * run resumes with `{ approvals: { [callId]: boolean } }` under the same resume key.
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

/** `form`: an "Ask me before continuing" step. `toolCall`: an agent waiting to use a tool. */
export type PendingApprovalKind = 'form' | 'toolCall'

/** What an approval step does when nobody answers before its deadline (stored on the pause reason). */
export type TimeoutAction = { kind: 'stop' } | { kind: 'answer'; action: string }

/** The tool call a `toolCall` question is about. */
export interface PendingToolCall {
  /** graphrt's call id, the key of the answer. */
  callId: string
  /** The name the model called. */
  name: string
  /** Plugin, MCP server or `agents`, when the step's tools list names it. */
  provider: string | null
  tool: string | null
  /** The arguments, with secret-looking values hidden. */
  arguments: unknown
  /** Why the agent wants to make the call; graphrt does not send one yet. */
  reason: string | null
}

/** A question the run waits on right now. */
export interface PendingApproval {
  /** Unique among the run's questions: the resume key, plus `#<call id>` for tool calls. */
  id: string
  kind: PendingApprovalKind
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
  /** When the question expires (ISO 8601); null waits until answered. */
  expiresAt: string | null
  /** What happens on expiry; null without a deadline. */
  onTimeout: TimeoutAction | null
  /** The call a `toolCall` question is about; null for forms. */
  toolCall: PendingToolCall | null
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
  /** Questions to answer now; empty unless the run is paused on human input or a tool approval. */
  pending: PendingApproval[]
  /** Pause kinds this screen cannot answer. */
  otherPauseKinds: string[]
  answered: AnsweredApproval[]
}

/** The answer to a form question: the chosen action and the form values. */
export interface FormApprovalAnswer {
  action: string
  values: Record<string, unknown>
}

/** The answer to tool call questions of one agent step: allowed (true) or declined, per call id. */
export interface ToolApprovalAnswer {
  approvals: Record<string, boolean>
}

/** What a paused node resumes with. */
export type ApprovalAnswer = FormApprovalAnswer | ToolApprovalAnswer

/** Workflow inputs of a run (the start node's variables). */
export type RunInputs = Record<string, unknown>
