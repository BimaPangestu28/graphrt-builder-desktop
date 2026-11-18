import type { ReactNode } from 'react'
import { joinClassNames } from './cn'

/**
 * Small pill labels. Tones follow the mockup's semantics:
 * neutral (grey chip), brand (teal), ok (green: active, passed), amber (waiting on you), danger (failed).
 */
export type BadgeTone = 'neutral' | 'brand' | 'ok' | 'amber' | 'danger'

const toneClassNames: Record<BadgeTone, string> = {
  neutral: 'bg-chip text-ink-2',
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok-strong',
  amber: 'bg-amber-soft text-amber-strong',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={joinClassNames('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap', toneClassNames[tone], className)}>
      {children}
    </span>
  )
}

/** 8px status dot. green = running/online, grey = paused, amber = waiting, red = failed. */
export type StatusDotTone = 'ok' | 'paused' | 'amber' | 'danger' | 'brand'

const dotClassNames: Record<StatusDotTone, string> = {
  ok: 'bg-ok',
  paused: 'bg-faint',
  amber: 'bg-amber',
  danger: 'bg-danger',
  brand: 'bg-teal',
}

export function StatusDot({ tone = 'ok', className }: { tone?: StatusDotTone; className?: string }) {
  return <span aria-hidden="true" className={joinClassNames('inline-block size-2 shrink-0 rounded-full', dotClassNames[tone], className)} />
}
