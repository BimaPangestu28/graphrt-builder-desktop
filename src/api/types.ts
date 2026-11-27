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
  /** Added by the desktop to an approval step with a time limit: when it expires (ISO 8601). */
  expires_at?: string
  /** Added with `expires_at`: `{ kind: 'stop' }` or `{ kind: 'answer', action }`. */
  on_timeout?: unknown
}

/**
 * A graphrt engine event as JSON. `type` is snake_case: run_started, node_started,
 * node_chunk, node_progress, node_retry, node_succeeded, node_failed, node_skipped,
 * node_paused, variable_updated, run_succeeded, run_failed, run_paused, run_aborted…
 * plus the desktop's own `status_changed` and `approval_timed_out`.
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

export type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'ollama' | LocalCliProvider

/** The user's own signed-in command-line tools graphrt can think with (Experimental, opt-in). */
export type LocalCliProvider = 'claude-code-cli' | 'codex-cli' | 'gemini-cli' | 'cursor-cli' | 'copilot-cli' | 'opencode-cli' | 'qwen-code-cli'

/** Whether a local CLI's own status command reports a signed-in account (no usage spent). */
export type LocalCliSignIn = 'signed_in' | 'signed_out' | 'unknown'

/** What graphrt detected about a local CLI provider (mirrors the backend's `LocalCliStatus`). */
export interface LocalCliStatus {
  /** The user turned it on in graphrt (opt-in). */
  enabled: boolean
  /** The binary was found on this computer. */
  installed: boolean
  /** E.g. "2.1.330 (Claude Code)" or "codex-cli 0.142.2". */
  version: string | null
  /** Why the found binary does not work (its `--version` failed), in plain words; null when it does. */
  problem: string | null
  /** Resolved binary path. */
  path: string | null
  signIn: LocalCliSignIn
  /** Docs page explaining how to install it. */
  installUrl: string
}

export interface ProviderStatus {
  provider: ModelProvider
  /** Keyed providers: a stored key. Ollama: always. Local CLIs: turned on and installed. */
  configured: boolean
  baseUrl: string | null
  /** Detection details for the local CLI providers; null for the others. */
  localCli: LocalCliStatus | null
}

/** Result of `check_local_cli`: one tiny prompt run through the CLI. */
export interface LocalCliCheckResult {
  ok: boolean
  /** Plain language, e.g. "Claude Code answered in 2.1 s". */
  message: string
}

/** What `check_ollama` found: the server answered, the app is there but silent, or neither. */
export type OllamaState = 'running' | 'installed_not_running' | 'not_found'

/** Result of `check_ollama`: an honest look at Ollama on this computer (mirrors the backend's `OllamaCheck`). */
export interface OllamaCheck {
  state: OllamaState
  /** The address that was asked, e.g. "http://localhost:11434". */
  baseUrl: string
  /** Downloaded models agents can think with (no embedding models); empty unless Ollama is running. */
  models: string[]
}

/** What the user picked on the first-launch Welcome screen. */
export type WelcomeChoice = LocalCliProvider | 'ollama' | 'api-key' | 'skip'

/** Providers with an install / download page graphrt can open in the browser. */
export type InstallableModelProvider = LocalCliProvider | 'ollama'

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
  /** The variable's JSON schema, when the workflow gives one (the columns of a list input). */
  schema?: unknown
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

/**
 * The builder's reply to a change the user stopped (same words as the desktop backend, which
 * stores it in English). Shown through `describeStoppedReply`.
 */
export const stoppedReplyText = 'Stopped by you'

/** One saved message of an agent's builder chat (mirrors `storage::models::BuilderMessage`). */
export interface BuilderMessage {
  id: string
  agentId: string
  /** `user`: a change request · `builder`: a reply (a finished change, a restore, or why a change failed). */
  role: 'user' | 'builder'
  /** The request, the change summary, or the error message of a failed change. */
  text: string
  /** The model's own words about the change; null when it said nothing. */
  explanation: string | null
  status: 'done' | 'failed'
  versionBefore: number | null
  versionAfter: number | null
  changedStepIds: string[]
  createdAt: string
}

/** Error returned by every command: `{ code, message }`. */
export type BackendErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'database'
  | 'credentials'
  /** The system keyring cannot keep secrets right now (Linux only); `details.reason` says why. */
  | 'credential_store_unavailable'
  | 'missing_credentials'
  /** start_run: the workflow uses plugins that are not installed, trusted or set up yet. */
  | 'missing_plugins'
  | 'workflow'
  /** build_agent / revise_agent: the model did not write a working agent after every repair (`details.problem`). */
  | 'draft_not_valid'
  | 'model'
  | 'schedule'
  | 'serialization'
  | 'internal'
  /** The action would replace something without the user's OK (e.g. a sideloaded plugin over a catalog one). */
  | 'conflict'
  /** save_agent_graph: the agent moved on since the edit started (`details.latestVersion`). */
  | 'version_conflict'
  /** save_agent_graph: the builder is changing the agent right now. */
  | 'builder_busy'
  /** save_agent_graph: the edited graph has blocking problems (`details.problems`). */
  | 'invalid_graph'
  /** revise_agent: the user stopped the change ("Stop the builder"); nothing was saved. */
  | 'stopped'
  /** install / update / sideload: the plugin needs a newer version of the app (`details.minVersion`). */
  | 'needs_newer_app'
