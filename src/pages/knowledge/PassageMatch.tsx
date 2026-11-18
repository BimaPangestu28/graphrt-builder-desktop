import { joinClassNames } from '@/components/ui'
import type { KnowledgePassage } from '@/data/knowledge'

interface PassageMatchProps {
  passage: KnowledgePassage
  /** Weak matches (below the "Ignore matches below" setting) are shown amber with a hint. */
  isWeak?: boolean
}

/**
 * One search hit: similarity score on the left, passage text and its source underneath.
 * Used by the knowledge search (17) and "Test a question" (18).
 */
export function PassageMatch({ passage, isWeak = false }: PassageMatchProps) {
  const scoreLabel = passage.score.toFixed(2)
  if (isWeak) {
    return (
      <div className="flex gap-3 rounded-[10px] border border-amber-line bg-amber-tint px-3.5 py-3">
        <span className="shrink-0 text-[12px] font-semibold text-amber-strong">{scoreLabel}</span>
        <span className="flex flex-col gap-1">
          <span className="leading-normal">Best match is weak. {passage.text}</span>
          <span className="text-[12px] text-amber-deep">
            {passage.weakMatchHint ?? 'This may not answer the question. Add an answer so the chatbot stops passing it to you'}
          </span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3">
      <span className={joinClassNames('shrink-0 text-[12px] font-semibold', passage.score >= 0.85 ? 'text-brand-strong' : 'text-ink-2')}>{scoreLabel}</span>
      <span className="flex flex-col gap-1">
        <span className="leading-normal">{passage.text}</span>
        <span className="text-[12px] text-muted">{passage.citation}</span>
      </span>
    </div>
  )
}

/** Magnifier drawn at the left of the knowledge search fields. */
export function SearchFieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </svg>
  )
}
