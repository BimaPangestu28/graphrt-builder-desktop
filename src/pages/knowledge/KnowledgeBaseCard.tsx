import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { KnowledgeBase } from '@/api/knowledgeTypes'
import { knowledgeDetailPath } from '@/routes'
import { knowledgeBaseFacts, syncPercent } from './knowledgeDisplay'

function KnowledgeBaseStatusPill({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  const { status } = knowledgeBase
  const label =
    status === 'up_to_date' ? 'Up to date' : status === 'syncing' ? `Syncing ${syncPercent(knowledgeBase)}%` : status === 'empty' ? 'Empty' : 'Needs attention'
  const toneClassNames =
    status === 'up_to_date' ? 'bg-ok-soft text-ok-strong' : status === 'needs_attention' ? 'bg-amber-soft text-amber-strong' : status === 'empty' ? 'bg-canvas text-ink-2' : 'bg-brand-soft text-brand-strong'
  return <span className={joinClassNames('shrink-0 rounded-full px-2 py-[3px] text-[12px] font-medium whitespace-nowrap', toneClassNames)}>{label}</span>
}

interface KnowledgeBaseCardProps {
  knowledgeBase: KnowledgeBase
  /** Drawn with a 2px ink border, marking the base changed most recently. */
  isRecentlyOpened?: boolean
}

/**
 * Card for one knowledge base on screen 17: name, sync status, fact chips and the agents using it.
 * The whole card links to the knowledge detail (18).
 */
export function KnowledgeBaseCard({ knowledgeBase, isRecentlyOpened = false }: KnowledgeBaseCardProps) {
  const agentNames = knowledgeBase.usedBy.map((usage) => usage.agentName)
  return (
    <Link
      to={knowledgeDetailPath(knowledgeBase.id)}
      className={joinClassNames(
        'flex flex-col gap-3.5 rounded-[14px] p-[18px] no-underline !text-ink',
        isRecentlyOpened ? 'border-2 border-ink' : 'border border-line hover:border-line-heavy',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-semibold">{knowledgeBase.name}</span>
        <KnowledgeBaseStatusPill knowledgeBase={knowledgeBase} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {knowledgeBaseFacts(knowledgeBase).map((fact) => (
          <span key={fact} className="rounded-md bg-canvas px-2 py-[3px] text-[12px] text-ink-2">
            {fact}
          </span>
        ))}
      </div>
      <span className="text-[13px] text-body">{agentNames.length > 0 ? `Used by ${agentNames.join(', ')}` : 'Not used by any agent yet'}</span>
    </Link>
  )
}
