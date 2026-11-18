import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

/**
 * Status pills used in run tables and title rows.
 * - size "table": 3px 8px, weight 500, inherits the table's 13px text (Sent, Done, Failed)
 * - size "title": 12px, 4px 10px, weight 600 (Waiting for you, Succeeded)
 *
 * Differs from the shared Badge in padding and weight, so it is kept local to these screens.
 */
export type StatusPillTone = 'ok' | 'neutral' | 'amber' | 'danger'

const toneClassNames: Record<StatusPillTone, string> = {
  ok: 'bg-ok-soft text-ok-strong',
  neutral: 'bg-canvas text-ink-2',
  amber: 'bg-amber-soft text-amber-strong',
  danger: 'bg-danger-soft text-danger',
}

const sizeClassNames = {
  table: 'px-2 py-[3px] font-medium',
  title: 'px-2.5 py-1 text-[12px] font-semibold',
  card: 'px-2 py-[3px] text-[12px] font-medium',
}

export function StatusPill({ tone, size = 'table', children }: { tone: StatusPillTone; size?: keyof typeof sizeClassNames; children: ReactNode }) {
  return <span className={joinClassNames('rounded-full whitespace-nowrap', toneClassNames[tone], sizeClassNames[size])}>{children}</span>
}
