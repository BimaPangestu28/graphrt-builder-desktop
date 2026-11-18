import { Link } from 'react-router-dom'
import { routePaths } from '@/routes'

/** "This month" totals: runs, AI cost and time saved, plus the self-hosting link. */
export function MonthlyUsageCard({ usageRows }: { usageRows: Array<{ label: string; value: string }> }) {
  return (
    <section aria-labelledby="home-this-month" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
      <h2 id="home-this-month" className="m-0 text-[16px] font-semibold">
        This month
      </h2>
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-[18px]">
        <dl className="m-0 flex flex-col gap-3.5">
          {usageRows.map((usageRow) => (
            <div key={usageRow.label} className="flex justify-between">
              <dt className="text-body">{usageRow.label}</dt>
              <dd className="m-0 font-semibold">{usageRow.value}</dd>
            </div>
          ))}
        </dl>
        <div aria-hidden="true" className="h-px bg-chip" />
        <span className="text-[13px] leading-normal text-body">Free and open source · no limits</span>
        <Link to={routePaths.settings} className="font-medium">
          Run agents on your own server too
        </Link>
      </div>
    </section>
  )
}
