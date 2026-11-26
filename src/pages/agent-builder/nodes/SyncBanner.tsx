import { useMemo } from 'react'
import type { SyncBannerProps } from './contracts'
import { describeQueuedEdits, type NodeMergeConflict } from './sync/graphMerge'
import { messages } from '@/i18n'

const bannerButtonClassNames = 'cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium text-ink bg-surface disabled:cursor-default disabled:opacity-50'

function ConflictRow({ conflict, onChoose }: { conflict: NodeMergeConflict; onChoose: (choice: 'keep-mine' | 'keep-theirs') => void }) {
  const builderRemoved = conflict.theirs === null
  const iRemoved = conflict.mine === null
  return (
    <li data-testid={`conflict-${conflict.nodeId}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-line bg-surface px-3 py-2">
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
        <span className="font-semibold text-ink">{builderRemoved ? messages().nodes.theBuilderRemovedTitle(conflict.title) : messages().nodes.theBuilderAlsoChangedTitle(conflict.title)}</span>
        <span className="text-[12px] text-body">
          {iRemoved
            ? messages().nodes.youRemovedThisStepWhileThe
            : messages().nodes.yourWaitingEditAndTheBuilders}
        </span>
      </div>
      <button type="button" onClick={() => onChoose('keep-mine')} className={`${bannerButtonClassNames} border-amber-line`}>
        {messages().nodes.keepMine}
      </button>
      <button type="button" onClick={() => onChoose('keep-theirs')} className={`${bannerButtonClassNames} border-amber-line`}>
        {messages().nodes.keepTheBuilders}
      </button>
    </li>
  )
}

/**
 * Sync state above the canvas (spec S1, artboard 45):
 * - while the builder changes the agent: "The builder is changing this agent", the edits
 *   waiting in the queue ("1 edit waiting: title of Ask a model") and Stop the builder;
 * - when its version landed and a waiting edit touched a step it changed too: one card per
 *   step with Keep mine / Keep the builder's (edits of other steps were re-applied already);
 * - right after waiting edits were re-applied onto the builder's version: a short note.
 */
export function SyncBanner({ controller, onStopBuilder }: SyncBannerProps) {
  const { savedGraph, graph, isDirty, builderBusy, conflict, lastMerge, status } = controller
  const queuedEdits = useMemo(() => (savedGraph && graph && isDirty ? describeQueuedEdits(savedGraph, graph) : []), [savedGraph, graph, isDirty])

  if (status === 'conflict' && conflict) {
    return (
      <div role="alert" className="flex flex-col gap-2 border-b border-amber-line bg-amber-tint px-4 py-2.5 text-[13px] text-amber-deep">
        <span className="font-medium">
          {messages().nodes.theBuilderSavedVersion}{' '}{conflict.latestVersion} {messages().nodes.whileYourEditsWaited}
          {lastMerge && lastMerge.reappliedNodeIds.length > 0 ? messages().nodes.yourEditsOfOtherStepsAre : ''}
        </span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {conflict.nodes.map((nodeConflict) => (
            <ConflictRow key={nodeConflict.nodeId} conflict={nodeConflict} onChoose={(choice) => void controller.resolveNodeConflict(nodeConflict.nodeId, choice)} />
          ))}
        </ul>
      </div>
    )
  }
  if (builderBusy) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 border-b border-brand-line bg-brand-tint px-4 py-2.5 text-[13px] text-brand-strong">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>
            <span className="font-semibold">{messages().nodes.theBuilderIsChangingThisAgent}</span> {messages().nodes.youCanLookAroundEditingNodes}
          </span>
          {queuedEdits.length > 0 && (
            <span data-testid="queued-edits" className="text-[12px] text-ink-2">
              {queuedEdits.length === 1 ? messages().nodes.n1EditWaiting : messages().nodes.valueEditsWaiting(queuedEdits.length)}: {queuedEdits.join(', ')}
            </span>
          )}
        </div>
        {onStopBuilder && (
          <button type="button" onClick={onStopBuilder} className={`${bannerButtonClassNames} border-brand-line`}>
            {messages().nodes.stopTheBuilder}
          </button>
        )}
      </div>
    )
  }
  if (lastMerge && lastMerge.reappliedNodeIds.length > 0 && isDirty && savedGraph?.version === lastMerge.latestVersion) {
    return (
      <div role="status" className="border-b border-brand-line bg-brand-tint px-4 py-2 text-[13px] text-brand-strong">
        {messages().nodes.theBuilderSavedVersion}{' '}{lastMerge.latestVersion}{messages().nodes.yourWaitingEditsAreBackOn}
      </div>
    )
  }
  return null
}
