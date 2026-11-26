import { messages } from '@/i18n'
/**
 * The builder chat's line for a save from the Nodes view (spec 45): "Edited in Nodes: moved
 * Write the run report and set Retry 2× on Send · v9 · Undo". Undo restores the version before
 * it (which adds a version; history is never rewritten), Redo goes forward again.
 */

interface NodesEditNoticeProps {
  /** "Edited in Nodes: …" as saved with the version. */
  summary: string
  versionAfter: number
  versionBefore: number
  /** Set on the latest change only (it can be undone). */
  isUndone: boolean | null
  isBusy: boolean
  onToggleUndo: () => void
}

export function NodesEditNotice({ summary, versionAfter, versionBefore, isUndone, isBusy, onToggleUndo }: NodesEditNoticeProps) {
  return (
    <div data-testid="nodes-edit-notice" className="flex max-w-[92%] flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-subtle px-3.5 py-2.5 text-[13px] leading-[1.5]">
      <span className="min-w-0 flex-1">
        {isUndone ? messages().nodes.undoneBackToVVersionbefore(versionBefore) : summary}
        <span className="text-muted"> · v{versionAfter}</span>
      </span>
      {isUndone !== null && (
        <button
          type="button"
          onClick={onToggleUndo}
          disabled={isBusy}
          className="h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink hover:bg-surface/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUndone ? messages().nodes.redo : messages().nodes.undo}
        </button>
      )}
    </div>
  )
}
