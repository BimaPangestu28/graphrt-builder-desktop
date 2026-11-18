import { getDayOfMonth, getWeekdayName, type CalendarEntry } from '@/data/scheduler'
import { CalendarEntryBlock } from './CalendarEntryBlock'

interface ScheduleListProps {
  entries: CalendarEntry[]
  label: string
}

function compareEntriesByTime(first: CalendarEntry, second: CalendarEntry): number {
  return first.date.localeCompare(second.date) || first.hour - second.hour
}

/** The week's runs as a plain chronological list (the "List" view). */
export function ScheduleList({ entries, label }: ScheduleListProps) {
  const sortedEntries = [...entries].sort(compareEntriesByTime)
  return (
    <section aria-label={label} className="min-w-0 flex-[999_1_620px] rounded-2xl border border-line bg-surface p-2">
      {sortedEntries.length === 0 ? (
        <p className="m-0 p-4 text-body">Nothing scheduled this week</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {sortedEntries.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 border-b border-chip px-2 last:border-b-0">
              <span className="w-[88px] shrink-0 text-[12px] text-muted">
                {getWeekdayName(entry.date)} {getDayOfMonth(entry.date)} · {String(entry.hour).padStart(2, '0')}:00
              </span>
              <CalendarEntryBlock entry={entry} style={{ flex: '1 1 auto' }} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
