import { runStatusLabels, type RunStatus } from '@/pages/runs/runRecordTypes'

const statusClassNames: Record<RunStatus, string> = {
  running: 'bg-brand-soft text-brand-strong',
  done: 'bg-ok-soft text-ok-strong',
  needsYou: 'bg-amber-soft text-amber-strong',
  failed: 'bg-danger-soft text-danger',
  stopped: 'bg-chip text-ink-2',
}

/** Compact status pill used in the runs table (13px, medium weight, tighter than the shared Badge). */
export function RunStatusPill({ status }: { status: RunStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-[3px] font-medium ${statusClassNames[status]}`}>{runStatusLabels[status]}</span>
}
