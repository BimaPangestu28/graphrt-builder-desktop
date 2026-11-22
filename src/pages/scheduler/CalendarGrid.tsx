import { joinClassNames } from '@/components/ui'
import { calendarFirstHour, getCalendarHourLabels, getDayOfMonth, getWeekdayName, type CalendarEntry } from '@/lib/scheduleCalendar'
import { CalendarEntryBlock } from './CalendarEntryBlock'

interface CalendarGridProps {
  /** Dates shown as columns: seven for the week view, one for the day view. */
  dates: string[]
  entries: CalendarEntry[]
  todayIsoDate: string
  label: string
}

/** Grid row 1 is the day header, so hour H sits on row (H - firstHour + 2). */
function getGridRowForHour(hour: number): number {
  return hour - calendarFirstHour + 2
}

function DayColumnHeader({ isoDate, column, isToday }: { isoDate: string; column: number; isToday: boolean }) {
  return (
    <div
      style={{ gridColumn: column, gridRow: 1 }}
      className={joinClassNames(
        'flex flex-col items-center justify-center border-l border-l-chip text-[12px]',
        isToday ? 'border-b-2 border-b-brand bg-brand-tint font-semibold text-brand-strong' : 'border-b border-b-line text-muted',
      )}
    >
      {isToday ? 'Today' : getWeekdayName(isoDate)}
      <b className={joinClassNames('text-[16px]', isToday ? 'font-bold' : 'font-semibold text-ink')}>{getDayOfMonth(isoDate)}</b>
    </div>
  )
}

/**
 * Hour-by-day calendar from 06:00 to 12:00 with one run block per cell.
 * Today's column is tinted teal.
 */
export function CalendarGrid({ dates, entries, todayIsoDate, label }: CalendarGridProps) {
  const hourLabels = getCalendarHourLabels()
  const todayColumnIndex = dates.indexOf(todayIsoDate)
  return (
    <section aria-label={label} className="min-w-0 flex-[999_1_620px] overflow-x-auto rounded-2xl border border-line bg-surface">
      <div
        className="grid"
        style={{
          minWidth: dates.length > 1 ? 640 : undefined,
          gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))`,
          gridTemplateRows: `56px repeat(${hourLabels.length}, 64px)`,
        }}
      >
        <div style={{ gridColumn: 1, gridRow: 1 }} className="border-b border-line" />
        {dates.map((isoDate, dayIndex) => (
          <DayColumnHeader key={isoDate} isoDate={isoDate} column={dayIndex + 2} isToday={isoDate === todayIsoDate} />
        ))}
        {hourLabels.map(({ hour, label: hourLabel }) => (
          <span key={hour} style={{ gridColumn: 1, gridRow: getGridRowForHour(hour) }} className="pt-1.5 pr-2.5 text-right text-[12px] text-muted">
            {hourLabel}
          </span>
        ))}
        {todayColumnIndex >= 0 && (
          <div aria-hidden="true" className="bg-brand-tint" style={{ gridColumn: todayColumnIndex + 2, gridRow: `2 / span ${hourLabels.length}` }} />
        )}
        {entries.map((entry) => (
          <CalendarEntryBlock
            key={entry.key}
            entry={entry}
            style={{ gridColumn: dates.indexOf(entry.date) + 2, gridRow: getGridRowForHour(entry.hour) }}
          />
        ))}
      </div>
    </section>
  )
}
