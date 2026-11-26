import { Button, Icon, LinkButton, joinClassNames, type IconName } from '@/components/ui'
import { routePaths } from '@/routes'
import { useT } from '@/i18n'
import type { RunsEmptyState, RunsTodaySummary } from './runsOverview'

interface SummaryTileProps {
  label: string
  value: number
  /** Tile tint when the value is above zero. */
  tone?: 'neutral' | 'danger' | 'amber'
}

const tileToneClassNames: Record<NonNullable<SummaryTileProps['tone']>, { tile: string; label: string }> = {
  neutral: { tile: 'border-line bg-surface', label: 'text-muted' },
  danger: { tile: 'border-danger-line bg-danger-tint', label: 'text-danger' },
  amber: { tile: 'border-amber-line bg-amber-tint', label: 'text-amber-strong' },
}

/** One number of the "Today" summary, styled like the Inbox stat tiles. */
function SummaryTile({ label, value, tone = 'neutral' }: SummaryTileProps) {
  const toneClassNames = tileToneClassNames[value > 0 ? tone : 'neutral']
  return (
    <div className={joinClassNames('flex flex-col gap-1 rounded-xl border p-3.5', toneClassNames.tile)}>
      <span className={joinClassNames('text-[12px]', toneClassNames.label)}>{label}</span>
      <span className="text-[24px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** Runs today, done and failed today, and what waits for the user, from real runs only. */
export function RunsSummary({ summary }: { summary: RunsTodaySummary }) {
  const t = useT().runs
  return (
    <section aria-label={t.summaryLabel} className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
      <SummaryTile label={t.summary.started} value={summary.started} />
      <SummaryTile label={t.summary.done} value={summary.done} />
      <SummaryTile label={t.summary.failed} value={summary.failed} tone="danger" />
      <SummaryTile label={t.summary.needsYou} value={summary.needsYou} tone="amber" />
    </section>
  )
}

interface RunsEmptyStateViewProps {
  state: RunsEmptyState
  /** Puts agent, status and place back to "All". */
  onClearFilters: () => void
}

interface EmptyStateCopy {
  icon: IconName
  title: string
  text: string
}

/**
 * Shown in place of the table when there are no rows: a short explanation and the one action
 * that helps (build an agent, open the agents, show all runs, or clear the filters).
 */
export function RunsEmptyStateView({ state, onClearFilters }: RunsEmptyStateViewProps) {
  const t = useT().runs
  if (state === 'loading') {
    return (
      <div role="status" className="rounded-[14px] border border-line bg-surface px-6 py-10 text-center text-muted">
        {t.loading}
      </div>
    )
  }
  const copyByState: Record<Exclude<RunsEmptyState, 'loading'>, EmptyStateCopy> = {
    noAgents: { icon: 'activity', title: t.empty.noAgentsTitle, text: t.empty.noAgentsText },
    noRunsYet: { icon: 'activity', title: t.empty.noRunsTitle, text: t.empty.noRunsText },
    noOnlineRuns: { icon: 'link', title: t.empty.noOnlineTitle, text: t.empty.noOnlineText },
    noMatch: { icon: 'search', title: t.empty.noMatchTitle, text: t.empty.noMatchText },
  }
  const copy = copyByState[state]
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-line bg-subtle px-6 py-14 text-center">
      <span aria-hidden="true" className="mb-2 flex size-11 items-center justify-center rounded-full border border-line bg-surface text-muted">
        <Icon name={copy.icon} size={20} />
      </span>
      <p className="m-0 text-[15px] font-semibold text-ink">{copy.title}</p>
      <p className="m-0 max-w-[68ch] text-[13px] leading-normal text-body">{copy.text}</p>
      <div className="mt-3">
        {state === 'noAgents' && (
          <LinkButton to={routePaths.newAgent} size="sm">
            <Icon name="plus" size={14} />
            {t.empty.newAgent}
          </LinkButton>
        )}
        {state === 'noRunsYet' && (
          <LinkButton to={routePaths.home} variant="secondary" size="sm">
            {t.empty.goToAgents}
          </LinkButton>
        )}
        {state === 'noOnlineRuns' && (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            {t.empty.showAllRuns}
          </Button>
        )}
        {state === 'noMatch' && (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            {t.empty.clearFilters}
          </Button>
        )}
      </div>
    </div>
  )
}
