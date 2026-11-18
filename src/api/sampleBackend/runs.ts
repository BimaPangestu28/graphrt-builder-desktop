import { BackendError } from '../client'
import type { GraphrtEvent, Run, RunEventPayload, RunEventRecord, RunFilter, RunStatus, RunTrigger } from '../types'
import { pendingApproval, testRunPlaces } from '@/data/testRun'
import { buildSeededRuns } from './sampleRunSeed'

/**
 * Sample runs for the browser preview and tests, kept in memory.
 *
 * - The history is seeded from the Runs screen (20).
 * - `startRun` plays the "Maps leads to WhatsApp" test with small timers: ask input → search Google Maps
 *   → write a message → pause on `approve_message` with the drafted message in the pause reason's `data`.
 * - `resumeRun` continues to success: approve sends the (edited) message, skip ends without sending.
 *
 * Every event goes to {@link sampleRunsBackend.subscribeToRunEvents} subscribers, like the Tauri `run-event`.
 * Call {@link resetSampleRuns} in tests; scripted steps are {@link sampleRunStepDelayMs} apart.
 */

/** Delay between two scripted events. Tests advance fake timers by this much per step. */
export const sampleRunStepDelayMs = 300

/** Node the scripted test run pauses on. */
export const sampleApprovalNodeId = 'approve_message'

const placesFoundCount = 18

/** The pause reason `data` of the scripted test run. */
export interface SampleApprovalRequest {
  question: string
  recipient: string
  message: string
}

interface ScriptStep {
  event: GraphrtEvent
  /** Applied to the run before the event is sent. */
  changeRun?: (run: Run) => Run
}

let storedRuns: Run[] = []
let eventsByRunId = new Map<string, RunEventRecord[]>()
let runSubscribers = new Set<(payload: RunEventPayload) => void>()
let scriptTimersByRunId = new Map<string, ReturnType<typeof setTimeout>>()
let startedRunCount = 0

/** Puts the runs back to the seeded history, drops subscribers and stops scripted runs. */
export function resetSampleRuns(): void {
  scriptTimersByRunId.forEach((timer) => clearTimeout(timer))
  scriptTimersByRunId = new Map()
  runSubscribers = new Set()
  startedRunCount = 0
  const seededRuns = buildSeededRuns(Date.now())
  storedRuns = seededRuns.map((seededRun) => seededRun.run)
  eventsByRunId = new Map(
    seededRuns.map((seededRun) => [
      seededRun.run.id,
      seededRun.events.map(({ event, createdAt }, index) => ({ runId: seededRun.run.id, seq: index + 1, event, createdAt })),
    ]),
  )
}

resetSampleRuns()

function findRun(runId: string): Run {
  const run = storedRuns.find((storedRun) => storedRun.id === runId)
  if (!run) throw new BackendError('not_found', `No run ${runId}`)
  return run
}

function saveRun(changedRun: Run): void {
  storedRuns = storedRuns.map((storedRun) => (storedRun.id === changedRun.id ? changedRun : storedRun))
}

function notifySubscribers(payload: RunEventPayload): void {
  runSubscribers.forEach((onRunEvent) => {
    try {
      onRunEvent(payload)
    } catch (subscriberError) {
      console.error('Run event subscriber failed', subscriberError)
    }
  })
}

/** Records an event for the run and sends it, plus `status_changed` when the status moved. */
function emitRunEvent(run: Run, event: GraphrtEvent, previousStatus: RunStatus): void {
  const runEvents = eventsByRunId.get(run.id) ?? []
  const appendAndSend = (eventToSend: GraphrtEvent) => {
    const record: RunEventRecord = { runId: run.id, seq: runEvents.length + 1, event: eventToSend, createdAt: new Date().toISOString() }
    runEvents.push(record)
    notifySubscribers({ runId: run.id, agentId: run.agentId, seq: record.seq, status: run.status, event: eventToSend })
  }
  eventsByRunId.set(run.id, runEvents)
  appendAndSend(event)
  if (run.status !== previousStatus) appendAndSend({ type: 'status_changed', from: previousStatus, to: run.status })
}

function applyScriptStep(runId: string, step: ScriptStep): void {
  const run = findRun(runId)
  const changedRun = step.changeRun ? step.changeRun(run) : run
  saveRun(changedRun)
  emitRunEvent(changedRun, step.event, run.status)
}

/** Plays steps one after another, {@link sampleRunStepDelayMs} apart. */
function playScript(runId: string, steps: ScriptStep[]): void {
  const [nextStep, ...remainingSteps] = steps
  if (!nextStep) {
    scriptTimersByRunId.delete(runId)
    return
  }
  const timer = setTimeout(() => {
    applyScriptStep(runId, nextStep)
    playScript(runId, remainingSteps)
  }, sampleRunStepDelayMs)
  scriptTimersByRunId.set(runId, timer)
}

function stopScript(runId: string): void {
  const timer = scriptTimersByRunId.get(runId)
  if (timer) clearTimeout(timer)
  scriptTimersByRunId.delete(runId)
}

function nodeEvent(type: string, nodeId: string, fields: Record<string, unknown> = {}): ScriptStep {
  return { event: { type, node_id: nodeId, ...fields } }
}

function buildApprovalRequest(): SampleApprovalRequest {
  return { question: 'Send this message?', recipient: pendingApproval.recipientSummary, message: pendingApproval.draftMessage }
}

function buildTestRunScript(): ScriptStep[] {
  const approvalRequest = buildApprovalRequest()
  return [
    nodeEvent('node_started', 'ask_input', { title: 'Ask for keyword, city and offer' }),
    nodeEvent('node_succeeded', 'ask_input', { detail: '0.0s', duration_ms: 0 }),
    nodeEvent('node_started', 'search_maps', { title: 'Search Google Maps' }),
    nodeEvent('node_succeeded', 'search_maps', { detail: `${placesFoundCount} places · 1.2s`, duration_ms: 1200, places_found: placesFoundCount }),
    nodeEvent('node_started', 'write_message', { title: 'Write a short message' }),
    nodeEvent('node_succeeded', 'write_message', { detail: '212 tokens · 2.4s', duration_ms: 2400 }),
    nodeEvent('node_started', sampleApprovalNodeId, { title: 'Ask me before sending' }),
    nodeEvent('node_paused', sampleApprovalNodeId, { kind: 'human_input' }),
    {
      event: { type: 'run_paused' },
      changeRun: (run) => ({ ...run, status: 'paused', pauseReasons: [{ node_id: sampleApprovalNodeId, kind: 'human_input', data: approvalRequest }] }),
    },
  ]
}

function finishTestRun(outputs: Record<string, unknown>): ScriptStep {
  return {
    event: { type: 'run_succeeded', outputs },
    changeRun: (run) => ({ ...run, status: 'succeeded', finishedAt: new Date().toISOString(), outputs }),
  }
}

function buildApprovedScript(message: string): ScriptStep[] {
  const places = testRunPlaces.map((place, index) => ({ ...place, outcome: index === 0 ? 'Sent' : 'Not in test' }))
  return [
    nodeEvent('node_succeeded', sampleApprovalNodeId, { detail: 'Approved' }),
    nodeEvent('node_started', 'send_whatsapp', { title: 'Send WhatsApp' }),
    nodeEvent('node_succeeded', 'send_whatsapp', { detail: '1 sent' }),
    finishTestRun({ summary: 'Test · 1 sent', placesFound: placesFoundCount, messagesSent: 1, sentMessage: message, aiCostUsd: 0.004, places }),
  ]
}

function buildSkippedScript(): ScriptStep[] {
  return [
    nodeEvent('node_skipped', sampleApprovalNodeId, { detail: 'Skipped' }),
    nodeEvent('node_skipped', 'send_whatsapp'),
    finishTestRun({
      summary: 'Test · skipped',
      placesFound: placesFoundCount,
      messagesSent: 0,
      skipped: true,
      aiCostUsd: 0.003,
      places: testRunPlaces.map((place) => ({ ...place, outcome: 'Not in test' })),
    }),
  ]
}

interface ApprovalAnswer {
  action: 'approve' | 'skip'
  message: string
}

/** @throws BackendError - `invalid_input` when the answer for the paused node is missing or malformed */
function readApprovalAnswer(run: Run, nodeInputs: Record<string, unknown>): ApprovalAnswer {
  const pausedNodeId = run.pauseReasons?.[0]?.node_id ?? sampleApprovalNodeId
  const answer = nodeInputs[pausedNodeId]
  if (!answer || typeof answer !== 'object') throw new BackendError('invalid_input', `Missing an answer for ${pausedNodeId}`)
  const { action, values } = answer as { action?: unknown; values?: unknown }
  if (action !== 'approve' && action !== 'skip') throw new BackendError('invalid_input', `Unknown action for ${pausedNodeId}`)
  const message = values && typeof values === 'object' && typeof (values as { message?: unknown }).message === 'string' ? (values as { message: string }).message : ''
  return { action, message }
}

function respond<Result>(operation: () => Result): Promise<Result> {
  try {
    return Promise.resolve(operation())
  } catch (operationError) {
    return Promise.reject(operationError)
  }
}

function matchesFilter(run: Run, filter?: RunFilter): boolean {
  if (filter?.agentId && run.agentId !== filter.agentId) return false
  if (filter?.status && run.status !== filter.status) return false
  return true
}

export const sampleRunsBackend = {
  startRun: (agentId: string, trigger: RunTrigger, inputs: Record<string, unknown>): Promise<Run> =>
    respond(() => {
      startedRunCount += 1
      const run: Run = {
        id: `sample-run-${startedRunCount}`,
        agentId,
        agentVersion: 1,
        trigger,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        outputs: null,
        errorMessage: null,
        pauseReasons: null,
      }
      storedRuns = [run, ...storedRuns]
      eventsByRunId.set(run.id, [])
      playScript(run.id, [{ event: { type: 'run_started', inputs } }, ...buildTestRunScript()])
      return { ...run }
    }),

  resumeRun: (runId: string, nodeInputs: Record<string, unknown>): Promise<Run> =>
    respond(() => {
      const run = findRun(runId)
      if (run.status !== 'paused') throw new BackendError('invalid_input', `Run ${runId} is not waiting for input`)
      const answer = readApprovalAnswer(run, nodeInputs)
      const resumedRun: Run = { ...run, status: 'running', pauseReasons: null }
      saveRun(resumedRun)
      emitRunEvent(resumedRun, { type: 'run_resumed', node_id: run.pauseReasons?.[0]?.node_id ?? sampleApprovalNodeId }, run.status)
      playScript(runId, answer.action === 'approve' ? buildApprovedScript(answer.message) : buildSkippedScript())
      return { ...resumedRun }
    }),

  abortRun: (runId: string): Promise<void> =>
    respond(() => {
      const run = findRun(runId)
      if (run.status !== 'running' && run.status !== 'paused') return
      stopScript(runId)
      const abortedRun: Run = { ...run, status: 'aborted', finishedAt: new Date().toISOString(), pauseReasons: null }
      saveRun(abortedRun)
      emitRunEvent(abortedRun, { type: 'run_aborted' }, run.status)
    }),

  listRuns: (filter?: RunFilter): Promise<Run[]> =>
    respond(() => {
      const matchingRuns = storedRuns
        .filter((run) => matchesFilter(run, filter))
        .sort((first, second) => second.startedAt.localeCompare(first.startedAt))
        .map((run) => ({ ...run }))
      return filter?.limit ? matchingRuns.slice(0, filter.limit) : matchingRuns
    }),

  getRun: (runId: string): Promise<Run> => respond(() => ({ ...findRun(runId) })),

  listRunEvents: (runId: string): Promise<RunEventRecord[]> =>
    respond(() => {
      findRun(runId)
      return [...(eventsByRunId.get(runId) ?? [])]
    }),

  subscribeToRunEvents: (onRunEvent: (payload: RunEventPayload) => void): Promise<() => void> => {
    runSubscribers.add(onRunEvent)
    return Promise.resolve(() => {
      runSubscribers.delete(onRunEvent)
    })
  },
}
