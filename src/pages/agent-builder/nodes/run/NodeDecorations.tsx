import { createContext, useContext, type ReactNode } from 'react'
import type { GraphProblem } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { describeDeadline } from '@/pages/agent-run/approvalDisplay'
import { LiveBrowserView } from '@/pages/agent-run/LiveBrowserView'
import { formatDurationMs, formatElapsedClock } from '@/pages/agent-run/runProgress'
import { describeProblemLabel } from '../problems/problemDisplay'
import { useCanvasNow } from './CanvasClock'
import type { LoopRunProgress, NodeRunStatus, NodeRunView, RunCanvasState } from './nodeRunStates'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/**
 * What the canvas draws on top of each node card: the live run state (spec D1–D3) and the
 * validation problems (spec E). `NodesView` provides it around the canvas; the node renderers
 * (`flow/StepNode.tsx`, canvas agent) render {@link NodeDecoration} inside each card, which must
 * be `position: relative`. Arrow states are drawn by `RunCanvasStyles`, without touching the
 * canvas code.
 *
 * The value holds no clock: live times are read from `CanvasClock` by the leaf badges only, so
 * the provider value (memoized by `NodesView`) changes only when the run or the problems do.
 */
export interface NodeDecorationsValue {
  /** The shown run, or null when none. */
  run: RunCanvasState | null
  problemsByNode: Record<string, GraphProblem[]>
  /** Live browser pictures of running steps by node id (null: waiting for the first one). */
  liveViews: Map<string, string | null>
  /** Opens the question a waiting node asks (Review). */
  onReviewApproval?: (nodeId: string) => void
}

const emptyDecorations: NodeDecorationsValue = { run: null, problemsByNode: {}, liveViews: new Map() }

const NodeDecorationsContext = createContext<NodeDecorationsValue>(emptyDecorations)

export function NodeDecorationsProvider({ value, children }: { value: NodeDecorationsValue; children: ReactNode }) {
  return <NodeDecorationsContext.Provider value={value}>{children}</NodeDecorationsContext.Provider>
}

/** The decorations of the whole canvas (for renderers that need more than one node). */
export function useNodeDecorations(): NodeDecorationsValue {
  return useContext(NodeDecorationsContext)
}

const statusLabels: Readonly<Record<NodeRunStatus, string>> = localizedRecord(() => messages().nodes.runStatus)

const statusClassNames: Record<NodeRunStatus, string> = {
  pending: 'border-line-strong bg-surface text-muted',
  running: 'border-brand-line bg-brand-soft text-brand-strong',
  done: 'border-ok-soft bg-ok-tint text-ok-strong',
  waiting: 'border-amber-line bg-amber-soft text-amber-strong',
  failed: 'border-danger-line bg-danger-soft text-danger',
  'error-path': 'border-danger-line bg-danger-soft text-danger',
  fallback: 'border-amber-line bg-amber-soft text-amber-strong',
  skipped: 'border-line-strong bg-subtle text-faint',
}

/** Outline of the card by run status (drawn over the card's own border). */
const outlineClassNames: Partial<Record<NodeRunStatus, string>> = {
  running: 'border-brand',
  waiting: 'border-amber',
  failed: 'border-danger',
  'error-path': 'border-danger',
  done: 'border-ok/60',
  fallback: 'border-amber-line',
}

function StatusIcon({ status }: { status: NodeRunStatus }) {
  if (status === 'running') return <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-brand border-t-transparent motion-safe:animate-spin" />
  if (status === 'done' || status === 'fallback') return <span aria-hidden="true">✓</span>
  if (status === 'failed' || status === 'error-path') return <span aria-hidden="true">✕</span>
  if (status === 'waiting') return <span aria-hidden="true" className="size-2 rounded-full bg-amber" />
  return null
}

const finishedStatuses: ReadonlySet<NodeRunStatus> = new Set(['done', 'fallback', 'failed', 'error-path'])

/** "· 0:42" since a running step started; the only part of a card that follows the clock. */
function ElapsedTime({ startedAt }: { startedAt: string }) {
  const now = useCanvasNow()
  return <span className="font-medium opacity-80">· {formatElapsedClock(now - Date.parse(startedAt))}</span>
}

function RunTiming({ view }: { view: NodeRunView }) {
  if (view.status === 'running' && view.startedAt) return <ElapsedTime startedAt={view.startedAt} />
  if (view.durationMs !== null && finishedStatuses.has(view.status)) return <span className="font-medium opacity-80">· {formatDurationMs(view.durationMs)}</span>
  return null
}

function RunStatusChip({ view }: { view: NodeRunView }) {
  return (
    <span
      data-testid={`run-status-${view.nodeId}`}
      data-status={view.status}
      className={joinClassNames('absolute -top-2.5 right-3 z-10 flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-semibold whitespace-nowrap', statusClassNames[view.status])}
    >
      <StatusIcon status={view.status} />
      {statusLabels[view.status]}
      <RunTiming view={view} />
    </span>
  )
}

/** "3 of 10", "8 done · 2 skipped · 1 failed" and a progress bar. */
function LoopCounters({ loop }: { loop: LoopRunProgress }) {
  const position = loop.currentNumber === null ? null : loop.total === null ? messages().nodes.roundCurrentnumber(loop.currentNumber) : `${loop.currentNumber} of ${loop.total}`
  const outcomes = [`${loop.doneCount} done`, loop.skippedCount > 0 && `${loop.skippedCount} skipped`, loop.failedCount > 0 && `${loop.failedCount} failed`].filter(Boolean).join(' · ')
  const finished = loop.doneCount + loop.skippedCount + loop.failedCount
  const percent = loop.total ? Math.min(100, Math.round((finished / loop.total) * 100)) : null
  return (
    <div data-testid="loop-counters" className="flex min-w-[140px] flex-col gap-1 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        {position && <span className="font-semibold text-ink">{position}</span>}
        <span className={joinClassNames(loop.failedCount > 0 ? 'text-danger' : 'text-muted')}>{outcomes}</span>
      </div>
      {percent !== null && (
        <div role="progressbar" aria-label={messages().nodes.itemsFinished} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}

/** The lines under a card: error, attempts, handled-error outcome, question deadline and Review. */
/** "Answer within 4 min": follows the clock, so it reads it itself. */
function ApprovalDeadline({ approval }: { approval: NonNullable<NodeRunView['approval']> }) {
  const deadline = describeDeadline(approval, useCanvasNow())
  if (!deadline) return null
  return <span className="font-medium text-amber-strong">{deadline}</span>
}

function RunDetailLines({ view, onReview }: { view: NodeRunView; onReview?: (nodeId: string) => void }) {
  const lines: ReactNode[] = []
  if (view.errorMessage && view.status !== 'done') lines.push(<span key="error" className="text-danger">{view.errorMessage}</span>)
  if (view.attempt > 1 || (view.maxAttempts > 1 && ['failed', 'error-path'].includes(view.status))) {
    lines.push(<span key="attempt" className="font-medium text-ink-2">{messages().nodes.attempt}{' '}{view.attempt} {messages().nodes.of}{' '}{view.maxAttempts}</span>)
  }
  if (view.status === 'error-path') lines.push(<span key="handled" className="font-medium text-danger">{messages().nodes.goingToTheErrorPathSuccess}</span>)
  if (view.status === 'fallback') lines.push(<span key="handled" className="font-medium text-amber-strong">{messages().nodes.continuedWithFallbackValues}</span>)
  if (view.itemsDoneCount !== null && view.itemsDoneCount > 0) lines.push(<span key="items" className="text-muted">{view.itemsDoneCount} {messages().nodes.done}</span>)
  if (view.approval?.expiresAt) lines.push(<ApprovalDeadline key="deadline" approval={view.approval} />)
  if (view.status === 'waiting' && view.approval && onReview) {
    lines.push(
      <button
        key="review"
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onReview(view.nodeId)
        }}
        className="nodrag nopan cursor-pointer self-start rounded-md border border-amber-line bg-amber px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-strong"
      >
        {view.approval.toolCall ? messages().nodes.reviewTheToolCall : messages().nodes.review}
      </button>,
    )
  }
  if (lines.length === 0) return null
  return <div className="flex flex-col gap-0.5 text-[11px] leading-snug">{lines}</div>
}

function ProblemChip({ problems }: { problems: GraphProblem[] }) {
  const first = problems.find((problem) => problem.severity === 'error') ?? problems[0]
  const isError = first.severity === 'error'
  return (
    <span
      data-testid="node-problem-chip"
      title={first.message}
      className={joinClassNames(
        'absolute -top-2.5 right-3 z-10 rounded-full border px-2 py-[1px] text-[11px] font-semibold whitespace-nowrap',
        isError ? 'border-danger-line bg-danger-soft text-danger' : 'border-amber-line bg-amber-soft text-amber-strong',
      )}
    >
      {describeProblemLabel(first)}
      {problems.length > 1 ? ` +${problems.length - 1}` : ''}
    </span>
  )
}

function isNotConnected(problems: GraphProblem[]): boolean {
  return problems.some((problem) => problem.code === 'unreachable' && problem.edgeId === null)
}

export interface NodeDecorationProps {
  nodeId: string
  /** `container`: For each / Repeat card (counters in its header); `step`: a step card. */
  variant?: 'step' | 'container'
}

/**
 * Run state and problems drawn on one node card: a status chip on the top edge, an outline,
 * and details under the card (or the loop counters in a container's header). Renders nothing
 * when the node has neither. Put it inside the card's `relative` root.
 *
 * @example
 * <div className="relative …"><NodeHeading … /><NodeDecoration nodeId={node.id} /></div>
 */
export function NodeDecoration({ nodeId, variant = 'step' }: NodeDecorationProps) {
  const { run, problemsByNode, liveViews, onReviewApproval } = useNodeDecorations()
  const view = run?.nodes[nodeId]
  const problems = problemsByNode[nodeId] ?? []
  if (!view) {
    if (problems.length === 0) return null
    return (
      <>
        {isNotConnected(problems) && <span aria-hidden="true" className="pointer-events-none absolute -inset-[3px] rounded-[14px] border-2 border-dashed border-danger" />}
        <ProblemChip problems={problems} />
      </>
    )
  }
  const outline = outlineClassNames[view.status]
  const liveImage = liveViews.get(nodeId)
  const hasLiveView = view.status === 'running' && liveImage !== undefined
  return (
    <>
      {outline && <span aria-hidden="true" className={joinClassNames('pointer-events-none absolute -inset-[2px] rounded-[14px] border-2', outline)} />}
      {view.status === 'skipped' && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl bg-surface/50" />}
      <RunStatusChip view={view} />
      {variant === 'container' && view.loop && (
        <div className="absolute top-3 right-3 z-10 rounded-md bg-surface/90 px-1.5 py-1">
          <LoopCounters loop={view.loop} />
        </div>
      )}
      <div className="absolute top-[calc(100%+6px)] left-0 z-10 flex w-full flex-col gap-1.5" data-testid={`run-details-${nodeId}`}>
        <RunDetailLines view={view} onReview={onReviewApproval} />
        {variant === 'step' && view.loop && <LoopCounters loop={view.loop} />}
        {hasLiveView && <LiveBrowserView image={liveImage} />}
      </div>
    </>
  )
}
