import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { CalendarEntry, CalendarEntryKind } from '@/data/scheduler'
import { routePaths } from '@/routes'

const entryKindClassNames: Record<CalendarEntryKind, string> = {
  done: 'bg-ok-soft !text-ok-deep hover:bg-ok-soft/70',
  failed: 'bg-danger-soft !text-danger-deep hover:bg-danger-soft/70',
  needsYou: 'border border-amber-line bg-amber-soft !text-[#7C2D12] hover:bg-amber-soft/70',
  planned: 'border border-dashed border-brand text-brand-strong',
  paused: 'border border-dashed border-faint text-body',
}

/** Where clicking a finished run takes you: the run list, the failure details, or the approval queue. */
const entryKindDestinations: Partial<Record<CalendarEntryKind, string>> = {
  done: routePaths.runs,
  failed: routePaths.errorStates,
  needsYou: routePaths.batchApproval,
}

interface CalendarEntryBlockProps {
  entry: CalendarEntry
  style?: CSSProperties
}

/**
 * One run on the calendar. Past runs are links to their results; planned and paused runs are plain blocks
 * (dashed teal for planned, dashed grey for paused).
 */
export function CalendarEntryBlock({ entry, style }: CalendarEntryBlockProps) {
  const className = joinClassNames(
    'm-1 flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-[12px] no-underline',
    entryKindClassNames[entry.kind],
  )
  const content = (
    <>
      <b className="truncate font-semibold">{entry.title}</b>
      <span className="truncate">{entry.detail}</span>
    </>
  )
  const destination = entryKindDestinations[entry.kind]
  if (destination) {
    return (
      <Link to={destination} className={className} style={style}>
        {content}
      </Link>
    )
  }
  return (
    <div className={className} style={style}>
      {content}
    </div>
  )
}
