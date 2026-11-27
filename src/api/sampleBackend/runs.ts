import { BackendError } from '../client'
import type { GraphrtEvent, Run, RunEventPayload, RunEventRecord, RunFilter, RunStatus, RunTrigger } from '../types'
import { readStoredAgent } from './sampleAgentStore'
import { buildSampleApprovalPauseData, sampleDraftMessage, sampleMapsLeadsInputs, sampleTestPlaces } from './sampleTestRun'
import { buildSeededRuns } from './sampleRunSeed'

/**
 * Sample runs for the browser preview and tests, kept in memory.
 *
 * - The history is seeded from the Runs screen (20).
 * - `startRun` plays the "Maps leads to WhatsApp" test with small timers: ask input → search Google Maps
 *   → for each place: write a message → pause on `approve_message` with graphrt's `human-input` pause
 *   data (`{ prompt, fields, actions }`, the drafted message as the `message` field's default).
 * - The inputs each run started with are kept, like the desktop's `run_inputs` table.
 * - `resumeRun` continues to success: approve sends the (edited) message, skip ends without sending.
 *   Outputs follow the run output convention (`summary`, `items`, `places_found`, `messages_sent`).
 *
 * Every event goes to {@link sampleRunsBackend.subscribeToRunEvents} subscribers, like the Tauri `run-event`.
 * Call {@link resetSampleRuns} in tests; scripted steps are {@link sampleRunStepDelayMs} apart.
 */

/** Delay between two scripted events. Tests advance fake timers by this much per step. */
export const sampleRunStepDelayMs = 300

/** Scripted steps (events) a sample test run plays before it pauses for approval. */
export const sampleStepsUntilApproval = 15

/** Node the scripted test run pauses on. */
export const sampleApprovalNodeId = 'approve_message'

const placesFoundCount = 18

/** Token usage the scripted "Write a short message" step reports. */
const sampleWriteMessageUsage = { prompt_tokens: 180, completion_tokens: 32, total_tokens: 212 }

interface ScriptStep {
  event: GraphrtEvent
  /** Applied to the run before the event is sent. */
  changeRun?: (run: Run) => Run
}

let storedRuns: Run[] = []
let eventsByRunId = new Map<string, RunEventRecord[]>()
let runSubscribers = new Set<(payload: RunEventPayload) => void>()
let scriptTimersByRunId = new Map<string, ReturnType<typeof setTimeout>>()
let inputsByRunId = new Map<string, Record<string, unknown>>()
let startedRunCount = 0

/** Seeded runs of the sample agent that started with {@link sampleMapsLeadsInputs}. */
const seededMapsLeadsRunIds = ['maps-leads-0900', 'maps-leads-test']

/** Puts the runs back to the seeded history, drops subscribers and stops scripted runs. */
export function resetSampleRuns(): void {
  scriptTimersByRunId.forEach((timer) => clearTimeout(timer))
  scriptTimersByRunId = new Map()
  runSubscribers = new Set()
  startedRunCount = 0
  const seededRuns = buildSeededRuns(Date.now())
  storedRuns = seededRuns.map((seededRun) => seededRun.run)
  inputsByRunId = new Map(seededMapsLeadsRunIds.map((runId) => [runId, { ...sampleMapsLeadsInputs }]))
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

/** Plays steps one after another, `delayMs` ({@link sampleRunStepDelayMs}) apart. */
function playScript(runId: string, steps: ScriptStep[], delayMs = sampleRunStepDelayMs): void {
  const [nextStep, ...remainingSteps] = steps
  if (!nextStep) {
    scriptTimersByRunId.delete(runId)
    return
  }
  const timer = setTimeout(() => {
    applyScriptStep(runId, nextStep)
    playScript(runId, remainingSteps, delayMs)
  }, delayMs)
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

/** Frame of the first (and, in a test, only) place inside the `for_each_place` iteration. */
const firstPlaceFrame = 'for_each_place[0]'

/** The places a test works through: the first one the search found. */
const testedPlaces = sampleTestPlaces.slice(0, 1)

/** The drafted message as the model streams it, a few words per `node_chunk`. */
function splitIntoChunks(text: string, chunkCount: number): string[] {
  const words = text.split(' ')
  const wordsPerChunk = Math.ceil(words.length / chunkCount)
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const chunkWords = words.slice(chunkIndex * wordsPerChunk, (chunkIndex + 1) * wordsPerChunk).join(' ')
    return chunkIndex === 0 ? chunkWords : ` ${chunkWords}`
  })
}

/** Events of the scripted test until it pauses for approval, shaped like graphrt's (frames, kinds, outputs). */
function buildTestRunScript(inputs: Record<string, unknown>): ScriptStep[] {
  const pauseData = buildSampleApprovalPauseData()
  const inPlace = { frame: firstPlaceFrame }
  return [
    nodeEvent('node_started', 'ask_input', { frame: '', title: 'Ask for keyword, city and offer', kind: 'start', attempt: 1 }),
    nodeEvent('node_succeeded', 'ask_input', { frame: '', outputs: inputs, elapsed_ms: 0 }),
    nodeEvent('node_started', 'search_maps', { frame: '', title: 'Search Google Maps', kind: 'http-request', attempt: 1 }),
    nodeEvent('node_succeeded', 'search_maps', { frame: '', outputs: { places: testedPlaces, places_found: placesFoundCount }, elapsed_ms: 1200 }),
    nodeEvent('node_started', 'for_each_place', { frame: '', title: 'For each place', kind: 'iteration', attempt: 1 }),
    nodeEvent('node_progress', 'for_each_place', { frame: '', name: 'iteration_next', data: { index: 0, total: testedPlaces.length } }),
    nodeEvent('node_started', 'write_message', { ...inPlace, title: 'Write a short message', kind: 'llm', attempt: 1 }),
    ...splitIntoChunks(sampleDraftMessage, 3).map((chunk) => nodeEvent('node_chunk', 'write_message', { ...inPlace, field: 'text', chunk })),
    nodeEvent('node_succeeded', 'write_message', { ...inPlace, outputs: { text: sampleDraftMessage }, elapsed_ms: 2400, usage: sampleWriteMessageUsage }),
    nodeEvent('node_started', sampleApprovalNodeId, { ...inPlace, title: 'Ask me before sending', kind: 'human-input', attempt: 1 }),
    nodeEvent('node_paused', sampleApprovalNodeId, { ...inPlace, kind: 'human_input' }),
    {
      event: { type: 'run_paused' },
      changeRun: (run) => ({ ...run, status: 'paused', pauseReasons: [{ frame: '', node_id: sampleApprovalNodeId, kind: 'human_input', data: pauseData }] }),
    },
  ]
}

function finishTestRun(outputs: Record<string, unknown>): ScriptStep {
  return {
    event: { type: 'run_succeeded', outputs },
    changeRun: (run) => ({ ...run, status: 'succeeded', finishedAt: new Date().toISOString(), outputs }),
  }
}

/** The places of the test run as run output `items`: the first one tested, the rest not in the test. */
function buildTestRunItems(firstPlaceStatus: 'sent' | 'skipped'): Array<Record<string, string>> {
  return sampleTestPlaces.map((place, index) => ({ name: place.name, phone: place.phone, status: index === 0 ? firstPlaceStatus : 'not in test' }))
}

function buildApprovedScript(message: string): ScriptStep[] {
  const sentPlaceName = sampleTestPlaces[0]?.name ?? 'the first place'
  const inPlace = { frame: firstPlaceFrame }
  return [
    nodeEvent('node_succeeded', sampleApprovalNodeId, { ...inPlace, outputs: { action: 'approve', values: { message } }, branch: 'approve', elapsed_ms: 0 }),
    nodeEvent('node_started', 'send_whatsapp', { ...inPlace, title: 'Send WhatsApp', kind: 'http-request', attempt: 1 }),
    nodeEvent('node_succeeded', 'send_whatsapp', { ...inPlace, outputs: { status_code: 200, body: { status: 'sent', to: sampleTestPlaces[0]?.phone } }, elapsed_ms: 800 }),
    nodeEvent('node_succeeded', 'for_each_place', { frame: '', outputs: { output: [{ status: 'sent' }], errors: [] }, elapsed_ms: 4100 }),
    finishTestRun({
      summary: `Sent the test message to ${sentPlaceName}.`,
      items: buildTestRunItems('sent'),
      places_found: placesFoundCount,
      messages_sent: 1,
      aiCostUsd: 0.004,
      sent_message: message,
    }),
  ]
}

function buildSkippedScript(): ScriptStep[] {
  const inPlace = { frame: firstPlaceFrame }
  return [
    nodeEvent('node_succeeded', sampleApprovalNodeId, { ...inPlace, outputs: { action: 'skip', values: {} }, branch: 'skip', elapsed_ms: 0 }),
    nodeEvent('node_skipped', 'send_whatsapp', inPlace),
    nodeEvent('node_succeeded', 'for_each_place', { frame: '', outputs: { output: [null], errors: [] }, elapsed_ms: 3300 }),
    finishTestRun({
      summary: 'Skipped the test message, so nothing was sent.',
      items: buildTestRunItems('skipped'),
      places_found: placesFoundCount,
      messages_sent: 0,
      aiCostUsd: 0.003,
      skipped: true,
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

/** The agent's current version, so the Runs screen reads the steps the run went through; 1 for unknown agents. */
function readCurrentVersion(agentId: string): number {
  try {
    return readStoredAgent(agentId).currentVersion
  } catch {
    return 1
  }
}

function matchesFilter(run: Run, filter?: RunFilter): boolean {
  if (filter?.agentId && run.agentId !== filter.agentId) return false
  if (filter?.status && run.status !== filter.status) return false
  return true
}

/** Businesses the error path demo goes through; items 4 and 8 are skipped at the approval. */
const errorPathItemCount = 12
const errorPathSkippedIndexes = new Set([3, 7])

function playedItem(index: number): ScriptStep[] {
  const frame = { frame: `for_each_place[${index}]` }
  const branch = errorPathSkippedIndexes.has(index) ? 'skip' : 'send'
  return [
    nodeEvent('node_progress', 'for_each_place', { frame: '', name: 'iteration_next', data: { index, total: errorPathItemCount } }),
    nodeEvent('node_started', 'write_message', { ...frame, kind: 'llm', attempt: 1 }),
    nodeEvent('node_succeeded', 'write_message', { ...frame, outputs: { text: sampleDraftMessage }, elapsed_ms: 1800 }),
    nodeEvent('node_started', sampleApprovalNodeId, { ...frame, kind: 'human-input', attempt: 1 }),
    nodeEvent('node_succeeded', sampleApprovalNodeId, { ...frame, outputs: { action: branch }, branch, elapsed_ms: 0 }),
    branch === 'send'
      ? nodeEvent('node_succeeded', 'send_whatsapp', { ...frame, outputs: { status_code: 200 }, elapsed_ms: 700 })
      : nodeEvent('node_skipped', 'send_whatsapp', frame),
  ]
}

/** Item 11: the model is out of credit (fallback values), then the send times out three times (error path). */
function failingItem(index: number): ScriptStep[] {
  const frame = { frame: `for_each_place[${index}]` }
  const timeout = 'The service took too long to answer'
  return [
    nodeEvent('node_progress', 'for_each_place', { frame: '', name: 'iteration_next', data: { index, total: errorPathItemCount } }),
    nodeEvent('node_started', 'write_message', { ...frame, kind: 'llm', attempt: 1 }),
    nodeEvent('node_failed', 'write_message', { ...frame, error: 'The model was out of credit', error_type: 'provider', handled: true, outputs: { text: 'Hello! We would love to share our catering menu.', error_message: 'The model was out of credit', error_type: 'provider' }, elapsed_ms: 400 }),
    nodeEvent('node_started', sampleApprovalNodeId, { ...frame, kind: 'human-input', attempt: 1 }),
    nodeEvent('node_succeeded', sampleApprovalNodeId, { ...frame, outputs: { action: 'send' }, branch: 'send', elapsed_ms: 0 }),
    nodeEvent('node_started', 'send_whatsapp', { ...frame, kind: 'whatsapp-web.send_message', attempt: 1 }),
    nodeEvent('node_retry', 'send_whatsapp', { ...frame, attempt: 1, error: timeout, delay_ms: 2000 }),
    nodeEvent('node_started', 'send_whatsapp', { ...frame, kind: 'whatsapp-web.send_message', attempt: 2 }),
    nodeEvent('node_retry', 'send_whatsapp', { ...frame, attempt: 2, error: timeout, delay_ms: 4000 }),
    nodeEvent('node_started', 'send_whatsapp', { ...frame, kind: 'whatsapp-web.send_message', attempt: 3 }),
    nodeEvent('node_failed', 'send_whatsapp', { ...frame, error: timeout, error_type: 'timeout', handled: true, outputs: { error_message: timeout, error_type: 'timeout' }, elapsed_ms: 30000 }),
  ]
}

function buildErrorPathScript(): ScriptStep[] {
  const playedItems = Array.from({ length: 10 }, (_, index) => playedItem(index)).flat()
  return [
    nodeEvent('node_started', 'ask_input', { frame: '', kind: 'start', attempt: 1 }),
    nodeEvent('node_succeeded', 'ask_input', { frame: '', outputs: sampleMapsLeadsInputs, elapsed_ms: 0 }),
    nodeEvent('node_started', 'search_maps', { frame: '', kind: 'google-maps-scraper.search', attempt: 1 }),
    nodeEvent('node_succeeded', 'search_maps', { frame: '', outputs: { places_found: errorPathItemCount }, elapsed_ms: 5200 }),
    nodeEvent('node_started', 'for_each_place', { frame: '', kind: 'iteration', attempt: 1 }),
    ...playedItems,
    ...failingItem(10),
  ]
}

function createSampleRun(agentId: string, changes: Partial<Run> = {}): Run {
  startedRunCount += 1
  const run: Run = {
    id: `sample-run-${startedRunCount}`,
    agentId,
    agentVersion: readCurrentVersion(agentId),
    trigger: 'test',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    errorType: null,
    pauseReasons: null,
    ...changes,
  }
  storedRuns = [run, ...storedRuns]
  eventsByRunId.set(run.id, [])
  return run
}

/**
 * Starts the Nodes view's error path demo (spec 44) on a sample agent: 12 businesses, 8 sent and 2
 * skipped, then on business 11 the model step fails into its fallback values and the send step
 * fails three times into its error path. The run stays running there (browser preview, screenshots).
 */
export function startSampleErrorPathRun(agentId = 'maps-leads', delayMs = 40): Run {
  const run = createSampleRun(agentId)
  inputsByRunId.set(run.id, { ...sampleMapsLeadsInputs })
  playScript(run.id, [{ event: { type: 'run_started', run_id: run.id, resumed: false } }, ...buildErrorPathScript()], delayMs)
  return { ...run }
}

/**
 * Adds a run with all its events at once (tests): no timers, nothing sent to subscribers.
 *
 * @example
 * addSampleRun('maps-leads', { status: 'paused', events: [{ type: 'node_started', node_id: 'search_maps' }] })
 */
export function addSampleRun(agentId: string, options: { events: GraphrtEvent[]; status?: RunStatus; pauseReasons?: Run['pauseReasons']; startedAt?: string }): Run {
  const run = createSampleRun(agentId, { status: options.status ?? 'running', pauseReasons: options.pauseReasons ?? null, startedAt: options.startedAt ?? new Date(Date.now() - 60_000).toISOString() })
  const createdAt = new Date().toISOString()
  eventsByRunId.set(run.id, options.events.map((event, index) => ({ runId: run.id, seq: index + 1, event, createdAt })))
  return { ...run }
}

export const sampleRunsBackend = {
  startRun: (agentId: string, trigger: RunTrigger, inputs: Record<string, unknown>): Promise<Run> =>
    respond(() => {
      startedRunCount += 1
      const run: Run = {
        id: `sample-run-${startedRunCount}`,
        agentId,
        agentVersion: readCurrentVersion(agentId),
        trigger,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        outputs: null,
        errorMessage: null,
        errorType: null,
        pauseReasons: null,
      }
      storedRuns = [run, ...storedRuns]
      eventsByRunId.set(run.id, [])
      inputsByRunId.set(run.id, { ...inputs })
      playScript(run.id, [{ event: { type: 'run_started', run_id: run.id, resumed: false, inputs } }, ...buildTestRunScript(inputs)])
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

  /** Inputs the run started with; null when unknown. */
  getRunInputs: (runId: string): Promise<Record<string, unknown> | null> =>
    respond(() => {
      findRun(runId)
      const inputs = inputsByRunId.get(runId)
      return inputs ? { ...inputs } : null
    }),

  /** Inputs of the agent's newest run that has them; null when none. */
  getLastRunInputs: (agentId: string): Promise<Record<string, unknown> | null> =>
    respond(() => {
      const newestRun = storedRuns
        .filter((run) => run.agentId === agentId && inputsByRunId.has(run.id))
        .sort((first, second) => second.startedAt.localeCompare(first.startedAt))[0]
      const inputs = newestRun ? inputsByRunId.get(newestRun.id) : undefined
      return inputs ? { ...inputs } : null
    }),

  subscribeToRunEvents: (onRunEvent: (payload: RunEventPayload) => void): Promise<() => void> => {
    runSubscribers.add(onRunEvent)
    return Promise.resolve(() => {
      runSubscribers.delete(onRunEvent)
    })
  },
}
