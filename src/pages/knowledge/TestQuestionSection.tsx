import { useState } from 'react'
import { searchKnowledgePassages } from '@/data/knowledge'
import { SectionHeading, compactButtonClassNames } from './FormControls'
import { PassageMatch, SearchFieldIcon } from './PassageMatch'

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

function WriteAnswerForm({ onCancel }: { onCancel: () => void }) {
  const [answerText, setAnswerText] = useState('')
  const [isSaved, setIsSaved] = useState(false)

  if (isSaved) {
    return <p className="m-0 text-[13px] text-ok-strong">Saved to Delivery and FAQ. The chatbot will use it from now on</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="written-answer" className="text-[12px] font-medium text-ink-2">
        Your answer
      </label>
      <textarea
        id="written-answer"
        rows={3}
        value={answerText}
        onChange={(event) => setAnswerText(event.target.value)}
        className="resize-y rounded-[10px] border border-line-strong px-3 py-2.5 text-[14px] leading-[1.55] text-ink outline-none focus:border-brand"
      />
      <div className="flex gap-2">
        <button type="button" disabled={answerText.trim() === ''} onClick={() => setIsSaved(true)} className={compactButtonClassNames('primary')}>
          Save answer
        </button>
        <button type="button" onClick={onCancel} className={compactButtonClassNames('secondary')}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * "Test a question" on screen 18: type what a customer would ask and see the best passage.
 * Matches scoring below `matchThreshold` are shown as weak, with a way to write a missing answer.
 */
export function TestQuestionSection({ matchThreshold }: { matchThreshold: number }) {
  const [testQuestion, setTestQuestion] = useState('ada menu vegetarian?')
  const [isWritingAnswer, setIsWritingAnswer] = useState(false)
  const bestPassage = searchKnowledgePassages(testQuestion)[0]
  const hasQuestion = testQuestion.trim() !== ''
  const needsAnswer = hasQuestion && (!bestPassage || bestPassage.score < matchThreshold)

  return (
    <section aria-labelledby="try-h" className="flex flex-col gap-3">
      <SectionHeading id="try-h">Test a question</SectionHeading>
      <label className="box-border flex h-11 items-center gap-2.5 rounded-[10px] border border-line-strong px-3.5 focus-within:border-brand">
        <SearchFieldIcon />
        <input
          type="search"
          aria-label="Test a question"
          lang="id"
          value={testQuestion}
          onChange={(event) => {
            setTestQuestion(event.target.value)
            setIsWritingAnswer(false)
          }}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div aria-live="polite" className="flex flex-col gap-3">
        {bestPassage && <PassageMatch passage={bestPassage} isWeak={bestPassage.score < matchThreshold} />}
        {hasQuestion && !bestPassage && (
          <p className="m-0 rounded-[10px] border border-amber-line bg-amber-tint px-3.5 py-3 text-amber-deep">Nothing in this knowledge base answers that yet</p>
        )}
      </div>
      {needsAnswer &&
        (isWritingAnswer ? (
          <WriteAnswerForm onCancel={() => setIsWritingAnswer(false)} />
        ) : (
          <button type="button" onClick={() => setIsWritingAnswer(true)} className={compactButtonClassNames('secondary', 'self-start')}>
            Write an answer for this
          </button>
        ))}
    </section>
  )
}
