import { useEffect, useState } from 'react'
import { addAgentTests, suggestAgentTests } from '@/api/quality'
import type { SuggestedTest } from '@/api/qualityTypes'
import { Button, Card, Spinner } from '@/components/ui'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'

interface SuggestPanelProps {
  agentId: string
  onAdded: () => void
  onClose: () => void
}

/**
 * "Suggest questions": the person's model writes draft tests, the person unticks the ones
 * they do not want and adds the rest in one click.
 */
export function SuggestPanel({ agentId, onAdded, onClose }: SuggestPanelProps) {
  const t = useT().quality
  const [suggested, setSuggested] = useState<SuggestedTest[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  useEffect(() => {
    let isActive = true
    suggestAgentTests(agentId).then(
      (tests) => {
        if (!isActive) return
        setSuggested(tests)
        setPicked(new Set(tests.map((_, index) => index)))
      },
      (suggestError: unknown) => {
        if (isActive) setError(t.test.couldNotSuggest(describeError(suggestError)))
      },
    )
    return () => {
      isActive = false
    }
  }, [agentId, t])

  function toggle(index: number) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function add() {
    if (!suggested) return
    setIsAdding(true)
    setError(null)
    try {
      const chosen = suggested.filter((_, index) => picked.has(index))
      await addAgentTests(
        agentId,
        chosen.map((test) => ({ question: test.question, goodAnswer: test.goodAnswer, mustInclude: [], mustNotInclude: [], suggested: true })),
      )
      onAdded()
    } catch (addError) {
      setError(t.couldNot(describeError(addError)))
      setIsAdding(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[15px] font-semibold text-ink">{t.test.suggestedHeading}</span>
      {!suggested && !error && (
        <span className="flex items-center gap-2.5 text-[14px] text-body">
          <Spinner />
          {t.test.suggesting}
        </span>
      )}
      {suggested && (
        <>
          <span className="text-[13px] text-muted">{t.test.suggestedHint}</span>
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
            {suggested.map((test, index) => (
              <li key={test.question} className="min-w-0">
                <label className="flex h-full cursor-pointer items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5">
                  <input type="checkbox" checked={picked.has(index)} onChange={() => toggle(index)} className="mt-1 size-4 shrink-0 accent-ink" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-ink">{test.question}</span>
                    <span className="text-[13px] leading-normal text-body">{test.goodAnswer || t.test.anyAnswer}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isAdding}>
          {t.cancel}
        </Button>
        {suggested && (
          <Button onClick={() => void add()} disabled={isAdding || picked.size === 0}>
            {t.test.addSelected(picked.size)}
          </Button>
        )}
      </div>
    </Card>
  )
}
