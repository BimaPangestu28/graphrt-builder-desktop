import type { RunStatus } from './types'

/**
 * Team payloads (screen 13), mirroring `src-tauri/src/teams/` (camelCase).
 * Activity and the coordinator chat are read from real runs of the team agent.
 */

/** A piece of an activity sentence; agent names are bold. */
export interface ActivityPart {
  text: string
  isMember: boolean
}

export interface TeamActivityEntry {
  id: string
  /** RFC 3339. */
  at: string
  parts: ActivityPart[]
  runId: string
  agentId: string
}

/** Limits that are enforced, and whether the team's steps ask before sending. */
export interface TeamGuardrails {
  agentId: string
  /** Most member-agent calls in one team run; null means no limit. */
  maxAgentCallsPerRun: number | null
  /** Steps that send data out without asking first; empty means it always asks. */
  unapprovedSendingSteps: string[]
}

export type MemberCallStatus = 'working' | 'done' | 'failed'

export interface CoordinatorMemberCall {
  memberName: string
  task: string
  status: MemberCallStatus
}

/** One run of the team agent shown as a message and its reply. */
export interface CoordinatorExchange {
  runId: string
  sentAt: string
  message: string
  status: RunStatus
  replyText: string | null
  errorMessage: string | null
  memberCalls: CoordinatorMemberCall[]
  /** E.g. "3 agent calls of max 20". */
  note: string | null
}
