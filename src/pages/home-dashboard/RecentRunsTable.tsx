import type { RecentRun, RecentRunStatus } from '@/data/homeDashboard'
import { StatusPill, type StatusPillTone } from '@/pages/agent-run/StatusPill'

const runStatusTones: Record<RecentRunStatus, StatusPillTone> = {
  'Needs you': 'amber',
  Done: 'ok',
  Failed: 'danger',
}

const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'
const columnLabels = ['Agent', 'Started', 'Result', 'Status']

/** The last few runs across all agents. */
export function RecentRunsTable({ runs }: { runs: RecentRun[] }) {
  return (
    <section aria-labelledby="home-recent-runs" className="flex min-w-0 flex-[2_1_420px] flex-col gap-3">
      <h2 id="home-recent-runs" className="m-0 text-[16px] font-semibold">
        Recent runs
      </h2>
      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              {columnLabels.map((columnLabel) => (
                <th key={columnLabel} scope="col" className={headerCellClassNames}>
                  {columnLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-chip last:border-b-0">
                <td className="px-4 py-3 font-medium">{run.agentName}</td>
                <td className="px-4 py-3 text-body">{run.startedAt}</td>
                <td className="px-4 py-3 text-body">{run.resultSummary}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={runStatusTones[run.status]}>{run.status}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
