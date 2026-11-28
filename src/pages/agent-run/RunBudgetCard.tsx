import type { RunBudget } from '@/api/runSummaryTypes'
import { joinClassNames } from '@/components/ui'
import { useT } from '@/i18n'
import { formatTokens, formatUsd } from '@/pages/agent-builder/abilities/abilitiesDisplay'

/** The lines of the spending card: tokens, money, and whether the limit stopped the run. */
export function describeRunBudget(budget: RunBudget, t: ReturnType<typeof useT>['abilities']['budget']): string[] {
  const { limit } = budget
  const tokens = limit.maxTotalTokens === null ? t.tokens(formatTokens(budget.tokensUsed)) : t.tokensOfLimit(formatTokens(budget.tokensUsed), formatTokens(limit.maxTotalTokens))
  const money =
    budget.estimatedCostMicros === null
      ? t.moneyUnknown
      : limit.maxCostMicros === null
        ? t.money(formatUsd(budget.estimatedCostMicros))
        : t.moneyOfLimit(formatUsd(budget.estimatedCostMicros), formatUsd(limit.maxCostMicros))
  const hasLimit = limit.maxCostMicros !== null || limit.maxTotalTokens !== null
  return [tokens, money, hasLimit ? null : t.noLimit].filter((line): line is string => line !== null)
}

/**
 * "Spending" on the Run result: what the run used (helpers included) against the agent's
 * spending limit, and a warning when the limit stopped it. Nothing for a run that used no
 * model and has no limit.
 */
export function RunBudgetCard({ budget, isUnavailable = false }: { budget: RunBudget | null; isUnavailable?: boolean }) {
  const t = useT().abilities.budget
  if (isUnavailable) return <p className="m-0 text-[13px] text-muted">{t.unavailable}</p>
  if (!budget) return null
  const hasLimit = budget.limit.maxCostMicros !== null || budget.limit.maxTotalTokens !== null
  if (budget.tokensUsed === 0 && !hasLimit) return null
  return (
    <section aria-label={t.title} className={joinClassNames('flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-surface px-3.5 py-3', budget.limitReached ? 'border-amber-line-2' : 'border-line')}>
      <span className="text-[12px] font-medium text-muted">{t.title}</span>
      {describeRunBudget(budget, t).map((line) => (
        <span key={line} className="min-w-0 truncate text-[14px] text-ink" title={line}>
          {line}
        </span>
      ))}
      {budget.limitReached && (
        <span role="status" className="basis-full text-[13px] font-semibold text-amber-deep">
          {t.limitReached}
        </span>
      )}
    </section>
  )
}
