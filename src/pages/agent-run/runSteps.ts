import type { RunEventRecord } from '@/api/types'
import type { TestRunStepState } from '@/pages/agent-run/testRunTypes'
import { buildItemFrame, describeItemShort, findIterationItems, parseFrame, readIteratorPath, readNumber } from './runEventValues'
import { collectActiveFrames, collectNodeTracks, type NodeExecution, type NodeTrack, type StepTokenUsage } from './runNodeTracks'
import { containerNodeKinds, hiddenNodeKinds, humanizeNodeId, modelNodeKinds, type RunStepTemplate } from './runProgress'
import { messages } from '@/i18n'

/**
 * The step list of screens 06 and 20: the flow summary's steps in flow order, with what each
 * one is doing according to the run's graphrt events.
 *
 * Iterations report `node_progress` `iteration_next { index, total }` when an item starts and
 * loops `loop_next { round }`; body steps run in the frame `<container>[<index>]`. A body step
 * shows its state for the item in progress and how many items it finished.
 */

/** Where an iteration or loop is. */
export interface IterationProgress {
  /** 1-based number of the item (or round) in progress, null before the first one. */
  currentNumber: number | null
  /** Number of items; null for loops, which do not know it up front. */
  total: number | null
  doneCount: number
  /** Short name of the item in progress ("Kopi Kenangan"), when the list could be read. */
  currentItemLabel: string | null
  isLoop: boolean
}

export interface RunStepView {
  id: string
  label: string
  depth: number
  nodeType: string | null
  state: TestRunStepState
  isModelStep: boolean
  /** When the shown execution started; drives the live duration while running. */
  startedAt: string | null
  durationMs: number | null
  retryCount: number
  lastRetryError: string | null
  /** Text streamed so far (`node_chunk`s of the shown execution, joined). */
  streamedText: string
  outputs: Record<string, unknown> | null
  inputs: unknown
  errorMessage: string | null
  /** The failure's error kind (`setup_required`, `invalid_input`…), explained under the error. */
  errorType: string | null
  usage: StepTokenUsage | null
  detail: string | null
  iteration: IterationProgress | null
  /** For steps inside an iteration or loop: how many items this step finished. */
  itemsDoneCount: number | null
  /** The item the shown execution belongs to ("Business 1 of 10: Kopi Kenangan"), inside a loop. */
  itemDescription: string | null
  /** The flow summary's detail for this step ("POST api.example.com"), used to explain errors. */
  stepDetail: string | null
  /** How many notes the agent learned were read for the shown execution (`lessons_applied`). */
  learnedNoteCount: number
  /** Tools a skill was allowed but could not use because nothing here provides them (`skill_tool_unavailable`). */
  unavailableSkillTools: UnavailableSkillTool[]
}

/** A tool a skill may use that this computer does not have (its plugin was removed, say). */
export interface UnavailableSkillTool {
  /** Technical name of the skill. */
  skill: string
  /** The tool as the skill asks for it (`provider/tool`). */
  tool: string
}

function readText(data: unknown, key: string): string | null {
  if (!data || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : null
}

/** Notes read by the execution: the ids of every `lessons_applied` report, each counted once. */
export function countLearnedNotes(execution: NodeExecution): number {
  const ids = new Set<string>()
  for (const report of execution.progressReports) {
    if (report.name !== 'lessons_applied' || !report.data || typeof report.data !== 'object') continue
    const reportedIds = (report.data as Record<string, unknown>).ids
    if (Array.isArray(reportedIds)) reportedIds.forEach((id) => typeof id === 'string' && ids.add(id))
  }
  return ids.size
}

/** The `skill_tool_unavailable` reports of the execution, one per skill and tool. */
export function collectUnavailableSkillTools(execution: NodeExecution): UnavailableSkillTool[] {
  const seen = new Set<string>()
  const tools: UnavailableSkillTool[] = []
  for (const report of execution.progressReports) {
    if (report.name !== 'skill_tool_unavailable') continue
    const skill = readText(report.data, 'skill')
    const tool = readText(report.data, 'tool')
    if (!skill || !tool || seen.has(`${skill}\n${tool}`)) continue
    seen.add(`${skill}\n${tool}`)
    tools.push({ skill, tool })
  }
  return tools
}

/** What a container tells the steps inside it. */
interface ContainerContext {
  currentItemFrame: string | null
  isInProgress: boolean
  itemDescription: string | null
}

function readIterationNext(execution: NodeExecution) {
  const reports = execution.progressReports.filter((report) => report.name === 'iteration_next' || report.name === 'loop_next')
  const startedIndexes = new Set<number>()
  let lastReport: { index: number; total: number | null; seq: number; isLoop: boolean } | null = null
  for (const report of reports) {
    const isLoop = report.name === 'loop_next'
    const index = readNumber(report.data, isLoop ? 'round' : 'index')
    if (index === null) continue
    startedIndexes.add(index)
    lastReport = { index, total: isLoop ? null : readNumber(report.data, 'total'), seq: report.seq, isLoop }
  }
  return { startedIndexes, lastReport }
}

function countDoneItems(execution: NodeExecution, nodeId: string, startedIndexes: Set<number>, activeFrames: Set<string>, total: number | null): number {
  if (execution.state === 'done') return total ?? readNumber(execution.outputs, 'loop_round') ?? startedIndexes.size
  const activeCount = [...startedIndexes].filter((index) => activeFrames.has(buildItemFrame(execution.frame, nodeId, index))).length
  return Math.max(0, startedIndexes.size - Math.max(activeCount, startedIndexes.size > 0 ? 1 : 0))
}

/** "For each business" → "Business", used to name items ("Business 3 of 10"). */
export function nameIterationItem(containerLabel: string, isLoop: boolean): string {
  const match = /^(?:for each|untuk setiap|untuk tiap) (.+)$/i.exec(containerLabel.trim())
  if (!match) return isLoop ? messages().agentRun.round : messages().agentRun.item
  const noun = match[1].trim()
  return noun.charAt(0).toUpperCase() + noun.slice(1)
}

/** "Business 3 of 10: Kopi Kenangan", "Round 2". */
export function describeIterationItem(containerLabel: string, progress: IterationProgress): string | null {
  if (progress.currentNumber === null) return null
  const itemName = nameIterationItem(containerLabel, progress.isLoop)
  const position = messages().agentRun.itemPosition(itemName, progress.currentNumber, progress.total)
  return progress.currentItemLabel ? messages().agentRun.itemWithLabel(position, progress.currentItemLabel) : position
}

interface IterationSources {
  events: RunEventRecord[]
  activeFrames: Set<string>
}

function buildIterationProgress(step: RunStepTemplate, execution: NodeExecution, sources: IterationSources, nodeType: string | null): IterationProgress {
  const { startedIndexes, lastReport } = readIterationNext(execution)
  const total = lastReport?.total ?? null
  const items = lastReport && total !== null ? findIterationItems(sources.events, lastReport.seq, total, readIteratorPath(step.detail)) : null
  return {
    currentNumber: lastReport ? lastReport.index + 1 : null,
    total,
    doneCount: countDoneItems(execution, step.id, startedIndexes, sources.activeFrames, total),
    currentItemLabel: items && lastReport ? describeItemShort(items[lastReport.index]) : null,
    isLoop: lastReport?.isLoop ?? nodeType === 'loop',
  }
}

/** The execution to show: the one of the container's current item, or the latest. */
function pickExecution(track: NodeTrack | undefined, container: ContainerContext | null): NodeExecution | null {
  if (!track) return null
  if (container?.currentItemFrame) {
    const currentItemExecution = track.executionsByFrame.get(container.currentItemFrame)
    if (currentItemExecution || container.isInProgress) return currentItemExecution ?? null
  }
  return track.executionsByFrame.get(track.lastFrame) ?? null
}

function countItemsDone(track: NodeTrack | undefined): number {
  if (!track) return 0
  return [...track.executionsByFrame.values()].filter((execution) => execution.frame !== '' && execution.state === 'done').length
}

function buildEmptyView(step: RunStepTemplate, nodeType: string | null): RunStepView {
  return {
    id: step.id,
    label: step.label,
    depth: step.depth ?? 0,
    nodeType,
    state: 'pending',
    isModelStep: nodeType !== null && modelNodeKinds.has(nodeType),
    startedAt: null,
    durationMs: null,
    retryCount: 0,
    lastRetryError: null,
    streamedText: '',
    outputs: null,
    inputs: undefined,
    errorMessage: null,
    errorType: null,
    usage: null,
    detail: null,
    iteration: null,
    itemsDoneCount: null,
    itemDescription: null,
    stepDetail: step.detail ?? null,
    learnedNoteCount: 0,
    unavailableSkillTools: [],
  }
}

function applyExecution(view: RunStepView, execution: NodeExecution): RunStepView {
  return {
    ...view,
    state: execution.state,
    startedAt: execution.startedAt,
    durationMs: execution.durationMs,
    retryCount: execution.retryCount,
    lastRetryError: execution.lastRetryError,
    streamedText: Object.values(execution.textByField).join('\n\n'),
    outputs: execution.outputs,
    inputs: execution.inputs,
    errorMessage: execution.errorMessage,
    errorType: execution.errorType,
    usage: execution.usage,
    detail: execution.detail,
    learnedNoteCount: countLearnedNotes(execution),
    unavailableSkillTools: collectUnavailableSkillTools(execution),
  }
}

/** Steps from the events alone, for runs whose flow summary is missing or from another version. */
function deriveTemplateFromEvents(tracksByNodeId: Map<string, NodeTrack>): RunStepTemplate[] {
  return [...tracksByNodeId.values()]
    .filter((track) => !(track.kind && hiddenNodeKinds.has(track.kind)))
    .sort((first, second) => first.firstSeq - second.firstSeq)
    .map((track) => ({ id: track.nodeId, label: track.title ?? humanizeNodeId(track.nodeId), depth: parseFrame(track.lastFrame).length, nodeType: track.kind }))
}

/** A node the template does not list that would be a visible step (not bookkeeping, not merely skipped). */
function isUnlistedVisibleNode(track: NodeTrack, templateIds: Set<string>): boolean {
  if (templateIds.has(track.nodeId) || (track.kind && hiddenNodeKinds.has(track.kind))) return false
  const wasOnlySkipped = [...track.executionsByFrame.values()].every((execution) => execution.state === 'skipped')
  return !(track.kind === null && wasOnlySkipped)
}

/**
 * The flow summary's steps when they describe this run (most of the nodes it ran are listed);
 * otherwise, e.g. for a run of an older version, steps read from the events.
 */
export function chooseStepTemplate(template: RunStepTemplate[], tracksByNodeId: Map<string, NodeTrack>): RunStepTemplate[] {
  const templateIds = new Set(template.map((step) => step.id))
  const tracks = [...tracksByNodeId.values()]
  const listedCount = tracks.filter((track) => templateIds.has(track.nodeId)).length
  const unlistedCount = tracks.filter((track) => isUnlistedVisibleNode(track, templateIds)).length
  const isTemplateForThisRun = unlistedCount === 0 || listedCount > unlistedCount
  if (template.length > 0 && isTemplateForThisRun) return template
  return deriveTemplateFromEvents(tracksByNodeId)
}

/**
 * Builds the step list: only the template's steps, in its order, never bookkeeping nodes.
 *
 * @param template - Expected steps from the flow summary (RunStepTemplate[])
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @returns One view per step (RunStepView[])
 *
 * @example
 * buildRunStepViews(toRunStepTemplate(flowSummary), events)
 */
export function buildRunStepViews(template: RunStepTemplate[], events: RunEventRecord[]): RunStepView[] {
  const tracksByNodeId = collectNodeTracks(events)
  const activeFrames = collectActiveFrames(tracksByNodeId)
  const containerStack: Array<{ depth: number; context: ContainerContext }> = []

  return chooseStepTemplate(template, tracksByNodeId).map((step) => {
    const depth = step.depth ?? 0
    while (containerStack.length > 0 && containerStack[containerStack.length - 1].depth >= depth) containerStack.pop()
    const container = containerStack[containerStack.length - 1]?.context ?? null
    const track = tracksByNodeId.get(step.id)
    const nodeType = step.nodeType ?? track?.kind ?? null
    const execution = pickExecution(track, container)
    let view = buildEmptyView(step, nodeType)
    if (execution) view = applyExecution(view, execution)
    if (container) view = { ...view, itemsDoneCount: countItemsDone(track), itemDescription: execution && execution.frame === container.currentItemFrame ? container.itemDescription : null }

    if (nodeType !== null && containerNodeKinds.has(nodeType)) {
      const iteration = execution ? buildIterationProgress(step, execution, { events, activeFrames }, nodeType) : null
      view = { ...view, iteration }
      const currentItemFrame = execution && iteration?.currentNumber ? buildItemFrame(execution.frame, step.id, iteration.currentNumber - 1) : null
      const isInProgress = execution?.state === 'running' || execution?.state === 'waiting'
      containerStack.push({ depth, context: { currentItemFrame, isInProgress, itemDescription: iteration ? describeIterationItem(step.label, iteration) : null } })
    }
    return view
  })
}

/** "2 of 4 steps done", counting top-level steps. */
export function countTopLevelSteps(steps: RunStepView[]): { doneCount: number; totalCount: number } {
  const topLevelSteps = steps.filter((step) => step.depth === 0)
  return { doneCount: topLevelSteps.filter((step) => step.state === 'done' || step.state === 'skipped').length, totalCount: topLevelSteps.length }
}
