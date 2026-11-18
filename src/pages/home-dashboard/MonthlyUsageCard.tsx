import { Link } from 'react-router-dom'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { routePaths } from '@/routes'
import { buildMonthlyUsageRows } from './monthlyUsage'

interface MonthlyUsageCardProps {
  /** From `getUsageSummary` since the 1st of the month; null while loading. */
  usageSummary: UsageSummary | null
  loadError: Error | null
}

function MonthlyUsageBody({ usageSummary, loadError }: MonthlyUsageCardProps) {
  if (loadError) return <p className="m-0 text-muted">Could not load this month's runs: {loadError.message}</p>
  if (!usageSummary) return <p className="m-0 text-muted">Loading this month…</p>
  if (usageSummary.runCount === 0) return <p className="m-0 leading-normal text-muted">No runs this month yet</p>
  return (
    <dl className="m-0 flex flex-col gap-3.5">
      {buildMonthlyUsageRows(usageSummary).map((usageRow) => (
        <div key={usageRow.label} className="flex justify-between">
          <dt className="text-body">{usageRow.label}</dt>
          <dd className="m-0 font-semibold">{usageRow.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "This month" totals: runs and AI tokens from the backend, plus the self-hosting link. */
export function MonthlyUsageCard({ usageSummary, loadError }: MonthlyUsageCardProps) {
  return (
    <section aria-labelledby="home-this-month" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
      <h2 id="home-this-month" className="m-0 text-[16px] font-semibold">
        This month
      </h2>
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-[18px]">
        <MonthlyUsageBody usageSummary={usageSummary} loadError={loadError} />
        <div aria-hidden="true" className="h-px bg-chip" />
        <span className="text-[13px] leading-normal text-body">Free and open source · no limits</span>
        <Link to={routePaths.settings} className="font-medium">
          Run agents on your own server too
        </Link>
      </div>
    </section>
  )
}
