import { joinClassNames } from '@/components/ui'
import { runStatusLabels, type RunStatus } from '@/pages/runs/runRecordTypes'

const statusClassNames: Record<RunStatus, string> = {
  running: 'bg-brand-soft text-brand-strong',
  done: 'bg-ok-soft text-ok-strong',
  needsYou: 'bg-amber-soft text-amber-strong',
  failed: 'bg-danger-soft text-danger',
  stopped: 'bg-chip text-ink-2',
}

/** Dot colour per status; `running` also pulses (unless the user asks for less motion). */
export const runStatusDotClassNames: Record<RunStatus, string> = {
  running: 'bg-brand motion-safe:animate-pulse',
  done: 'bg-ok',
  needsYou: 'bg-amber',
  failed: 'bg-danger',
  stopped: 'bg-faint',
}

/** Compact status pill used in the runs table: a coloured dot and the status in plain words. */
export function RunStatusPill({ status }: { status: RunStatus }) {
  return (
    <span className={joinClassNames('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[12px] font-semibold', statusClassNames[status])}>
      <span aria-hidden="true" className={joinClassNames('size-1.5 shrink-0 rounded-full', runStatusDotClassNames[status])} />
      {runStatusLabels[status]}
    </span>
  )
}
