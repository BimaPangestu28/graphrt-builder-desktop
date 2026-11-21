import type { AgentGraph, GraphEdge, GraphNode } from '@/api/agentGraphTypes'
import type { PendingApproval } from '@/api/runReviewTypes'
import type { RunEventRecord } from '@/api/types'
import { FAIL_BRANCH_HANDLE, SOURCE_HANDLE } from '@/lib/agentGraphRules'
import { collectNodeTracks, type NodeTrack } from '@/pages/agent-run/runNodeTracks'
import { buildRunStepViews, type RunStepView } from '@/pages/agent-run/runSteps'
import type { RunStepTemplate } from '@/pages/agent-run/runProgress'
import { isRecord, parseFrame, readString } from '@/pages/agent-run/runEventValues'

/**
 * Maps a run's graphrt events onto the Nodes canvas (spec D1–D3, artboards 35, 36, 44):
 * one {@link NodeRunView} per node id and one {@link EdgeRunState} per arrow id.
 *
 * Built on the run screens' event replay (`runNodeTracks.ts`, `runSteps.ts`), so a node shows
 * what the Steps view shows: inside a loop, the execution of the item in progress. On top it
 * reads what only the canvas needs: handled errors (`node_failed` with `handled: true`: the
 * error path or the fallback values), the branch a node took (`node_succeeded.branch`), item
 * outcomes per loop ("8 done · 2 skipped") and the question a waiting node asks.
 */

/** What a node shows during a run. */
export type NodeRunStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'waiting'
  | 'failed'
  /** Failed, and its error path (`fail-branch`) runs next. */
  | 'error-path'
  /** Failed, and it continued with its fallback values (`default-value`). */
  | 'fallback'
  | 'skipped'

/** Item outcomes of a For each / Repeat step. */
export interface LoopRunProgress {
  /** 1-based item (round) in progress; null before the first. */
  currentNumber: number | null
  /** Number of items; null for Repeat, which does not know it up front. */
  total: number | null
  doneCount: number
  skippedCount: number
  failedCount: number
  isLoop: boolean
}

export interface NodeRunView {
  nodeId: string
  status: NodeRunStatus
  startedAt: string | null
  durationMs: number | null
  /** 1-based attempt of the shown execution (retries + 1). */
  attempt: number
  /** Tries the node gets (`retry.maxRetries + 1`), at least `attempt`. */
  maxAttempts: number
  errorMessage: string | null
  /** Containers only. */
  loop: LoopRunProgress | null
  /** Body steps: how many items this step finished. */
  itemsDoneCount: number | null
  /** The question a waiting node asks (form or tool call), when the run waits on it. */
  approval: PendingApproval | null
  /** The full step view of the run screens, for details (outputs, streamed text). */
  step: RunStepView | null
}

/** How an arrow looks during a run. */
export type EdgeRunState = 'taken' | 'error-taken' | 'skipped'

export interface RunCanvasState {
  nodes: Record<string, NodeRunView>
  edges: Record<string, EdgeRunState>
  /** Failures the error strategy kept going (error path or fallback values). */
  handledErrorCount: number
  /** Top-level steps finished (done, skipped, handled) / all top-level steps. */
  doneCount: number
  totalCount: number
}

/** Nodes in flow order with depth: every root node, each container followed by its body (depth-first). */
export function buildGraphStepTemplate(graph: AgentGraph): RunStepTemplate[] {
  const childrenByParent = new Map<string | null, GraphNode[]>()
  for (const node of graph.nodes) {
    if (node.hidden) continue
    const siblings = childrenByParent.get(node.parent) ?? []
    siblings.push(node)
    childrenByParent.set(node.parent, siblings)
  }
  const template: RunStepTemplate[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const node of childrenByParent.get(parentId) ?? []) {
      template.push({ id: node.id, label: node.displayTitle, depth, nodeType: node.kind, detail: node.detail })
      if (node.container && depth < 16) visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return template
}

/** The latest `node_failed` of a node: whether its error strategy handled it, and whether outputs other than the error came with it. */
interface FailureFacts {
  handled: boolean
  hasFallbackValues: boolean
}

interface NodeEventFacts {
  failureByNode: Map<string, FailureFacts>
  /** Latest `node_succeeded.branch` per node. */
  branchByNode: Map<string, string>
  handledErrorCount: number
}

function collectNodeEventFacts(events: RunEventRecord[]): NodeEventFacts {
  const facts: NodeEventFacts = { failureByNode: new Map(), branchByNode: new Map(), handledErrorCount: 0 }
  for (const { event } of events) {
    const nodeId = event.node_id
    if (typeof nodeId !== 'string') continue
    if (event.type === 'node_failed') {
      const handled = event.handled === true
      const outputKeys = isRecord(event.outputs) ? Object.keys(event.outputs) : []
      facts.failureByNode.set(nodeId, { handled, hasFallbackValues: outputKeys.some((key) => key !== 'error_message' && key !== 'error_type') })
      if (handled) facts.handledErrorCount += 1
    } else if (event.type === 'node_started') {
      facts.failureByNode.delete(nodeId)
    } else if (event.type === 'node_succeeded') {
      const branch = readString(event, 'branch')
      if (branch) facts.branchByNode.set(nodeId, branch)
      else facts.branchByNode.delete(nodeId)
    }
  }
  return facts
}

/**
 * A handled failure goes to the error path or continues with fallback values, as the node's
 * `on_error` says; for a run of an older version (the node says `fail` now) the event tells:
 * fallback values come with outputs besides the error.
 */
function toNodeStatus(step: RunStepView, node: GraphNode | undefined, failure: FailureFacts | undefined): NodeRunStatus {
  if (step.state !== 'failed' || !failure?.handled) return step.state
  const strategy = node?.onError.strategy
  if (strategy === 'default-value') return 'fallback'
  if (strategy === 'fail-branch') return 'error-path'
  return failure.hasFallbackValues ? 'fallback' : 'error-path'
}

type ItemOutcome = 'done' | 'skipped' | 'failed' | 'active'

/** The outcome of each item frame directly inside `containerId` (`for_each[3]`), by index. */
function collectItemOutcomes(tracks: Map<string, NodeTrack>, containerId: string): Map<number, ItemOutcome> {
  const outcomes = new Map<number, ItemOutcome>()
  const rank: Record<ItemOutcome, number> = { done: 0, skipped: 1, failed: 2, active: 3 }
  tracks.forEach((track) =>
    track.executionsByFrame.forEach((execution) => {
      const segment = parseFrame(execution.frame).at(-1)
      if (!segment || segment.containerId !== containerId) return
      const outcome: ItemOutcome =
        execution.state === 'running' || execution.state === 'waiting' ? 'active' : execution.state === 'failed' ? 'failed' : execution.state === 'skipped' ? 'skipped' : 'done'
      const previous = outcomes.get(segment.index)
      if (!previous || rank[outcome] > rank[previous]) outcomes.set(segment.index, outcome)
    }),
  )
  return outcomes
}

function buildLoopProgress(step: RunStepView, tracks: Map<string, NodeTrack>): LoopRunProgress | null {
  if (!step.iteration) return null
  const outcomesByIndex = collectItemOutcomes(tracks, step.id)
  // The item in progress is not finished yet, whatever its steps did so far.
  const isInProgress = step.state === 'running' || step.state === 'waiting'
  if (isInProgress && step.iteration.currentNumber !== null) outcomesByIndex.set(step.iteration.currentNumber - 1, 'active')
  const outcomes = [...outcomesByIndex.values()]
  const count = (outcome: ItemOutcome) => outcomes.filter((itemOutcome) => itemOutcome === outcome).length
  const skippedCount = count('skipped')
  const failedCount = count('failed')
  const finishedCount = outcomes.length - count('active')
  const doneCount = step.state === 'done' && outcomes.length === 0 ? step.iteration.doneCount : finishedCount - skippedCount - failedCount
  return { currentNumber: step.iteration.currentNumber, total: step.iteration.total, doneCount: Math.max(0, doneCount), skippedCount, failedCount, isLoop: step.iteration.isLoop }
}

function buildNodeView(step: RunStepView, context: { node: GraphNode | undefined; facts: NodeEventFacts; tracks: Map<string, NodeTrack>; approvals: PendingApproval[] }): NodeRunView {
  const { node, facts, tracks, approvals } = context
  const status = toNodeStatus(step, node, facts.failureByNode.get(step.id))
  const attempt = step.retryCount + 1
  const configuredAttempts = (node?.retry.maxRetries ?? 0) + 1
  return {
    nodeId: step.id,
    status,
    startedAt: step.startedAt,
    durationMs: step.durationMs,
    attempt,
    maxAttempts: Math.max(configuredAttempts, attempt),
    errorMessage: step.errorMessage ?? (step.state === 'running' ? step.lastRetryError : null),
    loop: node?.container ? buildLoopProgress(step, tracks) : null,
    itemsDoneCount: step.itemsDoneCount,
    approval: status === 'waiting' ? (approvals.find((approval) => approval.nodeId === step.id) ?? null) : null,
    step,
  }
}

const finishedStatuses = new Set<NodeRunStatus>(['done', 'fallback', 'error-path', 'failed', 'skipped'])

/** Whether an arrow out of a finished node was the way the run went. */
function isEdgeChosen(edge: GraphEdge, source: NodeRunView, branch: string | undefined): boolean {
  if (source.status === 'error-path') return edge.sourceHandle === FAIL_BRANCH_HANDLE
  if (edge.sourceHandle === FAIL_BRANCH_HANDLE) return false
  if (branch) return edge.sourceHandle === branch
  return edge.sourceHandle === SOURCE_HANDLE || source.status !== 'skipped'
}

function deriveEdgeState(edge: GraphEdge, nodes: Record<string, NodeRunView>, facts: NodeEventFacts): EdgeRunState | null {
  const source = nodes[edge.source]
  const target = nodes[edge.target]
  if (!source || !finishedStatuses.has(source.status)) return null
  if (source.status === 'skipped' || target?.status === 'skipped') return 'skipped'
  if (source.status === 'failed') return null
  if (!isEdgeChosen(edge, source, facts.branchByNode.get(edge.source))) return 'skipped'
  if (!target || target.status === 'pending') return source.status === 'error-path' ? 'error-taken' : null
  return source.status === 'error-path' ? 'error-taken' : 'taken'
}

const topLevelFinished = new Set<NodeRunStatus>(['done', 'fallback', 'error-path', 'skipped'])

/**
 * The canvas state of one run.
 *
 * @param graph - The graph on the canvas (AgentGraph)
 * @param events - The run's events ordered by seq (RunEventRecord[])
 * @param approvals - Questions the run waits on now (`readPendingApprovals(run)`) (PendingApproval[])
 * @returns Node views by node id, arrow states by edge id and counters (RunCanvasState)
 *
 * @example
 * const runState = buildRunCanvasState(graph, liveRun.events, readPendingApprovals(liveRun.run))
 * runState.nodes.send_whatsapp.status // "error-path"
 */
export function buildRunCanvasState(graph: AgentGraph, events: RunEventRecord[], approvals: PendingApproval[] = []): RunCanvasState {
  const template = buildGraphStepTemplate(graph)
  const steps = buildRunStepViews(template, events)
  const tracks = collectNodeTracks(events)
  const facts = collectNodeEventFacts(events)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const nodes: Record<string, NodeRunView> = {}
  for (const step of steps) nodes[step.id] = buildNodeView(step, { node: nodesById.get(step.id), facts, tracks, approvals })
  const edges: Record<string, EdgeRunState> = {}
  for (const edge of graph.edges) {
    const edgeState = deriveEdgeState(edge, nodes, facts)
    if (edgeState) edges[edge.id] = edgeState
  }
  const topLevel = steps.filter((step) => step.depth === 0)
  return {
    nodes,
    edges,
    handledErrorCount: facts.handledErrorCount,
    doneCount: topLevel.filter((step) => topLevelFinished.has(nodes[step.id].status)).length,
    totalCount: topLevel.length,
  }
}

/** Frame-independent id of the item in progress, e.g. for "business 3 of 10" in the run bar. */
export function describeCurrentItem(graph: AgentGraph, runState: RunCanvasState): string | null {
  for (const node of graph.nodes) {
    const loop = runState.nodes[node.id]?.loop
    if (!loop || loop.currentNumber === null || !['running', 'waiting'].includes(runState.nodes[node.id].status)) continue
    const noun = /^for each (.+)$/i.exec(node.displayTitle.trim())?.[1]?.toLowerCase() ?? (loop.isLoop ? 'round' : 'item')
    return loop.total === null ? `${noun} ${loop.currentNumber}` : `${noun} ${loop.currentNumber} of ${loop.total}`
  }
  return null
}
