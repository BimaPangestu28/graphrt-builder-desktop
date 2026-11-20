import type { SyncBannerProps } from './contracts'

/**
 * Sync state above the canvas (spec S1). Phase 1: the builder-busy notice and the
 * Keep mine / Keep the builder's choice after a conflict. Phase 2 (live/sync agent)
 * adds the queued-edit details and Stop the builder.
 */
export function SyncBanner({ controller }: SyncBannerProps) {
  if (controller.status === 'conflict' && controller.conflict) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-line bg-amber-tint px-4 py-2.5 text-[13px] text-amber-deep">
        <span className="flex-1">The builder saved version {controller.conflict.latestVersion} while you were editing. Choose which one to keep; the other stays in History</span>
        <button type="button" onClick={() => void controller.resolveConflict('keep-mine')} className="cursor-pointer rounded-lg border border-amber-line bg-surface px-3 py-1.5 font-medium text-ink">
          Keep mine
        </button>
        <button type="button" onClick={() => void controller.resolveConflict('keep-theirs')} className="cursor-pointer rounded-lg border border-amber-line bg-surface px-3 py-1.5 font-medium text-ink">
          Keep the builder's
        </button>
      </div>
    )
  }
  if (controller.builderBusy) {
    return (
      <div role="status" className="border-b border-brand-line bg-brand-tint px-4 py-2.5 text-[13px] text-brand-strong">
        The builder is changing this agent. You can look around; editing nodes waits until it is done
      </div>
    )
  }
  return null
}
