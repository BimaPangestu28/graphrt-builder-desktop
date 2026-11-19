import { HomeSectionHeader } from './HomeSectionHeader'
import type { MonthlyNumbers } from './monthlyUsage'

interface MonthlyUsageCardProps {
  /** From `buildMonthlyNumbers`; null while loading. */
  monthlyNumbers: MonthlyNumbers | null
  loadError: Error | null
}

function MonthlyUsageBody({ monthlyNumbers, loadError }: MonthlyUsageCardProps) {
  if (loadError && !monthlyNumbers) return <p className="m-0 text-muted">Could not load this month's runs: {loadError.message}</p>
  if (!monthlyNumbers) return <p className="m-0 text-muted">Loading this month…</p>
  if (monthlyNumbers.isEmpty) return <p className="m-0 leading-normal text-muted">Nothing ran this month yet. Numbers show up after your first run</p>
  return (
    <dl className="m-0 flex flex-col gap-3.5">
      {monthlyNumbers.rows.map((usageRow) => (
        <div key={usageRow.label} className="flex justify-between gap-3">
          <dt className="text-body">{usageRow.label}</dt>
          <dd className="m-0 font-semibold tabular-nums">{usageRow.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "This month": runs that succeeded and failed, what the agents did, and AI tokens. */
export function MonthlyUsageCard({ monthlyNumbers, loadError }: MonthlyUsageCardProps) {
  return (
    <section aria-labelledby="home-this-month" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
      <HomeSectionHeader headingId="home-this-month" heading="This month" />
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-[18px]">
        <MonthlyUsageBody monthlyNumbers={monthlyNumbers} loadError={loadError} />
      </div>
    </section>
  )
}
