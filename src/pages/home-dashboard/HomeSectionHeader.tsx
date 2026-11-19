import type { ReactNode } from 'react'

interface HomeSectionHeaderProps {
  /** Id the section's `aria-labelledby` points at (string) */
  headingId: string
  heading: ReactNode
  /** Optional link or button on the right, e.g. "See all runs" (ReactNode) */
  trailing?: ReactNode
}

/**
 * Heading row shared by the Home sections: one heading size and one row height, so sections
 * placed side by side start their content on the same line.
 */
export function HomeSectionHeader({ headingId, heading, trailing }: HomeSectionHeaderProps) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h2 id={headingId} className="m-0 flex items-center gap-2 text-[16px] font-semibold">
        {heading}
      </h2>
      {trailing}
    </div>
  )
}
