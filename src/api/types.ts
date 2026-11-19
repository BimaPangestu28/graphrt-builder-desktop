/**
 * Payloads exchanged with the Rust backend (src-tauri). Mirrors the serde types in
 * `src-tauri/src/storage/models.rs`, `credentials.rs`, `flow.rs`, `engine/mod.rs`
 * and `agent_builder.rs`. Keep both sides in sync when changing a field.
 */

export type AgentKind = 'task' | 'chatbot' | 'chain' | 'team'
export type AgentStatus = 'draft' | 'tested' | 'active' | 'paused'

export interface Agent {
  id: string
  name: string
  kind: AgentKind
  description: string
  flowYaml: string
  status: AgentStatus
  currentVersion: number
  /** RFC 3339 */
  createdAt: string
  updatedAt: string
}

export interface AgentVersion {
  agentId: string
  version: number
  flowYaml: string
  changeSummary: string
  createdAt: string
}

export type RunTrigger = 'test' | 'manual' | 'schedule'
export type RunStatus = 'running' | 'paused' | 'succeeded' | 'failed' | 'aborted'

export interface Run {
  id: string
  agentId: string
  agentVersion: number
  trigger: RunTrigger
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  outputs: Record<string, unknown> | null
  errorMessage: string | null
  /** graphrt PauseReason[] when paused: { frame, node_id, kind, data } */
  pauseReasons: GraphrtPauseReason[] | null
}

export interface GraphrtPauseReason {
  /** graphrt frame of the paused node: `""` at the top level, `each_place[3]` inside an iteration. */
  frame?: string
  node_id: string | null
  kind: string
  data: unknown
}

/**
 * A graphrt engine event as JSON. `type` is snake_case: run_started, node_started,
 * node_chunk, node_progress, node_retry, node_succeeded, node_failed, node_skipped,
 * node_paused, variable_updated, run_succeeded, run_failed, run_paused, run_aborted…
 * plus the desktop's own `status_changed`.
 */
export interface GraphrtEvent {
  type: string
  node_id?: string
  [field: string]: unknown
}

export interface RunEventRecord {
  runId: string
  seq: number
  event: GraphrtEvent
  createdAt: string
}

/** Payload of the `run-event` Tauri event. */
export interface RunEventPayload {
  runId: string
  agentId: string
  seq: number
  status: RunStatus
  event: GraphrtEvent
}

export interface RunFilter {
  agentId?: string
  status?: RunStatus
  limit?: number
}

export type MissedRunPolicy = 'run_once' | 'skip'

export interface Trigger {
  id: string
  agentId: string
  /** Cron with seconds, e.g. "0 0 9 * * Mon-Fri" */
  cronExpression: string
  /** IANA zone, e.g. "Asia/Jakarta" */
  timezone: string
  enabled: boolean
  missedRunPolicy: MissedRunPolicy
  inputs: Record<string, unknown>
  lastFiredAt: string | null
  nextFireAt: string | null
  createdAt: string
}

export interface NewTrigger {
  agentId: string
  cronExpression: string
  timezone: string
  missedRunPolicy: MissedRunPolicy
  inputs: Record<string, unknown>
}

export type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'ollama'

export interface ProviderStatus {
  provider: ModelProvider
  configured: boolean
  baseUrl: string | null
}

export interface ModelChoice {
  provider: ModelProvider
  name: string
}

export interface FlowStep {
  id: string
  nodeType: string
  title: string
  detail: string
  needsApproval: boolean
  depth: number
}

export interface FlowInput {
  name: string
  label: string
  required: boolean
  /** The start variable's graphrt `type` (`text-input`, `paragraph`, `select`, `number`, `checkbox`, `json`…). */
  inputType?: string
  /** Choices of a `select` input. */
  options?: string[]
  /** The workflow's `default`, if any. */
  defaultValue?: unknown
}

/** A value the workflow reads from `env.<name>` (API keys, tokens, account ids). */
export interface FlowEnvVar {
  name: string
  description: string | null
  /** Declared with `type: secret` (masked in logs and events). */
  isSecret: boolean
  /** The document has a default, so setting it is optional. */
  hasDefault: boolean
}

export interface FlowSummary {
  steps: FlowStep[]
  inputs: FlowInput[]
  modelProviders: string[]
  env: FlowEnvVar[]
}

/** Status of one `env.*` value an agent needs. The value itself is never sent to the UI. */
export interface WorkflowSecretStatus {
  name: string
  description: string | null
  isSecret: boolean
  /** No default in the workflow, so runs cannot start until it is set. */
  required: boolean
  configured: boolean
}

export interface BuildRequest {
  description: string
  kind: AgentKind | null
}

export type BuildStage = 'understanding' | 'drafting' | 'checking' | 'repairing' | 'done'

/** What the model has written so far, sent while it drafts (several times a second). */
export interface DraftPreview {
  /** The model's plain-language opening (what the agent does / what changed), growing as it streams. */
  explanation: string
  /** Titles of the steps written so far, in order (from the partial workflow document). */
  stepTitles: string[]
  /** Output tokens so far (the provider's count when it reports one, otherwise an estimate). */
  outputTokens: number
}

export interface BuildProgress {
  stage: BuildStage
  message: string
  /** Present while the model is writing a draft (stage `drafting` or `repairing`). */
  draft?: DraftPreview | null
}

export interface RevisionResult {
  agent: Agent
  summary: string
  changedStepIds: string[]
  /** The model's own words about the change ("I replaced the Maps search with…"); may be empty. */
  explanation: string
}

/** Error returned by every command: `{ code, message }`. */
export type BackendErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'database'
  | 'credentials'
  | 'missing_credentials'
  /** start_run: the workflow uses plugins that are not installed, trusted or set up yet. */
  | 'missing_plugins'
  | 'workflow'
  | 'model'
  | 'schedule'
  | 'serialization'
  | 'internal'
  | 'missing_plugins'
