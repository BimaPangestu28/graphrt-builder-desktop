import { joinClassNames } from '@/components/ui'
import type { RunRecord } from '@/data/runs'
import { RunStatusPill } from './RunStatusPill'

interface RunsTableProps {
  runs: RunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  /** Shown in place of rows when there are none. */
  emptyMessage?: string
}

const headerCellClassNames = 'border-b border-line px-3.5 py-3 font-medium'

function RunRow({ run, isSelected, isLast, onSelectRun }: { run: RunRecord; isSelected: boolean; isLast: boolean; onSelectRun: (runId: string) => void }) {
  const cellClassNames = joinClassNames('px-3.5 py-3', !isLast && 'border-b border-chip')
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
          aria-label={`Show run: ${run.agentName}, ${run.when}`}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-[inherit] text-ink"
        >
          {run.agentName}
        </button>
      </td>
      <td className={joinClassNames(cellClassNames, 'text-body')}>{run.startedBy}</td>
      <td className={joinClassNames(cellClassNames, 'text-body')}>{run.when}</td>
      <td className={joinClassNames(cellClassNames, 'text-body')}>{run.result}</td>
      <td className={cellClassNames}>
        <RunStatusPill status={run.status} />
      </td>
    </tr>
  )
}

/** Table of runs, newest first. Clicking a row opens it in the detail panel. */
export function RunsTable({ runs, selectedRunId, onSelectRun, emptyMessage = 'No runs match these filters' }: RunsTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className={headerCellClassNames}>Agent</th>
            <th className={headerCellClassNames}>Started by</th>
            <th className={headerCellClassNames}>When</th>
            <th className={headerCellClassNames}>Result</th>
            <th className={headerCellClassNames}>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => (
            <RunRow key={run.id} run={run} isSelected={run.id === selectedRunId} isLast={index === runs.length - 1} onSelectRun={onSelectRun} />
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3.5 py-6 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
