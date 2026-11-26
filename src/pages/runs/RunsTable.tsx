import { Badge, Icon, joinClassNames } from '@/components/ui'
import type { RunRecord } from '@/pages/runs/runRecordTypes'
import { formatRelativeTime } from '@/pages/home-dashboard/homeLinks'
import { toPreviewText } from '@/lib/previewText'
import { RunStatusPill } from './RunStatusPill'
import { messages, useT } from '@/i18n'

interface RunsTableProps {
  runs: RunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  /** Reference time for "5 min ago" (Date). */
  now?: Date
}

/**
 * Fixed widths (table-fixed) keep a long result from squeezing the agent name onto several
 * lines; the Result column takes what is left of the full page width.
 */
const columns = [
  { key: 'agent', widthClassName: 'w-[26%]' },
  { key: 'status', widthClassName: 'w-[124px]' },
  { key: 'result', widthClassName: '' },
  { key: 'startedBy', widthClassName: 'w-[112px]' },
  { key: 'when', widthClassName: 'w-[150px]' },
] as const

/** The first letter of the agent's name, as a quiet square avatar. */
function AgentInitial({ name, isOnline }: { name: string; isOnline: boolean }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden="true"
      className={joinClassNames(
        'flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
        isOnline ? 'bg-brand-soft text-brand-strong' : 'bg-chip text-ink-2',
      )}
    >
      {initial}
    </span>
  )
}

/** "took 2m 05s", or what an unfinished run is doing. */
function describeRunLength(run: RunRecord): string | null {
  const t = messages().runs
  if (run.status === 'running') return t.stillRunning
  if (run.status === 'needsYou') return t.waiting
  return run.duration ?? null
}

function RunRow({ run, isSelected, now, onSelectRun }: { run: RunRecord; isSelected: boolean; now: Date; onSelectRun: (runId: string) => void }) {
  const t = messages().runs
  const isOnline = run.place === 'online'
  const cellClassNames = 'px-4 py-3 align-middle'
  const relativeWhen = run.startedAt ? formatRelativeTime(run.startedAt, now) : run.when
  const runLength = describeRunLength(run)
  return (
    <tr
      aria-selected={isSelected}
      onClick={() => onSelectRun(run.id)}
      className={joinClassNames('group cursor-pointer border-b border-chip transition-colors last:border-b-0', isSelected ? 'bg-canvas' : 'hover:bg-subtle')}
    >
      <td className={joinClassNames(cellClassNames, isSelected && 'shadow-[inset_3px_0_0_var(--color-ink)]')}>
        <div className="flex min-w-0 items-center gap-3">
          <AgentInitial name={run.agentName} isOnline={isOnline} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSelectRun(run.id)
              }}
              aria-label={t.showRun(run.agentName, run.when)}
              title={run.agentName}
              className={joinClassNames(
                'block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-[inherit] text-ink',
                isSelected ? 'font-semibold' : 'font-medium',
              )}
            >
              {run.agentName}
            </button>
            {run.place &&
              (isOnline ? (
                <Badge tone="brand" className="self-start !px-2 !text-[11px]">
                  {t.online}
                </Badge>
              ) : (
                <span className="flex items-center gap-1 text-[12px] text-muted">
                  <Icon name="monitor" size={12} />
                  {t.onThisComputer}
                </span>
              ))}
          </div>
        </div>
      </td>
      <td className={cellClassNames}>
        <RunStatusPill status={run.status} />
      </td>
      <td className={joinClassNames(cellClassNames, run.status === 'failed' ? 'text-danger' : 'text-body')} title={run.resultTitle ?? run.result}>
        <span className="line-clamp-2 break-words">{toPreviewText(run.result)}</span>
      </td>
      <td className={joinClassNames(cellClassNames, 'truncate text-body')} title={run.startedBy}>
        {run.startedBy}
      </td>
      <td className={cellClassNames} title={run.timing || run.when}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="whitespace-nowrap text-ink-2">{relativeWhen}</span>
            {runLength && <span className="truncate text-[12px] text-muted">{runLength}</span>}
          </div>
          <span aria-hidden="true" className={joinClassNames('shrink-0 text-faint transition-colors group-hover:text-ink-2', isSelected && '!text-ink-2')}>
            <Icon name="chevronRight" size={16} />
          </span>
        </div>
      </td>
    </tr>
  )
}

/**
 * Table of runs, newest first, using the full page width. Each row shows the agent (with where it
 * ran), a coloured status, what came of it in plain words (clamped to two lines, the full or raw
 * text on hover), who started it and when, with how long it took. Clicking a row opens it in the
 * detail panel. Empty lists are handled by the page (see `RunsEmptyState`).
 */
export function RunsTable({ runs, selectedRunId, onSelectRun, now = new Date() }: RunsTableProps) {
  const t = useT().runs
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="bg-subtle text-left text-[12px] text-muted">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={joinClassNames('whitespace-nowrap border-b border-line px-4 py-2.5 font-medium', column.widthClassName)}>
                {t.columns[column.key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} isSelected={run.id === selectedRunId} now={now} onSelectRun={onSelectRun} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
