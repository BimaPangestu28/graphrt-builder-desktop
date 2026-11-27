import { Icon } from '@/components/ui'
import { messages } from '@/i18n'
import { emptyRow, type ListCell, type ListColumn, type ListRow } from './listInput'

interface ListRowsInputProps {
  columns: ListColumn[]
  rows: ListRow[]
  onChange: (rows: ListRow[]) => void
}

const cellClassNames = 'box-border h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ink'

/** Text columns get twice the width of numbers and checkboxes; the last track holds "Remove". */
function gridTemplate(columns: ListColumn[]): string {
  return [...columns.map((column) => (column.kind === 'text' ? 'minmax(0, 2fr)' : 'minmax(0, 1fr)')), '2rem'].join(' ')
}

/**
 * A list input as rows: a header with the column names, one line of fields per row with a
 * button to remove it, and "Add a row". Numbers are typed in number fields.
 */
export function ListRowsInput({ columns, rows, onChange }: ListRowsInputProps) {
  const t = messages().agentRun
  const gridStyle = { gridTemplateColumns: gridTemplate(columns) }

  const setCell = (rowIndex: number, key: string, cell: ListCell) => onChange(rows.map((row, index) => (index === rowIndex ? { ...row, [key]: cell } : row)))

  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" style={gridStyle} className="grid gap-1.5 text-[11px] font-medium text-muted">
        {columns.map((column) => (
          <span key={column.key} className="truncate">
            {column.label}
          </span>
        ))}
      </div>
      {rows.length === 0 && <span className="text-[13px] text-muted">{t.noRowsYet}</span>}
      {rows.map((row, rowIndex) => (
        // Rows have no identity of their own; the position is the key.
        <div key={rowIndex} style={gridStyle} className="grid items-center gap-1.5">
          {columns.map((column) => {
            const cell = row[column.key]
            const cellLabel = t.rowCell(column.label, rowIndex + 1)
            return column.kind === 'checkbox' ? (
              <input key={column.key} type="checkbox" aria-label={cellLabel} checked={cell === true} onChange={(event) => setCell(rowIndex, column.key, event.target.checked)} className="size-[18px] cursor-pointer accent-ink" />
            ) : (
              <input
                key={column.key}
                type="text"
                inputMode={column.kind === 'number' ? 'decimal' : undefined}
                aria-label={cellLabel}
                value={typeof cell === 'string' ? cell : ''}
                onChange={(event) => setCell(rowIndex, column.key, event.target.value)}
                className={`${cellClassNames} ${column.kind === 'number' ? 'text-right tabular-nums' : ''}`}
              />
            )
          })}
          <button
            type="button"
            aria-label={t.removeRow(rowIndex + 1)}
            onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-subtle hover:text-ink"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() => onChange([...rows, emptyRow(columns)])}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
        >
          <Icon name="plus" size={14} />
          {t.addRow}
        </button>
      </div>
    </div>
  )
}
