/**
 * An agent's abilities (Rust `agent_graph::abilities`, `engine::spending`) and what it
 * remembers (Rust `memory::models`). Keep in sync with those modules (camelCase on the wire).
 */

/** What a step does when a conversation outgrows the model. */
export type ContextMode = 'auto' | 'summarize' | 'off'

export interface ContextSetting {
  mode: ContextMode
  /** Input tokens a request may use (advanced); `null` trims only when the model refuses. */
  maxTokens: number | null
}

export interface MemorySetting {
  enabled: boolean
  /** Also keep a graph of who and what the notes name. */
  graph: boolean
}

export interface HelpersSetting {
  /** The allowlist: the agent can only ask these agents. */
  agentIds: string[]
  maxParallel: number
  maxCalls: number
}

/** Why an agent cannot be a helper. */
export type HelperUnavailable = 'broken' | 'needs_file_or_secret'

export interface HelperChoice {
  agentId: string
  name: string
  description: string
  unavailable: HelperUnavailable | null
}

/** Both parts optional (`null`: no limit). */
export interface SpendingLimit {
  maxTotalTokens: number | null
  /** In millionths of a dollar. */
  maxCostMicros: number | null
}

export interface AgentAbilities {
  agentId: string
  /** Steps that choose their own tools (memory, helpers and retries need one). */
  agentSteps: number
  /** Steps that talk to a model (long conversations need one). */
  modelSteps: number
  context: ContextSetting
  memory: MemorySetting
  helpers: HelpersSetting
  helperChoices: HelperChoice[]
  retrySafeTools: string[]
  toolChoices: string[]
  spending: SpendingLimit
  /** The stored limit could not be read: runs are refused until it is set again. */
  spendingUnreadable: boolean
  /** The steps say different things; saving here sets them all alike. */
  stepsDiffer: boolean
  /** `provider/model` without a known price: a money limit cannot count them. */
  unpricedModels: string[]
}

/** One change of an ability (a new version of the agent). */
export type AbilityChange =
  | ({ kind: 'context' } & ContextSetting)
  | ({ kind: 'memory' } & MemorySetting)
  | ({ kind: 'helpers' } & HelpersSetting)
  | { kind: 'retry_safe_tools'; tools: string[] }

/** graphrt's defaults and the bounds the app accepts (Rust `agent_graph::abilities`, `engine::spending`). */
export const abilityBounds = {
  defaultMaxParallel: 4,
  defaultMaxCalls: 16,
  maxParallel: 8,
  maxCalls: 50,
  maxHelpers: 10,
  minContextTokens: 2_000,
  maxContextTokens: 2_000_000,
  minTokens: 1_000,
  maxTokens: 100_000_000,
  minCostMicros: 1_000,
  maxCostMicros: 1_000_000_000,
} as const

export type MemoryKind = 'fact' | 'preference' | 'event' | 'note'
export type MemoryStatus = 'active' | 'pending'
/** Where a note's words came from. */
export type MemoryOrigin = 'owner' | 'user_stated' | 'model_inferred' | 'model_after_tools' | 'tool_derived'
export type MemoryPersonKind = 'customer' | 'you' | 'checks' | 'other'

export interface MemoryPerson {
  /** The user id runs use (a customer handle, or the app's own id). */
  user: string
  name: string | null
  kind: MemoryPersonKind
  noteCount: number
  waitingCount: number
}

export interface MemoryNote {
  id: string
  text: string
  kind: MemoryKind
  status: MemoryStatus
  origin: MemoryOrigin
  savedAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  uses: number
}

export interface AgentMemory {
  agentId: string
  people: MemoryPerson[]
  /** Notes of the agent as a whole (proposals of runs without a person, and the owner's). */
  agentNotes: MemoryNote[]
  /** Some people could not be read: the list may miss someone. */
  incomplete: boolean
}

export interface MemoryFact {
  id: string
  text: string
  source: string
  relation: string
  target: string
  validFrom: string | null
  validTo: string | null
  isClosed: boolean
  status: MemoryStatus
}

export interface MemoryGraph {
  entities: string[]
  facts: MemoryFact[]
  unreadable: boolean
}

export interface ForgottenPerson {
  notes: number
  lessons: number
}
