import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { KnowledgeBase, KnowledgeBaseStatus } from '@/data/knowledge'
import { routePaths } from '@/routes'

function KnowledgeBaseStatusPill({ status }: { status: KnowledgeBaseStatus }) {
  const isUpToDate = status.kind === 'up-to-date'
  return (
    <span
      className={joinClassNames(
        'shrink-0 rounded-full px-2 py-[3px] text-[12px] font-medium whitespace-nowrap',
        isUpToDate ? 'bg-ok-soft text-ok-strong' : 'bg-brand-soft text-brand-strong',
      )}
    >
      {status.kind === 'up-to-date' ? 'Up to date' : `Syncing ${status.percent}%`}
    </span>
  )
}

/**
 * Card for one knowledge base on screen 17: name, sync status, fact chips and the agents using it.
 * The whole card links to the knowledge detail (18).
 */
export function KnowledgeBaseCard({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  return (
    <Link
      to={routePaths.knowledgeDetail}
      className={joinClassNames(
        'flex flex-col gap-3.5 rounded-[14px] p-[18px] no-underline !text-ink',
        knowledgeBase.isRecentlyOpened ? 'border-2 border-ink' : 'border border-line hover:border-line-heavy',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-semibold">{knowledgeBase.name}</span>
        <KnowledgeBaseStatusPill status={knowledgeBase.status} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {knowledgeBase.facts.map((fact) => (
          <span key={fact} className="rounded-md bg-canvas px-2 py-[3px] text-[12px] text-ink-2">
            {fact}
          </span>
        ))}
      </div>
      <span className="text-[13px] text-body">
        {knowledgeBase.usedBy.length > 0 ? `Used by ${knowledgeBase.usedBy.join(', ')}` : 'Not used by any agent yet'}
      </span>
    </Link>
  )
}
