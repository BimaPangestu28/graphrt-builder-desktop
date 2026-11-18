import type { RunResultStat, TestRunPlace } from '@/data/testRun'
import { StatusPill } from './StatusPill'

/** Four stat tiles: places found, messages sent, time, AI cost. */
export function RunStatTiles({ stats }: { stats: RunResultStat[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3.5">
          <dt className="text-[12px] text-muted">{stat.label}</dt>
          <dd className="m-0 text-[22px] font-semibold">{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const cellClassNames = 'px-4 py-3'
const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'

/** Table of places the test touched, with a trailing "N more places" row. */
export function RunPlacesTable({ places, hiddenPlaceCount }: { places: TestRunPlace[]; hiddenPlaceCount: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className={headerCellClassNames}>Place</th>
            <th scope="col" className={headerCellClassNames}>Phone</th>
            <th scope="col" className={headerCellClassNames}>Status</th>
          </tr>
        </thead>
        <tbody>
          {places.map((place) => (
            <tr key={place.id} className="border-b border-chip">
              <td className={`${cellClassNames} font-medium`}>{place.name}</td>
              <td className={`${cellClassNames} text-body`}>{place.phone}</td>
              <td className={cellClassNames}>
                <StatusPill tone={place.outcome === 'Sent' ? 'ok' : 'neutral'}>{place.outcome}</StatusPill>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className={`${cellClassNames} text-body`}>
              {hiddenPlaceCount} more places
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
