import { useState } from 'react'
import { useT } from '@/i18n'

/** Answers longer than this start folded: the feedback card under them stays in view. */
const foldedAnswerChars = 900

/**
 * "What the agent answered": the text a run answered with, as the agent wrote it (line breaks
 * kept, nothing interpreted), right in the run's result so nobody has to open the step by step
 * log to read it. A long answer starts folded, with "Show the whole answer".
 */
export function RunAnswerCard({ answer }: { answer: string }) {
  const t = useT().agentRun
  const isLong = answer.length > foldedAnswerChars
  const [isUnfolded, setIsUnfolded] = useState(false)
  const shown = isLong && !isUnfolded ? `${answer.slice(0, foldedAnswerChars).trimEnd()}…` : answer
  return (
    <section aria-label={t.whatTheAgentAnswered} className="box-content flex max-w-[92%] flex-col gap-2 rounded-[14px] border border-line bg-brand-soft p-4">
      <span className="text-[12px] font-semibold tracking-wide text-brand-strong uppercase">{t.whatTheAgentAnswered}</span>
      <p className="m-0 leading-[1.6] break-words whitespace-pre-line text-ink">{shown}</p>
      {isLong && (
        <button
          type="button"
          aria-expanded={isUnfolded}
          onClick={() => setIsUnfolded((unfolded) => !unfolded)}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] font-medium text-brand-strong underline"
        >
          {isUnfolded ? t.showLessOfTheAnswer : t.showTheWholeAnswer}
        </button>
      )}
    </section>
  )
}
