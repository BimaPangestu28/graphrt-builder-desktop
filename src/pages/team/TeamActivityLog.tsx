import type { TeamActivityEntry } from '@/api/teamTypes'
import { messages } from '@/i18n'

/** "13:05" in the viewer's time zone. */
function formatClockTime(isoTime: string): string {
  const time = new Date(isoTime)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}

/** Screen 13 · what the team and its members did lately, from their runs, newest first. */
export function TeamActivityLog({ entries, error }: { entries: TeamActivityEntry[] | null; error: Error | null }) {
  return (
    <section aria-labelledby="team-activity-heading" className="flex min-w-0 flex-[3_1_320px] flex-col gap-3">
      <h2 id="team-activity-heading" className="m-0 text-[15px] font-semibold">
        {messages().team.activity}
      </h2>
      {error && <p className="m-0 text-[13px] text-amber-strong">{messages().team.couldNotLoadTheActivity}{' '}{error.message}</p>}
      {entries?.length === 0 && <p className="m-0 text-[13px] text-muted">{messages().team.nothingYetActivityShowsUpOnce}</p>}
      <ol className="m-0 flex list-none flex-col p-0">
        {entries?.map((entry) => (
          <li key={entry.id} className="flex gap-3 border-b border-chip py-2.5 last:border-b-0">
            <time dateTime={entry.at} className="w-11 shrink-0 text-[12px] text-muted">
              {formatClockTime(entry.at)}
            </time>
            <span className="leading-normal">
              {entry.parts.map((part, partIndex) =>
                part.isMember ? (
                  <b key={partIndex} className="font-semibold">
                    {part.text}
                  </b>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
