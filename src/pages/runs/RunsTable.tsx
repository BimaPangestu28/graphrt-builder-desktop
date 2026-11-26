import { Badge, joinClassNames } from '@/components/ui'
import type { RunRecord } from '@/pages/runs/runRecordTypes'
import { toPreviewText } from '@/lib/previewText'
import { RunStatusPill } from './RunStatusPill'
import { messages, useT } from '@/i18n'

interface RunsTableProps {
  runs: RunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  /** Shown in place of rows when there are none. */
  emptyMessage?: string
}

const headerCellClassNames = 'whitespace-nowrap border-b border-line px-3.5 py-3 font-medium'
/**
 * Fixed widths (table-fixed) keep a long result from squeezing the agent name onto several
 * lines; the Result column takes what is left, and the table stops growing past `max-w-[1100px]`.
 */
const columns = [
  { key: 'agent', widthClassName: 'w-[28%]' },
  { key: 'startedBy', widthClassName: 'w-[112px]' },
  { key: 'when', widthClassName: 'w-[124px]' },
  { key: 'result', widthClassName: '' },
  { key: 'status', widthClassName: 'w-[120px]' },
] as const

function RunRow({ run, isSelected, isLast, onSelectRun }: { run: RunRecord; isSelected: boolean; isLast: boolean; onSelectRun: (runId: string) => void }) {
  const cellClassNames = joinClassNames('px-3.5 py-3 align-top', !isLast && 'border-b border-chip')
  return (
    <tr
      aria-selected={isSelected}
      onClick={() => onSelectRun(run.id)}
      className={joinClassNames('cursor-pointer', isSelected ? 'bg-canvas' : 'hover:bg-subtle')}
    >
      <td className={joinClassNames(cellClassNames, isSelected ? 'font-semibold shadow-[inset_3px_0_0_var(--color-ink)]' : 'font-medium')}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSelectRun(run.id)
          }}
          aria-label={messages().runs.showRun(run.agentName, run.when)}
          title={run.agentName}
          className="block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-[inherit] text-ink"
        >
          {run.agentName}
        </button>
        {run.place && (
          <Badge tone={run.place === 'online' ? 'brand' : 'neutral'} className="mt-1">
            {run.place === 'online' ? messages().runs.online : messages().runs.onThisComputer}
          </Badge>
        )}
      </td>
      <td className={joinClassNames(cellClassNames, 'truncate text-body')} title={run.startedBy}>
        {run.startedBy}
      </td>
      <td className={joinClassNames(cellClassNames, 'whitespace-nowrap text-body')}>{run.when}</td>
      <td className={joinClassNames(cellClassNames, run.status === 'failed' ? 'text-danger' : 'text-body')} title={run.resultTitle ?? run.result}>
        <span className="line-clamp-2 break-words">{toPreviewText(run.result)}</span>
      </td>
      <td className={joinClassNames(cellClassNames, 'whitespace-nowrap')}>
        <RunStatusPill status={run.status} />
      </td>
    </tr>
  )
}

/**
 * Table of runs, newest first. Clicking a row opens it in the detail panel. The result is a
 * plain preview clamped to two lines (a failed run's error in plain words), with the full or
 * raw text on hover.
 */
export function RunsTable({ runs, selectedRunId, onSelectRun, emptyMessage }: RunsTableProps) {
  const t = useT().runs
  return (
    <div className="max-w-[1100px] overflow-x-auto rounded-[14px] border border-line">
      <table className="w-full min-w-[620px] table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={joinClassNames(headerCellClassNames, column.widthClassName)}>
                {t.columns[column.key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => (
            <RunRow key={run.id} run={run} isSelected={run.id === selectedRunId} isLast={index === runs.length - 1} onSelectRun={onSelectRun} />
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3.5 py-6 text-center text-muted">
                {emptyMessage ?? t.noMatch}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
