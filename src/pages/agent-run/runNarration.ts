import type { GraphrtEvent, RunEventRecord } from '@/api/types'
import { humanizeRunError } from './runErrorText'
import { buildItemFrame, findIterationItems, describeItemShort, parseFrame, readFrame, readIteratorPath, readNumber, readString } from './runEventValues'
import { collectNodeTracks } from './runNodeTracks'
import { containerNodeKinds, formatDurationMs, modelNodeKinds, type RunStepTemplate } from './runProgress'
import { chooseStepTemplate, describeIterationItem } from './runSteps'
import { describeFoundCount } from './stepValueSummary'
import { messages } from '@/i18n'

/**
 * The plain-language feed in the chat column of the Test run screen (06), read from the run's
 * graphrt events: one line per top-level step and one per iteration item, updated in place as
 * the step or item moves on, plus the approval, the finish and the failure.
 */

export type NarrationTone = 'neutral' | 'ok' | 'danger' | 'amber'

export interface NarrationLine {
  key: string
  text: string
  tone: NarrationTone
  /** The line stands for the pending approval: it links to the approval card. */
  isApprovalLink: boolean
  /** Raw error behind a failure line, shown under "Technical details". */
  rawError: string | null
}

interface StepInfo {
  template: RunStepTemplate
  isContainer: boolean
  isModel: boolean
}

interface FailureNote {
  label: string
  summary: string
  raw: string
  itemTitle: string | null
}

/** Mutable state while the events are read in order. */
interface NarrationState {
  lines: Map<string, NarrationLine>
  stepsById: Map<string, StepInfo>
  events: RunEventRecord[]
  itemTitleByFrame: Map<string, string>
  /** Container execution (`frame|containerId`) → frame of its item in progress. */
  currentItemByContainer: Map<string, string>
  closedItemFrames: Set<string>
  firstFailure: FailureNote | null
  runStartedAt: string | null
}

function setLine(state: NarrationState, key: string, text: string, changes: Partial<NarrationLine> = {}): void {
  state.lines.set(key, { key, text, tone: 'neutral', isApprovalLink: false, rawError: null, ...changes })
}

function itemTitleFor(state: NarrationState, frame: string): string | null {
  if (!frame) return null
  const known = state.itemTitleByFrame.get(frame)
  if (known) return known
  const lastSegment = parseFrame(frame).at(-1)
  if (!lastSegment) return null
  const container = state.stepsById.get(lastSegment.containerId)
  const isLoop = container?.template.nodeType === 'loop'
  return describeIterationItem(container?.template.label ?? '', { currentNumber: lastSegment.index + 1, total: null, doneCount: 0, currentItemLabel: null, isLoop })
}

function closeItem(state: NarrationState, itemFrame: string | undefined): void {
  if (!itemFrame || state.closedItemFrames.has(itemFrame)) return
  state.closedItemFrames.add(itemFrame)
  const line = state.lines.get(`item:${itemFrame}`)
  if (line && line.tone === 'neutral') setLine(state, line.key, messages().agentRun.itemDone(itemTitleFor(state, itemFrame) ?? messages().agentRun.item))
}

function handleItemStart(state: NarrationState, record: RunEventRecord, step: StepInfo): void {
  const { event } = record
  const isLoop = event.name === 'loop_next'
  const index = readNumber(event.data, isLoop ? 'round' : 'index')
  if (index === null) return
  const total = isLoop ? null : readNumber(event.data, 'total')
  const frame = readFrame(event)
  const items = total === null ? null : findIterationItems(state.events, record.seq, total, readIteratorPath(step.template.detail))
  const itemFrame = buildItemFrame(frame, step.template.id, index)
  const containerKey = `${frame}|${step.template.id}`
  closeItem(state, state.currentItemByContainer.get(containerKey))
  state.currentItemByContainer.set(containerKey, itemFrame)
  const title = describeIterationItem(step.template.label, { currentNumber: index + 1, total, doneCount: 0, currentItemLabel: items ? describeItemShort(items[index]) : null, isLoop })
  if (!title) return
  state.itemTitleByFrame.set(itemFrame, title)
  setLine(state, `item:${itemFrame}`, title)
}

function describeSuccess(step: StepInfo, event: GraphrtEvent): string {
  const outputs = event.outputs && typeof event.outputs === 'object' ? (event.outputs as Record<string, unknown>) : null
  const found = describeFoundCount(outputs)
  if (found) return messages().agentRun.stepFound(step.template.label, found)
  const durationMs = readNumber(event, 'elapsed_ms') ?? readNumber(event, 'duration_ms')
  return step.isModel && durationMs !== null ? messages().agentRun.stepDoneIn(step.template.label, formatDurationMs(durationMs)) : messages().agentRun.stepDone(step.template.label)
}

function answerPause(state: NarrationState, nodeId: string, frame: string, event: GraphrtEvent): void {
  const pauseKey = `pause:${nodeId}:${frame}`
  if (!state.lines.has(pauseKey)) return
  const outputs = event.outputs && typeof event.outputs === 'object' ? (event.outputs as Record<string, unknown>) : {}
  const action = typeof outputs.action === 'string' ? outputs.action : readString(event, 'branch')
  setLine(state, pauseKey, action ? messages().agentRun.youAnsweredWith(action) : messages().agentRun.youAnswered)
}

function recordFailure(state: NarrationState, step: StepInfo, event: GraphrtEvent, itemTitle: string | null) {
  const humanized = humanizeRunError(readString(event, 'error') ?? messages().agentRun.thisStepFailed, step.template.detail ?? null)
  if (!state.firstFailure && event.handled !== true) state.firstFailure = { label: step.template.label, summary: humanized.summary, raw: humanized.raw, itemTitle }
  return humanized
}

/** A step event inside an iteration item: updates that item's line. */
function handleItemStepEvent(state: NarrationState, step: StepInfo, event: GraphrtEvent, frame: string): void {
  const itemKey = `item:${frame}`
  const itemTitle = itemTitleFor(state, frame) ?? messages().agentRun.item
  const label = step.template.label
  if (event.type === 'node_failed') {
    const humanized = recordFailure(state, step, event, itemTitle)
    const text = event.handled === true ? messages().agentRun.itemStepFailedWith(itemTitle, label, humanized.summary) : messages().agentRun.itemStepFailed(itemTitle, label)
    setLine(state, itemKey, text, { tone: 'danger', rawError: event.handled === true ? humanized.raw : null })
    return
  }
  if (state.lines.get(itemKey)?.tone === 'danger' || step.isContainer) return
  if (event.type === 'node_paused') setLine(state, itemKey, messages().agentRun.itemWaiting(itemTitle), { tone: 'amber' })
  else if (event.type === 'node_succeeded') setLine(state, itemKey, messages().agentRun.itemProgress(itemTitle, describeSuccess(step, event).replace(/^./, (first) => first.toLowerCase())))
  else if (event.type !== 'node_skipped') setLine(state, itemKey, messages().agentRun.itemProgress(itemTitle, `${label.charAt(0).toLowerCase()}${label.slice(1)}…`))
}

/** A top-level step event: updates that step's line. */
function handleTopLevelStepEvent(state: NarrationState, step: StepInfo, event: GraphrtEvent, frame: string): void {
  const stepKey = `step:${frame}|${step.template.id}`
  const label = step.template.label
  if (step.isContainer) {
    if (event.type !== 'node_succeeded') return
    state.currentItemByContainer.forEach((itemFrame, containerKey) => containerKey === `${frame}|${step.template.id}` && closeItem(state, itemFrame))
    const outputs = event.outputs && typeof event.outputs === 'object' ? (event.outputs as Record<string, unknown>) : {}
    const itemCount = Array.isArray(outputs.output) ? outputs.output.length : readNumber(outputs, 'loop_round')
    setLine(state, stepKey, itemCount === null ? messages().agentRun.stepDone(label) : messages().agentRun.stepAllDone(label, itemCount), { tone: 'ok' })
    return
  }
  if (event.type === 'node_started' || event.type === 'node_chunk') setLine(state, stepKey, `${label}…`)
  else if (event.type === 'node_retry') setLine(state, stepKey, messages().agentRun.stepRetrying(label, (readNumber(event, 'attempt') ?? 1) + 1))
  else if (event.type === 'node_succeeded') setLine(state, stepKey, describeSuccess(step, event))
  else if (event.type === 'node_failed') {
    const humanized = recordFailure(state, step, event, null)
    if (event.handled === true) setLine(state, stepKey, messages().agentRun.stepFailedWith(label, humanized.summary), { tone: 'danger', rawError: humanized.raw })
    else state.lines.delete(stepKey)
  }
}

function handleNodeEvent(state: NarrationState, record: RunEventRecord, step: StepInfo): void {
  const { event } = record
  const frame = readFrame(event)
  const nodeId = step.template.id
  if (event.type === 'node_progress' && (event.name === 'iteration_next' || event.name === 'loop_next')) {
    handleItemStart(state, record, step)
    return
  }
  if (event.type === 'node_paused') {
    const isApproval = step.template.nodeType === 'human-input' || event.kind === 'human_input' || event.kind === 'human-input'
    const pauseKind = event.reason && typeof event.reason === 'object' ? (event.reason as Record<string, unknown>).kind : event.kind
    const text = pauseKind === 'tool_approval' ? messages().agentRun.waitingForYourOkToUse : isApproval ? messages().agentRun.waitingForYourApproval : messages().agentRun.waitingForYou2
    setLine(state, `pause:${nodeId}:${frame}`, text, { tone: 'amber', isApprovalLink: true })
  }
  if (event.type === 'node_succeeded') answerPause(state, nodeId, frame, event)
  const lastSegment = parseFrame(frame).at(-1)
  if (lastSegment && state.stepsById.get(lastSegment.containerId)?.isContainer) handleItemStepEvent(state, step, event, frame)
  else handleTopLevelStepEvent(state, step, event, frame)
}

function describeRunFailure(state: NarrationState, event: GraphrtEvent): Pick<NarrationLine, 'text' | 'rawError'> {
  const failure = state.firstFailure
  if (failure) {
    const where = failure.itemTitle ? `${failure.label} (${failure.itemTitle})` : failure.label
    return { text: messages().agentRun.failedAt(where, failure.summary), rawError: failure.raw }
  }
  const humanized = humanizeRunError(readString(event, 'error') ?? messages().agentRun.somethingWentWrong)
  return { text: messages().agentRun.runFailedWith(humanized.summary), rawError: humanized.raw }
}

function measureRunMs(state: NarrationState, record: RunEventRecord): number | null {
  const elapsedMs = readNumber(record.event, 'elapsed_ms')
  if (elapsedMs !== null) return elapsedMs
  if (!state.runStartedAt) return null
  return new Date(record.createdAt).getTime() - new Date(state.runStartedAt).getTime()
}

function handleRunEvent(state: NarrationState, record: RunEventRecord): void {
  const { event } = record
  if (event.type === 'run_started' && !state.runStartedAt) state.runStartedAt = record.createdAt
  if (event.type === 'run_succeeded') {
    const runMs = measureRunMs(state, record)
    setLine(state, 'run:end', runMs === null ? messages().agentRun.finished : messages().agentRun.finishedIn(formatDurationMs(runMs)), { tone: 'ok' })
  } else if (event.type === 'run_failed') {
    const failure = describeRunFailure(state, event)
    setLine(state, 'run:end', failure.text, { tone: 'danger', rawError: failure.rawError })
  } else if (event.type === 'run_aborted') {
    setLine(state, 'run:end', messages().agentRun.stopped)
  } else if (event.type === 'run_paused' && ![...state.lines.values()].some((line) => line.isApprovalLink)) {
    setLine(state, `pause:run:${record.seq}`, messages().agentRun.waitingForYou2, { tone: 'amber', isApprovalLink: true })
  }
}

/**
 * `approval_timed_out` (stored by the desktop when an approval passed its deadline): the waiting
 * line becomes "Timed out → Skip" or "Timed out → stopped the run".
 */
function handleApprovalTimeout(state: NarrationState, record: RunEventRecord): void {
  const { event } = record
  const nodeId = readString(event, 'node_id') ?? ''
  const frame = readFrame(event)
  const outcome = event.outcome === 'answer' ? (readString(event, 'action_title') ?? readString(event, 'action') ?? messages().agentRun.answered) : messages().agentRun.stoppedTheRun
  state.lines.delete(`pause:${nodeId}:${frame}`)
  const itemTitle = itemTitleFor(state, frame)
  const label = state.stepsById.get(nodeId)?.template.label
  const where = itemTitle ?? label
  setLine(state, `timeout:${nodeId}:${frame}`, messages().agentRun.timedOut(where ?? null, outcome), { tone: 'amber' })
}

/** Approval links stay links only while the run still waits on them. */
function settleApprovalLinks(lines: NarrationLine[], events: RunEventRecord[]): NarrationLine[] {
  const lastEventType = events.at(-1)?.event.type
  const isFinished = lastEventType === 'run_succeeded' || lastEventType === 'run_failed' || lastEventType === 'run_aborted'
  return lines.map((line) => (line.isApprovalLink && isFinished ? { ...line, isApprovalLink: false, tone: 'neutral' } : line))
}

/**
 * Builds the narration lines, oldest first.
 *
 * @param template - Expected steps from the flow summary (RunStepTemplate[])
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @returns One line per step, item, approval and outcome (NarrationLine[])
 *
 * @example
 * buildRunNarration(toRunStepTemplate(flowSummary), events).map((line) => line.text)
 * // ["Search Google Maps: found 10 places", "Business 3 of 10: Kopi Kenangan — write the message…"]
 */
export function buildRunNarration(template: RunStepTemplate[], events: RunEventRecord[]): NarrationLine[] {
  const steps = chooseStepTemplate(template, collectNodeTracks(events))
  const stepsById = new Map<string, StepInfo>(
    steps.map((step) => [step.id, { template: step, isContainer: containerNodeKinds.has(step.nodeType ?? ''), isModel: modelNodeKinds.has(step.nodeType ?? '') }]),
  )
  const state: NarrationState = {
    lines: new Map(),
    stepsById,
    events,
    itemTitleByFrame: new Map(),
    currentItemByContainer: new Map(),
    closedItemFrames: new Set(),
    firstFailure: null,
    runStartedAt: events[0]?.createdAt ?? null,
  }
  for (const record of events) {
    const { type, node_id: nodeId } = record.event
    const step = nodeId ? stepsById.get(nodeId) : undefined
    if (type.startsWith('node_')) {
      if (step) handleNodeEvent(state, record, step)
    } else if (type.startsWith('run_')) {
      handleRunEvent(state, record)
    } else if (type === 'approval_timed_out') {
      handleApprovalTimeout(state, record)
    }
  }
  return settleApprovalLinks([...state.lines.values()], events)
}
