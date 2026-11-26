import { Icon } from '@/components/ui'
import { useT } from '@/i18n'

/**
 * Stands in for Agents, Recent runs, Needs you and This month on a fresh install, so the page
 * shows one friendly line instead of four empty headings.
 */
export function HomeEmptyOverview() {
  const t = useT().home
  return (
    <section aria-label={t.dashboardLabel} className="flex items-center gap-3.5 rounded-[14px] border border-line bg-subtle px-5 py-4">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
        <Icon name="activity" size={18} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">{t.dashboardEmptyTitle}</span>
        <span className="text-[13px] leading-normal text-body">{t.dashboardEmptyText}</span>
      </span>
    </section>
  )
}
