import type { ReactNode } from 'react'
import { joinClassNames } from './cn'

/**
 * Rounded pill used for page tabs and filter chips (Plugins tabs, Connections tabs, category
 * chips): solid ink when active, outlined otherwise.
 *
 * @param isActive - Whether this pill is the selected one (boolean)
 * @param size - 'md' for tabs, 'sm' for chips
 * @returns Tailwind class names (string)
 */
export function pillTabClassNames(isActive: boolean, size: 'md' | 'sm' = 'md'): string {
  return joinClassNames(
    'inline-flex cursor-pointer items-center gap-1.5 rounded-full font-medium whitespace-nowrap no-underline',
    size === 'md' ? 'h-[34px] px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
    isActive ? 'border border-ink bg-ink !text-inverse' : 'border border-line-strong bg-surface !text-ink hover:bg-subtle',
  )
}

interface PillTabBadgeProps {
  isActive: boolean
  /** Amber when it reports something to look at (updates, missing secrets), unless active. */
  isWarning?: boolean
  children: ReactNode
}

/** Small count or status after a pill tab's label, e.g. "3" or "1 missing". */
export function PillTabBadge({ isActive, isWarning = false, children }: PillTabBadgeProps) {
  return (
    <span
      className={joinClassNames(
        'rounded-full px-1.5 text-[11px] font-semibold',
        isActive ? 'bg-inverse/20' : isWarning ? 'bg-amber-soft text-amber-strong' : 'bg-chip text-ink-2',
      )}
    >
      {children}
    </span>
  )
}
