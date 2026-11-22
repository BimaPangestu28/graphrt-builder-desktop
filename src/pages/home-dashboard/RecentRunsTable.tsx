import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { RecentRun, RecentRunStatus } from '@/pages/home-dashboard/homeDashboardTypes'
import { StatusPill, type StatusPillTone } from '@/pages/agent-run/StatusPill'
import { routePaths } from '@/routes'
import { HomeSectionHeader } from './HomeSectionHeader'
import { toPreviewText } from '@/lib/previewText'

const runStatusTones: Record<RecentRunStatus, StatusPillTone> = {
  'Needs you': 'amber',
  Done: 'ok',
  Failed: 'danger',
  Running: 'neutral',
  Stopped: 'neutral',
}

const cellClassNames = 'px-4 py-3 align-top'
/** Fixed widths keep a long result from squeezing the agent name onto several lines. */
const columns = [
  { label: 'Agent', widthClassName: 'w-[30%]' },
  { label: 'Started', widthClassName: 'w-[112px]' },
  { label: 'Result', widthClassName: '' },
  { label: 'Status', widthClassName: 'w-[116px]' },
]

interface RecentRunsTableProps {
  /** Null while loading. */
  runs: RecentRun[] | null
  loadError: Error | null
}

function RecentRunRow({ run }: { run: RecentRun }) {
  const navigate = useNavigate()
  // The whole row opens the run; links inside it (agent, result) keep their own target.
  function handleRowClick(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a')) return
    navigate(run.runPath)
  }
  return (
    <tr onClick={handleRowClick} className="cursor-pointer border-b border-chip last:border-b-0 hover:bg-subtle">
      <td className={joinClassNames(cellClassNames, 'font-medium')}>
        <Link to={run.agentPath} title={run.agentName} className="block truncate !text-ink no-underline hover:underline">
          {run.agentName}
        </Link>
      </td>
      <td className={joinClassNames(cellClassNames, 'whitespace-nowrap text-body')} title={run.startedAtTitle}>
        {run.startedAt}
      </td>
      <td className={cellClassNames}>
        <Link
          to={run.runPath}
          title={run.resultSummary}
          className={joinClassNames('line-clamp-2 break-words no-underline hover:underline', run.status === 'Failed' ? '!text-danger' : '!text-body')}
        >
          {toPreviewText(run.resultSummary)}
        </Link>
      </td>
      <td className={joinClassNames(cellClassNames, 'whitespace-nowrap')}>
        <StatusPill tone={runStatusTones[run.status]}>{run.status}</StatusPill>
      </td>
    </tr>
  )
}

function RecentRunsBody({ runs, loadError }: RecentRunsTableProps) {
  if (loadError) return <p className="m-0 text-muted">Could not load recent runs: {loadError.message}</p>
  if (!runs) return <p className="m-0 text-muted">Loading runs…</p>
  if (runs.length === 0) return <p className="m-0 text-muted">No runs yet. Test an agent to see it here</p>
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
      <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            {columns.map((column) => (
              <th key={column.label} scope="col" className={joinClassNames('border-b border-line px-4 py-3 font-medium', column.widthClassName)}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RecentRunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The last few runs across all agents: the agent (linking to it), when it started, what came
 * of it in plain words (summary headline, or the humanized error, clamped to two lines with
 * the full text on hover) and its status. A row opens the run; "See all runs" opens Runs.
 */
export function RecentRunsTable({ runs, loadError }: RecentRunsTableProps) {
  const seeAllLink =
    runs && runs.length > 0 ? (
      <Link to={routePaths.runs} className="text-[13px] font-medium !text-body no-underline hover:underline">
        See all runs
      </Link>
    ) : null
  return (
    <section aria-labelledby="home-recent-runs" className="flex min-w-0 flex-col gap-3">
      <HomeSectionHeader headingId="home-recent-runs" heading="Recent runs" trailing={seeAllLink} />
      <RecentRunsBody runs={runs} loadError={loadError} />
    </section>
  )
}
