import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { connectionsAddFormParam } from '@/routes'

/** The card look every block on the Connections page shares (same as the Plugins grid cards). */
export const connectionsCardClassNames = 'rounded-[14px] border border-line bg-surface'

interface ConnectionsSectionProps {
  /** Element id, also used to build the heading id that names the region. */
  id: string
  /** Names the region for screen readers; the selected tab above already shows it. */
  title: string
  /** One line saying what the tab is for. */
  description: ReactNode
  /** A button at the tab's top-right, e.g. "Add secret". */
  action?: ReactNode
  children: ReactNode
}

/**
 * The content of one Connections tab: a one-line explanation with an optional action on
 * the right, then its cards. The visually hidden heading names the region, since the
 * selected tab already shows the title.
 */
export function ConnectionsSection({ id, title, description, action, children }: ConnectionsSectionProps) {
  const headingId = `${id}-h`
  return (
    <section id={id} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <h2 id={headingId} className="sr-only">
        {title}
      </h2>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 min-w-0 flex-[1_1_320px] text-[13px] leading-normal text-muted">{description}</p>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A quiet dashed box for "nothing here yet", loading and load errors inside a section. */
export function ConnectionsNotice({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' }) {
  return (
    <p
      className={joinClassNames(
        'm-0 rounded-[14px] border border-dashed px-4 py-4 text-[13px] leading-normal',
        tone === 'danger' ? 'border-danger-line bg-danger-tint text-danger' : 'border-line-heavy bg-subtle text-muted',
      )}
    >
      {children}
    </p>
  )
}

/** Whether the tab was opened with `?add=1` (e.g. from an old `?section=secrets` link), so its add form starts open. */
export function useOpensAddForm(): boolean {
  const [searchParams] = useSearchParams()
  return searchParams.get(connectionsAddFormParam) === '1'
}
