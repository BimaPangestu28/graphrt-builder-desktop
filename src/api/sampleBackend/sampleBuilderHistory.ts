import type { Agent, RevisionResult } from '../types'
import { appendStoredBuilderMessages, readStoredAgent, type NewSampleBuilderMessage } from './sampleAgentStore'

/**
 * Saves the sample builder chat the way the desktop backend does (`agent_builder::history`):
 * a chat request with the builder's reply or failure, and a note after a restore.
 */

function readCurrentVersion(agentId: string): number | null {
  try {
    return readStoredAgent(agentId).currentVersion
  } catch {
    return null
  }
}

function describeSampleError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong'
}

function describeReply(outcome: { revision: RevisionResult } | { error: unknown }, versionBefore: number | null): NewSampleBuilderMessage {
  const baseReply = { role: 'builder' as const, explanation: null, versionBefore, changedStepIds: [] as string[] }
  if ('error' in outcome) return { ...baseReply, text: describeSampleError(outcome.error), status: 'failed', versionAfter: null }
  const { revision } = outcome
  const explanation = revision.explanation.trim() || null
  return { ...baseReply, text: revision.summary, explanation, status: 'done', versionAfter: revision.agent.currentVersion, changedStepIds: revision.changedStepIds }
}

function saveSampleMessages(agentId: string, messages: NewSampleBuilderMessage[]): void {
  try {
    appendStoredBuilderMessages(agentId, messages)
  } catch {
    // Like the desktop backend: an unknown agent has no chat to save to; the revision's own error is reported.
  }
}

/**
 * Runs a sample chat revision, then saves the request and the builder's reply (or the error message).
 *
 * @returns The revision's result; rejects with its error (Promise<RevisionResult>)
 */
export async function reviseWithSampleHistory(agentId: string, instruction: string, revise: () => Promise<RevisionResult>): Promise<RevisionResult> {
  const versionBefore = readCurrentVersion(agentId)
  const request = instruction.trim()
  const userMessage: NewSampleBuilderMessage = { role: 'user', text: request, explanation: null, status: 'done', versionBefore, versionAfter: null, changedStepIds: [] }
  try {
    const revision = await revise()
    if (request) saveSampleMessages(agentId, [userMessage, describeReply({ revision }, versionBefore)])
    return revision
  } catch (revisionError) {
    if (request) saveSampleMessages(agentId, [userMessage, describeReply({ error: revisionError }, versionBefore)])
    throw revisionError
  }
}

/** Notes a restore that added a version ("Restored version 7"); restoring the current steps adds nothing. */
export function recordSampleRestore(agentBefore: Agent, agentAfter: Agent, restoredVersion: number): void {
  if (agentAfter.currentVersion === agentBefore.currentVersion) return
  saveSampleMessages(agentAfter.id, [
    {
      role: 'builder',
      text: `Restored version ${restoredVersion}`,
      explanation: null,
      status: 'done',
      versionBefore: agentBefore.currentVersion,
      versionAfter: agentAfter.currentVersion,
      changedStepIds: [],
    },
  ])
}
