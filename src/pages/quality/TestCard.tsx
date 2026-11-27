import type { AgentTest, QuestionResult } from '@/api/qualityTypes'
import { Badge, Button, Card, Icon } from '@/components/ui'
import { useT } from '@/i18n'
import { describeNotGood } from './qualityDisplay'

interface TestCardProps {
  test: AgentTest
  /** How the agent did on it in the latest check, when it was in that check. */
  result: QuestionResult | null
  isBusy: boolean
  onChange: () => void
  onRemove: () => void
}

/** One test question: what is asked, what a good answer says, and the latest answer. */
export function TestCard({ test, result, isBusy, onChange, onRemove }: TestCardProps) {
  const t = useT().quality
  const reasons = result ? result.notGoodBecause.map((reason) => describeNotGood(reason, t)) : []
  return (
    <Card className="flex h-full min-w-0 flex-col gap-2.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-[15px] leading-snug font-semibold text-ink">{test.question}</span>
        <div className="flex shrink-0 gap-1.5">
          {test.suggested && <Badge tone="brand">{t.test.suggestedBadge}</Badge>}
          {result && <Badge tone={result.good ? 'ok' : 'danger'}>{result.good ? t.result.good : t.result.notGood}</Badge>}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-muted">{t.test.goodAnswer}</span>
        <span className="text-[14px] leading-normal text-body">{test.goodAnswer || t.test.anyAnswer}</span>
      </div>
      {result && (
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-subtle px-3 py-2.5">
          <span className="text-[12px] font-medium text-muted">{t.result.answered}</span>
          <span className="line-clamp-4 text-[14px] leading-normal text-ink">{result.answer || t.result.noReply}</span>
          {(reasons.length > 0 || result.goodBecause) && (
            <span className="text-[13px] leading-normal text-ink-2">
              <b className="font-semibold">{t.result.why}: </b>
              {reasons.length > 0 ? reasons.join(' ') : result.goodBecause}
            </span>
          )}
          {result.change && (
            <Badge tone={result.change === 'now_not_good' ? 'amber' : 'neutral'} className="self-start">
              {t.result.changes[result.change]}
            </Badge>
          )}
        </div>
      )}
      <div className="mt-auto flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onChange} disabled={isBusy}>
          <Icon name="edit" size={14} />
          {t.test.change}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={isBusy}>
          <Icon name="trash" size={14} />
          {t.test.remove}
        </Button>
      </div>
    </Card>
  )
}
