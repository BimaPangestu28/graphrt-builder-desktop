import type { CoordinatorExchange, TeamActivityEntry, TeamGuardrails } from '../teamTypes'
import type { Run } from '../types'
import { BackendError } from '../client'
import { coordinatorAcknowledgement, sampleMaxAgentCallsPerRun, teamActivity, teamBudgetNote, teamGoalMessage, teamPlan } from '@/api/sampleBackend/fixtures/team'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample team activity, guardrails and coordinator chat for the browser preview and tests,
 * seeded from the mock data of screen 13 (`fixtures/team.ts`) and kept in memory. Every team
 * agent id gets the same sample. Call {@link resetSampleTeams} in tests to start from the seed.
 */

/** "13:05" on the sample day in the viewer's time zone, as on the mockup. */
function sampleTimeToIso(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2026, 10, 18, hours, minutes).toISOString()
}

function buildSeedChat(): CoordinatorExchange[] {
  return [
    {
      runId: 'sample-run-team-goal',
      sentAt: sampleTimeToIso('12:30'),
      message: teamGoalMessage,
      status: 'succeeded',
      replyText: 'Plan for this week',
      errorMessage: null,
      memberCalls: teamPlan.map((planItem) => ({ memberName: planItem.memberName, task: planItem.task, status: 'done' })),
      note: teamBudgetNote,
    },
  ]
}

let storedChat = buildSeedChat()
let maxAgentCallsPerRun: number | null = sampleMaxAgentCallsPerRun
let sentCount = 0

/** Puts the sample chat and guardrails back to the seed. */
export function resetSampleTeams(): void {
  storedChat = buildSeedChat()
  maxAgentCallsPerRun = sampleMaxAgentCallsPerRun
  sentCount = 0
}

function readGuardrails(teamAgentId: string): TeamGuardrails {
  return { agentId: teamAgentId, maxAgentCallsPerRun, unapprovedSendingSteps: [] }
}

function sendMessage(teamAgentId: string, message: string): Run {
  const goal = requireText(message, 'write a message first')
  sentCount += 1
  const now = new Date().toISOString()
  const runId = `sample-run-team-message-${sentCount}`
  storedChat = [
    ...storedChat,
    { runId, sentAt: now, message: goal, status: 'succeeded', replyText: coordinatorAcknowledgement, errorMessage: null, memberCalls: [], note: null },
  ]
  const outputs = { text: coordinatorAcknowledgement }
  return { id: runId, agentId: teamAgentId, agentVersion: 1, trigger: 'manual', status: 'succeeded', startedAt: now, finishedAt: now, outputs, errorMessage: null, errorType: null, pauseReasons: null }
}

export const sampleTeamsBackend = {
  listTeamActivity: (teamAgentId: string): Promise<TeamActivityEntry[]> =>
    respondWith(() =>
      teamActivity.map((activity, index) => ({
        id: `sample-activity-${index}`,
        at: sampleTimeToIso(activity.time),
        parts: activity.parts.map((part) => ({ text: part.text, isMember: part.isMember ?? false })),
        runId: 'sample-run-team-goal',
        agentId: teamAgentId,
      })),
    ),
  getTeamGuardrails: (teamAgentId: string): Promise<TeamGuardrails> => respondWith(() => readGuardrails(teamAgentId)),
  setTeamMaxAgentCalls: (teamAgentId: string, limit: number | null): Promise<TeamGuardrails> =>
    respondWith(() => {
      if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        throw new BackendError('invalid_input', 'the limit must be between 1 and 100 agent calls')
      }
      maxAgentCallsPerRun = limit
      return readGuardrails(teamAgentId)
    }),
  listCoordinatorChat: (_teamAgentId: string): Promise<CoordinatorExchange[]> => respondWith(() => storedChat.map((exchange) => ({ ...exchange }))),
  sendCoordinatorMessage: (teamAgentId: string, message: string): Promise<Run> => respondWith(() => sendMessage(teamAgentId, message)),
}
