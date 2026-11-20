import { BackendError } from '../client'
import { readPendingApprovals } from '../pauseReasons'
import type { AnsweredApproval, ApprovalAnswer, PendingApproval, RunInputs, RunReview } from '../runReviewTypes'
import type { Run } from '../types'
import { sampleRunsBackend } from './runs'
import { sampleTimestamp } from './sampleAgentCatalog'

/**
 * Sample run reviews for the browser preview and tests (screen 19).
 *
 * - {@link sampleReviewRunId}: a weekday scheduled run of "Maps leads to WhatsApp" whose
 *   parallel "For each place" iteration paused on 12 places at once, each with a drafted
 *   message (the `message` field's default) and "Send" / "Skip" actions. Answering removes
 *   the answered places; the run succeeds once none is left.
 * - Any other id is read from the sample runs backend (e.g. a scripted test run), from its
 *   pause reasons, and answered with its `resumeRun`.
 *
 * Call {@link resetSampleRunReview} in tests.
 */

export const sampleReviewRunId = 'maps-leads-review-0900'

const sampleReviewAgentId = 'maps-leads'
const iterationNodeId = 'for_each_place'
const approvalNodeId = 'approve_message'
/** Places the scheduled run found; the first 3 were already messaged and finished without asking. */
const placesFoundCount = 15
const alreadyFinishedCount = 3

type PlaceKind = 'Office' | 'Cafe' | 'School' | 'Clinic'

const placeSpecs: Array<{ kind: PlaceKind; score: number }> = [
  { kind: 'Office', score: 9 },
  { kind: 'Cafe', score: 8 },
  { kind: 'Office', score: 8 },
  { kind: 'Cafe', score: 4 },
  { kind: 'School', score: 8 },
  { kind: 'Office', score: 7 },
  { kind: 'Clinic', score: 7 },
  { kind: 'Cafe', score: 7 },
  { kind: 'Office', score: 6 },
  { kind: 'School', score: 6 },
  { kind: 'Office', score: 6 },
  { kind: 'Cafe', score: 5 },
]

function draftMessage(placeName: string, kind: PlaceKind): string {
  return kind === 'Cafe'
    ? `Halo tim ${placeName}, kami catering di Rajabasa dan ingin supply snack untuk cafe Anda. Boleh saya kirim daftar harga?`
    : `Halo tim ${placeName}, kami catering di Rajabasa. Untuk meeting atau acara kantor, boleh saya kirim menu nasi box kami?`
}

function buildSamplePending(): PendingApproval[] {
  return placeSpecs.map((placeSpec, position) => {
    const placeName = `[PLACE NAME ${position + 1}]`
    const index = alreadyFinishedCount + position
    const frame = `${iterationNodeId}[${index}]`
    const resumeKey = `${frame}/${approvalNodeId}`
    return {
      id: resumeKey,
      kind: 'form',
      nodeId: approvalNodeId,
      frame,
      resumeKey,
      stepTitle: 'Ask me before sending',
      prompt: null,
      fields: [{ name: 'message', label: 'Message', fieldType: 'paragraph', required: true, defaultValue: draftMessage(placeName, placeSpec.kind) }],
      actions: [
        { id: 'send', title: 'Send' },
        { id: 'skip', title: 'Skip' },
      ],
      timeoutMs: null,
      expiresAt: null,
      onTimeout: null,
      toolCall: null,
      container: {
        nodeId: iterationNodeId,
        nodeType: 'iteration',
        title: 'For each place',
        index,
        total: placesFoundCount,
        finished: alreadyFinishedCount,
        item: { name: placeName, kind: placeSpec.kind, score: placeSpec.score },
      },
    }
  })
}

let sampleReview: RunReview = buildSampleReview()

function buildSampleReview(): RunReview {
  return {
    runId: sampleReviewRunId,
    agentId: sampleReviewAgentId,
    agentName: 'Maps leads to WhatsApp',
    trigger: 'schedule',
    status: 'paused',
    startedAt: sampleTimestamp(0, 9, 0),
    pending: buildSamplePending(),
    otherPauseKinds: [],
    answered: [],
  }
}

/** Puts the sample scheduled run back to 12 places waiting. */
export function resetSampleRunReview(): void {
  sampleReview = buildSampleReview()
}

function copyReview(review: RunReview): RunReview {
  return JSON.parse(JSON.stringify(review)) as RunReview
}

function reviewAsRun(review: RunReview): Run {
  return {
    id: review.runId,
    agentId: review.agentId,
    agentVersion: 1,
    trigger: review.trigger,
    status: review.status,
    startedAt: review.startedAt,
    finishedAt: review.status === 'succeeded' ? new Date().toISOString() : null,
    outputs: null,
    errorMessage: null,
    pauseReasons: null,
  }
}

async function reviewSampleRun(runId: string): Promise<RunReview> {
  const run = await sampleRunsBackend.getRun(runId)
  return {
    runId: run.id,
    agentId: run.agentId,
    agentName: run.agentId === sampleReviewAgentId ? 'Maps leads to WhatsApp' : run.agentId,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    pending: readPendingApprovals(run),
    otherPauseKinds: [],
    answered: [],
  }
}

/** The button a form answer chose; tool call answers read as allow / decline. */
function readAnsweredAction(answer: ApprovalAnswer): string {
  if ('action' in answer) return answer.action
  return Object.values(answer.approvals).every(Boolean) ? 'allow' : 'decline'
}

/** @throws BackendError - `invalid_input` when the run is not paused or an answer names no pending question */
function answerSampleReview(answersByResumeKey: Record<string, ApprovalAnswer>): Run {
  if (sampleReview.status !== 'paused') throw new BackendError('invalid_input', `Run ${sampleReviewRunId} is not paused`)
  const answeredAt = new Date().toISOString()
  const unknownKey = Object.keys(answersByResumeKey).find((resumeKey) => !sampleReview.pending.some((pending) => pending.resumeKey === resumeKey))
  if (unknownKey) throw new BackendError('invalid_input', `Nothing waits on ${unknownKey}`)
  const newlyAnswered: AnsweredApproval[] = sampleReview.pending
    .filter((pending) => answersByResumeKey[pending.resumeKey])
    .map((pending) => ({ nodeId: pending.nodeId, frame: pending.frame, action: readAnsweredAction(answersByResumeKey[pending.resumeKey]), index: pending.container?.index ?? null, answeredAt }))
  const pending = sampleReview.pending.filter((approval) => !answersByResumeKey[approval.resumeKey])
  sampleReview = { ...sampleReview, pending, answered: [...sampleReview.answered, ...newlyAnswered], status: pending.length === 0 ? 'succeeded' : 'paused' }
  return reviewAsRun(sampleReview)
}

export const sampleRunReviewBackend = {
  getRunReview: async (runId: string | null): Promise<RunReview | null> => {
    if (runId === null || runId === sampleReviewRunId) return copyReview(sampleReview)
    return reviewSampleRun(runId)
  },

  answerApprovals: async (runId: string, answersByResumeKey: Record<string, ApprovalAnswer>): Promise<Run> => {
    if (runId === sampleReviewRunId) return answerSampleReview(answersByResumeKey)
    return sampleRunsBackend.resumeRun(runId, answersByResumeKey)
  },

  getRunInputs: (runId: string): Promise<RunInputs | null> => sampleRunsBackend.getRunInputs(runId),

  getLastRunInputs: (agentId: string): Promise<RunInputs | null> => sampleRunsBackend.getLastRunInputs(agentId),
}
