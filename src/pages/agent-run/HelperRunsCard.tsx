import { useId } from 'react'
import { joinClassNames } from '@/components/ui'
import { useT } from '@/i18n'
import type { HelperRun, HelperRunStatus } from './runAbilityEvents'

const statusClassNames: Record<HelperRunStatus, string> = {
  running: 'bg-chip text-ink-2',
  finished: 'bg-ok-tint text-ok-deep',
  failed: 'bg-danger-tint text-danger-deep',
  paused: 'bg-amber-tint text-amber-deep',
}

interface HelperRunsCardProps {
  helpers: HelperRun[]
  /** Agent id → name; an unknown id may come back as the id itself. */
  nameOf: (agentId: string) => string
  className?: string
}

function HelperRunItem({ helper, nameOf }: { helper: HelperRun; nameOf: HelperRunsCardProps['nameOf'] }) {
  const t = useT().abilities.helperTree
  const knownName = nameOf(helper.agentId)
  const name = knownName && knownName !== helper.agentId ? knownName : t.unknownAgent
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span title={t.asked(name)} className="min-w-0 flex-auto truncate text-[13px] font-medium text-ink">
          {t.asked(name)}
        </span>
        {helper.stepCount > 0 && <span className="shrink-0 text-[12px] text-muted">{t.steps(helper.stepCount)}</span>}
        <span className={joinClassNames('shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', statusClassNames[helper.status])}>{t.status[helper.status]}</span>
      </div>
      {helper.children.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 border-l-2 border-line py-0.5 pl-3">
          {helper.children.map((child) => (
            <HelperRunItem key={child.frame} helper={child} nameOf={nameOf} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * "Help from other agents": each helper agent the run asked, what came of it, and the
 * helpers it asked in turn (indented). Nothing when the run asked none.
 */
export function HelperRunsCard({ helpers, nameOf, className }: HelperRunsCardProps) {
  const t = useT().abilities.helperTree
  const headingId = useId()
  if (helpers.length === 0) return null
  return (
    <section aria-labelledby={headingId} className={joinClassNames('flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3.5', className)}>
      <h3 id={headingId} className="m-0 text-[12px] font-medium text-muted">
        {t.title}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {helpers.map((helper) => (
          <HelperRunItem key={helper.frame} helper={helper} nameOf={nameOf} />
        ))}
      </ul>
    </section>
  )
}
