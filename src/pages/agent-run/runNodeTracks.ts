import type { GraphrtEvent, RunEventRecord } from '@/api/types'
import type { TestRunStepState } from '@/pages/agent-run/testRunTypes'
import { readChosenActionId, readPauseActionTitles } from './approvalAnswers'
import { isHelperFrame } from './runAbilityEvents'
import { isRecord, readFrame, readNumber, readString } from './runEventValues'
import { messages } from '@/i18n'

/**
 * Replays a run's graphrt events into one track per node, with one execution per frame
 * (a node inside an iteration runs once per item, in frames `each_place[0]`, `each_place[1]`…).
 * `runSteps.ts` turns the tracks into the step list.
 */

/** Token usage graphrt reports on `node_succeeded`. */
export interface StepTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** A structured progress report (`node_progress`): `iteration_next`, `loop_next`, `agent_thought`… */
export interface NodeProgressReport {
  seq: number
  name: string
  data: unknown
}

/** One run of a node in one frame. */
export interface NodeExecution {
  frame: string
  state: TestRunStepState
  /** `createdAt` of the event that started this execution. */
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  retryCount: number
  lastRetryError: string | null
  /** Streamed text per output field (`node_chunk`), joined in order. */
  textByField: Record<string, string>
  outputs: Record<string, unknown> | null
  inputs: unknown
  errorMessage: string | null
  /** `error_type` of the failure: the plugin's or graphrt's error kind (`setup_required`, `timeout`…). */
  errorType: string | null
  usage: StepTokenUsage | null
  /** Display text some events carry (`detail`), e.g. from the sample run. */
  detail: string | null
  progressReports: NodeProgressReport[]
  /** Set while the whole run waits; cleared when it resumes. */
  isWaitingWithRun: boolean
  /** Button id → title of the question this execution asked (`node_paused`), kept over the resume. */
  pauseActionTitles: ReadonlyMap<string, string> | null
  /** The button the question was answered with (`outputs.action`), once it was. */
  chosenActionId: string | null
}

export interface NodeTrack {
  nodeId: string
  title: string | null
  kind: string | null
  firstSeq: number
  /** Frame of the node's latest event. */
  lastFrame: string
  executionsByFrame: Map<string, NodeExecution>
}

function createExecution(frame: string, startedAt: string | null): NodeExecution {
  return {
    frame,
    state: 'running',
    startedAt,
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    lastRetryError: null,
    textByField: {},
    outputs: null,
    inputs: undefined,
    errorMessage: null,
    errorType: null,
    usage: null,
    detail: null,
    progressReports: [],
    isWaitingWithRun: false,
    pauseActionTitles: null,
    chosenActionId: null,
  }
}

function readUsage(usage: unknown): StepTokenUsage | null {
  const totalTokens = readNumber(usage, 'total_tokens')
  if (totalTokens === null) return null
  return { promptTokens: readNumber(usage, 'prompt_tokens') ?? 0, completionTokens: readNumber(usage, 'completion_tokens') ?? 0, totalTokens }
}

function readDurationMs(event: GraphrtEvent): number | null {
  return readNumber(event, 'elapsed_ms') ?? readNumber(event, 'duration_ms')
}

function finishExecution(execution: NodeExecution, record: RunEventRecord, state: TestRunStepState): void {
  const { event } = record
  execution.state = state
  execution.finishedAt = record.createdAt
  execution.durationMs = readDurationMs(event) ?? measureMs(execution.startedAt, record.createdAt)
  if (isRecord(event.outputs)) execution.outputs = event.outputs
  execution.detail = readString(event, 'detail') ?? execution.detail
}

function measureMs(startedAt: string | null, finishedAt: string): number | null {
  if (!startedAt) return null
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null
}

/** Applies one node event to its execution. */
function applyNodeEvent(execution: NodeExecution, record: RunEventRecord): void {
  const { event } = record
  execution.isWaitingWithRun = false
  switch (event.type) {
    case 'node_chunk': {
      const field = readString(event, 'field') ?? 'text'
      const chunk = typeof event.chunk === 'string' ? event.chunk : ''
      execution.textByField = { ...execution.textByField, [field]: (execution.textByField[field] ?? '') + chunk }
      execution.state = 'running'
      return
    }
    case 'node_progress':
      execution.progressReports.push({ seq: record.seq, name: readString(event, 'name') ?? '', data: event.data })
      execution.state = 'running'
      return
    case 'node_retry':
      execution.retryCount += 1
      execution.lastRetryError = readString(event, 'error')
      execution.state = 'running'
      return
    case 'node_succeeded':
      finishExecution(execution, record, 'done')
      execution.usage = readUsage(event.usage)
      if (execution.pauseActionTitles) execution.chosenActionId = readChosenActionId(event)
      return
    case 'node_failed':
      finishExecution(execution, record, 'failed')
      execution.errorMessage = readString(event, 'error') ?? messages().agentRun.thisStepFailed
      execution.errorType = readString(event, 'error_type')
      return
    case 'node_skipped':
      finishExecution(execution, record, 'skipped')
      return
    case 'node_paused': {
      execution.state = 'waiting'
      execution.pauseActionTitles = readPauseActionTitles(event) ?? execution.pauseActionTitles
      return
    }
  }
}

const nodeEventTypes = new Set(['node_started', 'node_chunk', 'node_progress', 'node_retry', 'node_succeeded', 'node_failed', 'node_skipped', 'node_paused'])

function startExecution(track: NodeTrack, record: RunEventRecord, frame: string): NodeExecution {
  const previous = track.executionsByFrame.get(frame)
  const attempt = readNumber(record.event, 'attempt') ?? 1
  const execution = createExecution(frame, record.createdAt)
  execution.retryCount = Math.max(previous && previous.state === 'running' ? previous.retryCount : 0, attempt - 1)
  execution.lastRetryError = previous?.lastRetryError ?? null
  execution.inputs = record.event.inputs
  // A resumed question starts again: what it asked is still what the answer chose from.
  execution.pauseActionTitles = previous?.pauseActionTitles ?? null
  track.executionsByFrame.set(frame, execution)
  return execution
}

function trackNodeEvent(tracksByNodeId: Map<string, NodeTrack>, record: RunEventRecord, nodeId: string): void {
  const { event } = record
  const frame = readFrame(event)
  const track = tracksByNodeId.get(nodeId) ?? { nodeId, title: null, kind: null, firstSeq: record.seq, lastFrame: frame, executionsByFrame: new Map() }
  tracksByNodeId.set(nodeId, track)
  track.title = readString(event, 'title') ?? track.title
  if (event.type === 'node_started') track.kind = readString(event, 'kind') ?? track.kind
  track.lastFrame = frame
  const execution = event.type === 'node_started' ? startExecution(track, record, frame) : (track.executionsByFrame.get(frame) ?? startExecution(track, record, frame))
  applyNodeEvent(execution, record)
}

function forEachExecution(tracksByNodeId: Map<string, NodeTrack>, visit: (execution: NodeExecution) => void): void {
  tracksByNodeId.forEach((track) => track.executionsByFrame.forEach(visit))
}

/** Run-level events change what unfinished executions mean: paused, stopped or failed with the run. */
function applyRunEvent(tracksByNodeId: Map<string, NodeTrack>, record: RunEventRecord): void {
  const { type } = record.event
  forEachExecution(tracksByNodeId, (execution) => {
    const isUnfinished = execution.state === 'running' || execution.state === 'waiting'
    if (type === 'run_paused' && execution.state === 'running') {
      execution.state = 'waiting'
      execution.isWaitingWithRun = true
    } else if ((type === 'run_resumed' || type === 'run_started') && execution.isWaitingWithRun) {
      execution.state = 'running'
      execution.isWaitingWithRun = false
    } else if ((type === 'run_failed' || type === 'run_aborted') && isUnfinished) {
      execution.state = type === 'run_failed' ? 'failed' : 'skipped'
      execution.finishedAt = record.createdAt
      execution.durationMs = measureMs(execution.startedAt, record.createdAt)
    }
  })
}

/**
 * Replays the events into one track per node.
 *
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @returns Tracks by node id, in the order nodes first appeared (Map<string, NodeTrack>)
 */
export function collectNodeTracks(events: RunEventRecord[]): Map<string, NodeTrack> {
  const tracksByNodeId = new Map<string, NodeTrack>()
  for (const record of events) {
    const nodeId = record.event.node_id
    // A helper agent's steps belong to its own workflow (shown as help from other agents), not to this run's steps.
    if (isHelperFrame(readFrame(record.event))) continue
    if (nodeEventTypes.has(record.event.type) && typeof nodeId === 'string' && nodeId) trackNodeEvent(tracksByNodeId, record, nodeId)
    else applyRunEvent(tracksByNodeId, record)
  }
  return tracksByNodeId
}

/** Frames where some node is still running or waiting: the iteration items in progress. */
export function collectActiveFrames(tracksByNodeId: Map<string, NodeTrack>): Set<string> {
  const activeFrames = new Set<string>()
  forEachExecution(tracksByNodeId, (execution) => {
    if (execution.state === 'running' || execution.state === 'waiting') activeFrames.add(execution.frame)
  })
  return activeFrames
}
