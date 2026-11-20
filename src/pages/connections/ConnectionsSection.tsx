import { useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'

/** The card look every block on the Connections page shares (same as the Plugins grid cards). */
export const connectionsCardClassNames = 'rounded-[14px] border border-line bg-surface'

/** Sections that `?section=` can open and scroll to. */
export type LinkableConnectionsSection = 'secrets' | 'mcp'

interface ConnectionsSectionProps {
  /** Element id, also used to build the heading id that names the region. */
  id: string
  title: string
  /** One line under the title saying what the section is for. */
  description?: ReactNode
  /** A button on the right of the title, e.g. "Add secret". */
  action?: ReactNode
  children: ReactNode
}

/**
 * One section of the Connections page: a title with a one-line explanation and an
 * optional action on the right, then its cards. The heading names the region.
 */
export function ConnectionsSection({ id, title, description, action, children }: ConnectionsSectionProps) {
  const headingId = `${id}-h`
  return (
    <section id={id} aria-labelledby={headingId} className="flex min-w-0 scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="m-0 text-[16px] font-semibold tracking-[-0.2px]">
            {title}
          </h2>
          {description && <p className="m-0 text-[13px] leading-normal text-muted">{description}</p>}
        </div>
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

/** Whether the page was opened with `?section=<section>` (e.g. from a "Set it in Connections" link). */
export function useIsLinkedSection(section: LinkableConnectionsSection): boolean {
  const [searchParams] = useSearchParams()
  return searchParams.get('section') === section
}

/**
 * Scrolls to the section once when the page was opened with `?section=<section>`.
 *
 * @param section - Which `?section=` value this section answers to
 * @param elementId - The id of the section element to scroll to
 */
export function useScrollToLinkedSection(section: LinkableConnectionsSection, elementId: string): void {
  const isLinked = useIsLinkedSection(section)
  useEffect(() => {
    if (isLinked) document.getElementById(elementId)?.scrollIntoView?.({ block: 'start' })
    // Only on the first render: later searches must not jump the page around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
