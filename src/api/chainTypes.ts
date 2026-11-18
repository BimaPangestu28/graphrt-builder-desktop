import type { AgentKind, AgentStatus, Run } from './types'

/**
 * Payloads of the chain, agent-as-a-step and team commands (screens 11 to 13).
 * Mirrors `src-tauri/src/storage/chains.rs` and `src-tauri/src/agent_steps/`.
 */

/** Active chains start the next agent when a run finishes; new chains are paused. */
export type ChainStatus = 'active' | 'paused'

/** When a link starts its agent, judged on the previous agent's run. */
export type ChainRunCondition = 'on_success' | 'always'

/** What the chain does when this step's agent fails: end here, or evaluate the next link. */
export type ChainFailurePolicy = 'stop' | 'continue'

export type ChainInputSource = { kind: 'output'; outputKey: string } | { kind: 'constant'; value: unknown }

export interface ChainInputMapping {
  /** Start input of this step's agent. */
  input: string
  source: ChainInputSource
}

/** One agent of a chain plus the link into it. Step 0's inputs are constants used by "Test chain". */
export interface ChainStep {
  agentId: string
  inputs: ChainInputMapping[]
  runCondition: ChainRunCondition
  onFailure: ChainFailurePolicy
}

export interface Chain {
  id: string
  name: string
  status: ChainStatus
  steps: ChainStep[]
  createdAt: string
  updatedAt: string
}

export interface ChainDraft {
  name: string
  steps: ChainStep[]
}

export type InputValueType = 'string' | 'number' | 'boolean' | 'any'

export interface AgentInput {
  name: string
  label: string
  required: boolean
  valueType: InputValueType
  options: string[]
}

/** An agent as a step: what it needs, what it gives back, and whether it can run inside another agent. */
export interface AgentStepInfo {
  agentId: string
  name: string
  description: string
  kind: AgentKind
  status: AgentStatus
  currentVersion: number
  inputs: AgentInput[]
  outputs: string[]
  stepCount: number
  usableAsStep: boolean
  unusableReason: string | null
  usedByCount: number
}

export interface TeamMember {
  agentId: string
  name: string
  description: string
  status: AgentStatus
  currentVersion: number
  /** The member's latest top-level run; calls from the team are not recorded as runs. */
  latestRun: Run | null
}

/** A team agent: its coordinator `agent` step and the member agents it may call. */
export interface TeamOverview {
  agentId: string
  name: string
  description: string
  status: AgentStatus
  coordinatorStepId: string | null
  members: TeamMember[]
}
