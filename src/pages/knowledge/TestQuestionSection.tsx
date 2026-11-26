import { useState } from 'react'
import { useKnowledgeSearch } from '@/hooks/useKnowledge'
import { SectionHeading } from './FormControls'
import { PassageMatch, SearchFieldIcon } from './PassageMatch'
import { useT } from '@/i18n'

/**
 * Converts the "Ignore matches below" field into a number, treating invalid input as no threshold.
 *
 * @param thresholdText - e.g. "0.55"
 * @returns The threshold between 0 and 1
 */
export function parseMatchThreshold(thresholdText: string): number {
  const threshold = Number.parseFloat(thresholdText)
  return Number.isFinite(threshold) ? Math.min(Math.max(threshold, 0), 1) : 0
}

interface TestQuestionSectionProps {
  knowledgeBaseId: string
  /** Matches scoring below this are shown as weak (agents never see them). */
  matchThreshold: number
  /** Question shown when the screen opens. */
  initialQuestion?: string
}

/**
 * "Test a question" on screen 18: type what a customer would ask and see the passage
 * an agent would get from this knowledge base, searched by the backend.
 */
export function TestQuestionSection({ knowledgeBaseId, matchThreshold, initialQuestion = '' }: TestQuestionSectionProps) {
  const t = useT().knowledge
  const [testQuestion, setTestQuestion] = useState(initialQuestion)
  const { passages, isSearching, error } = useKnowledgeSearch(testQuestion, [knowledgeBaseId], 1)
  const bestPassage = passages[0]
  const hasQuestion = testQuestion.trim() !== ''

  return (
    <section aria-labelledby="try-h" className="flex flex-col gap-3">
      <SectionHeading id="try-h">{t.testQuestion}</SectionHeading>
      <label className="box-border flex h-11 items-center gap-2.5 rounded-[10px] border border-line-strong px-3.5 focus-within:border-brand">
        <SearchFieldIcon />
        <input
          type="search"
          aria-label={t.testQuestion}
          value={testQuestion}
          placeholder={t.testQuestionPlaceholder}
          onChange={(event) => setTestQuestion(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div aria-live="polite" className="flex flex-col gap-3">
        {error && <p className="m-0 text-[13px] text-danger">{t.couldNotSearch(error.message)}</p>}
        {!error && bestPassage && <PassageMatch passage={bestPassage} isWeak={bestPassage.score < matchThreshold} />}
        {!error && hasQuestion && !isSearching && !bestPassage && (
          <p className="m-0 rounded-[10px] border border-amber-line bg-amber-tint px-3.5 py-3 text-amber-deep">{t.nothingAnswers}</p>
        )}
      </div>
    </section>
  )
}
