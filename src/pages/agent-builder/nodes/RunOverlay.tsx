import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import type { RunOverlayProps } from './contracts'
import { RunCanvasStyles } from './run/RunCanvasStyles'
import { messages } from '@/i18n'

const noEdgeStates = {}

/**
 * Live test-run layer over the canvas (spec D1–D3): arrow states (taken, error path taken,
 * skipped) and problem arrows as scoped styles, and the question a waiting node asks once
 * Review is clicked on it (form approvals and agent tool approvals, with their expiry).
 * Node badges are drawn inside the cards by `run/NodeDecorations.tsx`; the run bar above the
 * canvas by `run/RunBar.tsx`. Renders nothing without `live`.
 */
export function RunOverlay({ live, problems = [] }: RunOverlayProps) {
  if (!live) return <RunCanvasStyles edgeStates={noEdgeStates} problems={problems} />
  const { runState, approvals, reviewNodeId, setReviewNodeId, testRun } = live
  const approval = reviewNodeId ? (approvals.find((candidate) => candidate.nodeId === reviewNodeId) ?? null) : null
  return (
    <>
      <RunCanvasStyles edgeStates={runState?.edges ?? noEdgeStates} problems={problems} />
      {approval && (
        <div role="dialog" aria-label={messages().nodes.review} className="absolute top-3 right-3 z-20 flex max-h-[calc(100%-24px)] w-[min(420px,calc(100%-24px))] flex-col gap-2 overflow-y-auto">
          <div className="flex justify-end">
            <button type="button" onClick={() => setReviewNodeId(null)} className="cursor-pointer rounded-md border border-line-strong bg-surface px-2 py-0.5 text-[12px] text-ink hover:bg-subtle">
              {messages().nodes.close}
            </button>
          </div>
          <ApprovalCard
            key={`${testRun.runId}-${approval.id}`}
            approval={approval}
            isSubmitting={testRun.isAnswering}
            onAnswer={(answer) => {
              void testRun.answerApproval(approval, answer).then(() => setReviewNodeId(null))
            }}
          />
        </div>
      )}
    </>
  )
}
