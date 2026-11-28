import type { RunEventRecord } from '@/api/types'
import { messages } from '@/i18n'
import type { NodeExecution } from './runNodeTracks'
import { isRecord, readFrame, readNumber, readString } from './runEventValues'

/**
 * What an agent's abilities did in a run, read from graphrt's progress events:
 * - per step: the conversation was shortened (`context_trimmed`), notes were saved or
 *   recalled (`memory_*`), the spending limit was close (`budget`), it picked up after an
 *   interruption (`checkpoint_restored`) and a tool cut off was not repeated (`tool_interrupted`);
 * - the helper agents it asked: graphrt runs each as a child run in the frame
 *   `<step>.<agent id>[<n>]` (node ids never contain a dot, so a container frame
 *   `<step>[<n>]` is never mistaken for one), reported by `subagent_*` events.
 */

/** A frame segment of a helper agent: `<step>.<agent id>[<n>]`. */
const helperSegmentPattern = /^([^./[\]]+)\.([^/[\]]+)\[(\d+)\]$/

/** Whether `frame` is inside a helper agent's run (at any depth). */
export function isHelperFrame(frame: string): boolean {
  return frame !== '' && frame.split('/').some((segment) => helperSegmentPattern.test(segment))
}

/** Whether a stored event belongs to a helper agent's own steps (not the run's). */
export function isHelperEvent(record: RunEventRecord): boolean {
  return isHelperFrame(readFrame(record.event))
}

export type AbilityNoteKind = 'context' | 'memory' | 'budget' | 'checkpoint' | 'interrupted'

export interface AbilityNote {
  key: string
  kind: AbilityNoteKind
  text: string
  /** Something the owner should look at (amber): a limit, an interruption, a failure. */
  isWarning: boolean
}

function readBoolean(data: unknown, key: string): boolean | null {
  return isRecord(data) && typeof data[key] === 'boolean' ? (data[key] as boolean) : null
}

function readDataText(data: unknown, key: string): string | null {
  return isRecord(data) && typeof data[key] === 'string' && data[key] ? (data[key] as string) : null
}

/**
 * The notes of one step's execution, one per kind (counts summed), in a fixed order.
 *
 * @example
 * readAbilityNotes(execution).map((note) => note.text)
 * // ["Left out 14 older messages to fit the AI model", "Remembered 1 thing"]
 */
export function readAbilityNotes(execution: NodeExecution): AbilityNote[] {
  const t = messages().abilities.runNotes
  let trims = 0
  let removedMessages = 0
  let summarized = false
  let stillTooLong = false
  let saved = 0
  let waiting = 0
  let recalled = 0
  let forgotten = 0
  let memoryFailed = false
  let finalTurn = false
  const unpricedModels: string[] = []
  let restored = false
  const interruptedTools: string[] = []
  for (const report of execution.progressReports) {
    const { data } = report
    switch (report.name) {
      case 'context_trimmed':
        trims += 1
        removedMessages += readNumber(data, 'removed_messages') ?? 0
        summarized ||= readBoolean(data, 'summarized') === true
        stillTooLong ||= readBoolean(data, 'fits') === false
        break
      case 'memory_saved':
        saved += 1
        if (readDataText(data, 'status') === 'pending') waiting += 1
        break
      case 'memory_recalled':
        recalled += readNumber(data, 'count') ?? 0
        break
      case 'memory_forgotten':
        forgotten += readNumber(data, 'count') ?? 0
        break
      case 'memory_failed':
        memoryFailed = true
        break
      case 'budget': {
        if (readBoolean(data, 'final_turn') === true) finalTurn = true
        const model = readDataText(data, 'price_missing')
        if (model && !unpricedModels.includes(model)) unpricedModels.push(model)
        break
      }
      case 'checkpoint_restored':
        restored = true
        break
      case 'tool_interrupted': {
        const tool = readDataText(data, 'name')
        if (tool && !interruptedTools.includes(tool)) interruptedTools.push(tool)
        break
      }
    }
  }
  const notes: AbilityNote[] = []
  if (trims > 0) {
    const text = [t.contextTrimmed(removedMessages), summarized ? t.contextSummarized : null].filter(Boolean).join(' ')
    notes.push({ key: 'context', kind: 'context', text: stillTooLong ? `${text}. ${t.contextStillTooLong}` : text, isWarning: stillTooLong })
  }
  if (saved > 0 || recalled > 0 || forgotten > 0 || memoryFailed) {
    const parts = [saved > 0 ? t.memorySaved(saved) : null, waiting > 0 ? t.memoryWaiting(waiting) : null, recalled > 0 ? t.memoryRecalled(recalled) : null, forgotten > 0 ? t.memoryForgotten(forgotten) : null, memoryFailed ? t.memoryFailed : null]
    notes.push({ key: 'memory', kind: 'memory', text: parts.filter(Boolean).join(' · '), isWarning: memoryFailed || waiting > 0 })
  }
  if (finalTurn) notes.push({ key: 'budget', kind: 'budget', text: t.budgetFinalTurn, isWarning: true })
  for (const model of unpricedModels) notes.push({ key: `price:${model}`, kind: 'budget', text: t.budgetPriceMissing(model), isWarning: true })
  if (restored) notes.push({ key: 'checkpoint', kind: 'checkpoint', text: t.checkpointRestored, isWarning: false })
  for (const tool of interruptedTools) notes.push({ key: `interrupted:${tool}`, kind: 'interrupted', text: t.toolInterrupted(tool), isWarning: true })
  return notes
}

export type HelperRunStatus = 'running' | 'finished' | 'failed' | 'paused' | 'stopped'

/** One request for help: a helper agent's run inside this run. */
export interface HelperRun {
  /** The child run's frame, e.g. `assistant.<agent id>[0]`. */
  frame: string
  agentId: string
  /** The step that asked. */
  stepId: string
  index: number
  status: HelperRunStatus
  /** Steps of the helper that finished. */
  stepCount: number
  /** Helpers this helper asked in turn. */
  children: HelperRun[]
}

function childFrame(parentFrame: string, stepId: string, agentId: string, index: number): string {
  const segment = `${stepId}.${agentId}[${index}]`
  return parentFrame ? `${parentFrame}/${segment}` : segment
}

/** The frame of the helper run `frame` is in (itself when it is one), or `''` for the run's own. */
function enclosingHelperFrame(frame: string): string {
  const segments = frame.split('/')
  for (let end = segments.length; end > 0; end -= 1) {
    if (helperSegmentPattern.test(segments[end - 1])) return segments.slice(0, end).join('/')
  }
  return ''
}

/** Kinds of steps that only mark structure; not counted as a helper's steps. */
const bookkeepingKinds = new Set(['start', 'end', 'iteration-start', 'loop-start', 'loop-end'])

/**
 * The helper runs of a run, as a tree (helpers a helper asked are its children), in the
 * order they were asked.
 *
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @returns The top-level requests for help (HelperRun[])
 */
export function buildHelperTree(events: RunEventRecord[]): HelperRun[] {
  const runsByFrame = new Map<string, HelperRun>()
  const order: string[] = []
  const kindsByExec = new Map<string, string>()
  const ensure = (frame: string): HelperRun | null => {
    const known = runsByFrame.get(frame)
    if (known) return known
    const lastSegment = frame.split('/').at(-1) ?? ''
    const match = helperSegmentPattern.exec(lastSegment)
    if (!match) return null
    const helper: HelperRun = { frame, stepId: match[1], agentId: match[2], index: Number(match[3]), status: 'running', stepCount: 0, children: [] }
    runsByFrame.set(frame, helper)
    order.push(frame)
    return helper
  }
  for (const { event } of events) {
    const frame = readFrame(event)
    if (event.type === 'node_progress' && typeof event.name === 'string' && event.name.startsWith('subagent_')) {
      const agentId = readDataText(event.data, 'workflow')
      const index = readNumber(event.data, 'index')
      const stepId = readString(event, 'node_id')
      if (!agentId || index === null || !stepId) continue
      const helper = ensure(childFrame(frame, stepId, agentId, index))
      if (!helper) continue
      if (event.name === 'subagent_finished') helper.status = 'finished'
      else if (event.name === 'subagent_failed') helper.status = 'failed'
      else if (event.name === 'subagent_paused') helper.status = 'paused'
      continue
    }
    if (!isHelperFrame(frame)) continue
    const helper = ensure(enclosingHelperFrame(frame))
    if (!helper) continue
    const execId = readString(event, 'exec_id')
    if (event.type === 'node_started' && execId) kindsByExec.set(execId, readString(event, 'kind') ?? '')
    if (event.type === 'node_succeeded' && enclosingHelperFrame(frame) === helper.frame && !bookkeepingKinds.has(execId ? (kindsByExec.get(execId) ?? '') : '')) helper.stepCount += 1
    // A helper answered after its pause: it is working again.
    if (event.type === 'node_started' && helper.status === 'paused') helper.status = 'running'
  }
  const roots: HelperRun[] = []
  for (const frame of order) {
    const helper = runsByFrame.get(frame)
    if (!helper) continue
    const parentFrame = enclosingHelperFrame(frame.split('/').slice(0, -1).join('/'))
    const parent = parentFrame ? runsByFrame.get(parentFrame) : undefined
    if (parent) parent.children.push(helper)
    else roots.push(helper)
  }
  return roots
}

/** How the run ended, from its last event; `null` while it runs or waits. */
export function readRunEnd(events: RunEventRecord[]): 'succeeded' | 'stopped' | null {
  const lastType = events.at(-1)?.event.type
  if (lastType === 'run_succeeded') return 'succeeded'
  if (lastType === 'run_failed' || lastType === 'run_aborted') return 'stopped'
  return null
}

/**
 * Helpers still "working" when the run ended without a report of their own: graphrt reports
 * every helper that finishes, so after a run that succeeded it finished; after one that was
 * stopped it stopped with the run.
 */
export function settleHelperStatuses(helpers: HelperRun[], runEnd: 'succeeded' | 'stopped' | null): HelperRun[] {
  return helpers.map((helper) => ({
    ...helper,
    status: helper.status === 'running' && runEnd !== null ? (runEnd === 'succeeded' ? 'finished' : 'stopped') : helper.status,
    children: settleHelperStatuses(helper.children, runEnd),
  }))
}
