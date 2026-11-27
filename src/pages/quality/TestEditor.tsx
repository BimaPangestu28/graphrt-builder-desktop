import { useState } from 'react'
import type { TestInput } from '@/api/qualityTypes'
import { Button, Card } from '@/components/ui'
import { useT } from '@/i18n'
import { textToWords, wordsToText } from './qualityDisplay'

const fieldClassNames =
  'box-border w-full min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink'

interface TestEditorProps {
  initial: TestInput
  submitLabel: string
  isSaving: boolean
  error: string | null
  onSubmit: (test: TestInput) => void
  onCancel: () => void
}

/**
 * The question and what a good answer says, with the word lists folded under "More options".
 */
export function TestEditor({ initial, submitLabel, isSaving, error, onSubmit, onCancel }: TestEditorProps) {
  const t = useT().quality
  const [question, setQuestion] = useState(initial.question)
  const [goodAnswer, setGoodAnswer] = useState(initial.goodAnswer)
  const [mustInclude, setMustInclude] = useState(wordsToText(initial.mustInclude))
  const [mustNotInclude, setMustNotInclude] = useState(wordsToText(initial.mustNotInclude))
  const hasWords = initial.mustInclude.length > 0 || initial.mustNotInclude.length > 0

  function submit() {
    onSubmit({ question, goodAnswer, mustInclude: textToWords(mustInclude), mustNotInclude: textToWords(mustNotInclude), suggested: initial.suggested })
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        {t.test.question}
        <input type="text" value={question} maxLength={2000} placeholder={t.test.questionPlaceholder} onChange={(event) => setQuestion(event.target.value)} className={`${fieldClassNames} h-10`} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        {t.test.goodAnswer}
        <textarea value={goodAnswer} rows={2} maxLength={4000} placeholder={t.test.goodAnswerPlaceholder} onChange={(event) => setGoodAnswer(event.target.value)} className={`${fieldClassNames} resize-y`} />
        <span className="text-[12px] font-normal text-muted">{t.test.goodAnswerHint}</span>
      </label>
      <details open={hasWords} className="text-[13px]">
        <summary className="cursor-pointer font-medium text-ink-2">{t.test.moreOptions}</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold text-ink">
            {t.test.mustInclude}
            <input type="text" value={mustInclude} placeholder={t.test.wordsHint} onChange={(event) => setMustInclude(event.target.value)} className={`${fieldClassNames} h-10`} />
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            {t.test.mustNotInclude}
            <input type="text" value={mustNotInclude} placeholder={t.test.wordsHint} onChange={(event) => setMustNotInclude(event.target.value)} className={`${fieldClassNames} h-10`} />
          </label>
        </div>
      </details>
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
          {t.cancel}
        </Button>
        <Button onClick={submit} disabled={isSaving || !question.trim()}>
          {submitLabel}
        </Button>
      </div>
    </Card>
  )
}
