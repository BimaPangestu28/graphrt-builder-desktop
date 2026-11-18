import type { RunResultStat } from '@/data/testRun'
import type { RunResultTable } from './runResultSummary'
import { StatusPill } from './StatusPill'

/** Up to four stat tiles: the run's counters, time and AI tokens. */
export function RunStatTiles({ stats }: { stats: RunResultStat[] }) {
  if (stats.length === 0) return null
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

/** Table of the things the run handled (its `items`), with an optional trailing "N more" row. */
export function RunItemsTable({ table }: { table: RunResultTable }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            {table.columns.map((column) => (
              <th key={column} scope="col" className={headerCellClassNames}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id} className="border-b border-chip last:border-b-0">
              {row.cells.map((cell, cellIndex) => (
                <td key={`${row.id}-${cellIndex}`} className={cellIndex === 0 ? `${cellClassNames} font-medium` : `${cellClassNames} text-body`}>
                  {cell}
                </td>
              ))}
              <td className={cellClassNames}>
                <StatusPill tone={row.statusTone}>{row.status}</StatusPill>
              </td>
            </tr>
          ))}
          {table.moreLabel && (
            <tr className="border-t border-chip">
              <td colSpan={table.columns.length} className={`${cellClassNames} text-body`}>
                {table.moreLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
