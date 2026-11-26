import { useState } from 'react'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { toneForItemStatus } from '@/pages/agent-run/runResultSummary'
import { formatDate, messages } from '@/i18n'
import { formatMaybeNumber } from '../format'
import type { TableBlock, TableCellValue, TableColumn } from '../uiBlockTypes'

/** Rows shown before "Show all rows". */
export const collapsedRowCount = 50

const numberFormats = new Set(['number', 'compact', 'percent', 'currency'])

/** Right for numbers (format or value), else the column's own alignment. */
export function cellAlignment(column: TableColumn, rows: TableBlock['rows']): 'left' | 'center' | 'right' {
  if (column.align) return column.align.toLowerCase() as 'left' | 'center' | 'right'
  if (column.format && numberFormats.has(column.format)) return 'right'
  const isNumeric = rows.length > 0 && rows.every((row) => row[column.key] === undefined || row[column.key] === null || typeof row[column.key] === 'number')
  return isNumeric ? 'right' : 'left'
}

/** The text of one cell: numbers in the column's format, dates in the app's language, booleans as Yes / No. */
export function formatCell(value: TableCellValue | undefined, column: TableColumn): string {
  if (typeof value === 'boolean') return value ? messages().visuals.yes : messages().visuals.no
  if (column.format === 'date' && typeof value === 'string') {
    const instant = new Date(value)
    return Number.isNaN(instant.getTime()) ? value : formatDate(instant)
  }
  const format = column.format && numberFormats.has(column.format) ? (column.format as 'number') : undefined
  return formatMaybeNumber(value, { format, currency: column.currency })
}

const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

/** A `table` block: sticky header, numbers right-aligned in tabular digits, status pills, 50 rows then "Show all". */
export function TableView({ block }: { block: TableBlock }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? block.rows : block.rows.slice(0, collapsedRowCount)
  const hidden = block.rows.length - rows.length
  const alignments = block.columns.map((column) => cellAlignment(column, block.rows))
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[520px] overflow-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-subtle">
            <tr className="text-muted">
              {block.columns.map((column, index) => (
                <th key={column.key} scope="col" className={`border-b border-line px-4 py-2.5 font-medium whitespace-nowrap ${alignClass[alignments[index]]}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-chip last:border-b-0 hover:bg-subtle">
                {block.columns.map((column, index) => {
                  const text = formatCell(row[column.key], column)
                  return (
                    <td key={column.key} className={`px-4 py-2.5 align-top ${alignClass[alignments[index]]} ${index === 0 ? 'font-medium text-ink' : 'text-body'} ${alignments[index] === 'right' ? 'tabular-nums whitespace-nowrap' : 'min-w-[96px]'}`}>
                      {column.format === 'status' && text ? <StatusPill tone={toneForItemStatus(text)}>{text}</StatusPill> : text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hidden > 0 || expanded) && block.rows.length > collapsedRowCount && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="cursor-pointer self-start border-0 bg-transparent p-0 text-[12px] font-medium text-brand underline">
          {expanded ? messages().visuals.showFewerRows : `${messages().visuals.showAllRows} (${messages().visuals.moreRows(hidden)})`}
        </button>
      )}
    </div>
  )
}

export default TableView
