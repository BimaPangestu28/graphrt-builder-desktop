import { useState } from 'react'
import { Link } from 'react-router-dom'
import { recordRunFeedback } from '@/api/learning'
import type { FeedbackOutcome } from '@/api/learningTypes'
import { Button, Icon } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { agentPath } from '@/routes'

interface RunFeedbackCardProps {
  agentId: string
  /** A finished run. */
  runId: string
}

const maxCommentChars = 500

/**
 * "Was this what you wanted?" under a finished run. Yes is recorded at once. No opens one
 * question (what should be different next time) whose answer becomes a note that waits for
 * the owner's approval on "What this agent learned"; it is never used by itself.
 */
export function RunFeedbackCard({ agentId, runId }: RunFeedbackCardProps) {
  const t = useT().learning.feedback
  const [isAskingWhy, setIsAskingWhy] = useState(false)
  const [comment, setComment] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(null)

  async function send(helpful: boolean) {
    setIsSending(true)
    setError(null)
    try {
      setOutcome(await recordRunFeedback(runId, { helpful, comment: helpful ? null : comment.trim() || null }))
    } catch (sendError) {
      setError(t.couldNotSend(describeError(sendError)))
    } finally {
      setIsSending(false)
    }
  }

  if (outcome) {
    return (
      <div role="status" className="box-content flex max-w-[92%] flex-col gap-1.5 rounded-[14px] border border-line p-4">
        <span className="font-semibold">{t.thanks}</span>
        {outcome.proposed.length > 0 && (
          <>
            <span className="text-[13px] text-body">{t.proposed}</span>
            <Link to={agentPath('learned', agentId)} className="self-start text-[13px] font-medium">
              {t.openLearned}
            </Link>
          </>
        )}
        {outcome.notRecorded && <span className="text-[13px] text-amber-strong">{t.notRecorded(outcome.notRecorded)}</span>}
      </div>
    )
  }

  return (
    <div role="group" aria-label={t.heading} className="box-content flex max-w-[92%] flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="font-semibold">{t.heading}</span>
      {!isAskingWhy ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={isSending} onClick={() => void send(true)}>
            <Icon name="thumbUp" size={14} />
            {t.yes}
          </Button>
          <Button variant="secondary" size="sm" disabled={isSending} onClick={() => setIsAskingWhy(true)}>
            <Icon name="thumbDown" size={14} />
            {t.no}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            {t.commentLabel}
            <textarea
              value={comment}
              maxLength={maxCommentChars}
              rows={2}
              placeholder={t.commentPlaceholder}
              disabled={isSending}
              onChange={(event) => setComment(event.target.value)}
              className="box-border w-full resize-y rounded-[9px] border border-line-strong bg-surface px-3 py-2 text-[14px] leading-normal font-normal text-ink outline-none focus:border-ink"
            />
          </label>
          <span className="text-[12px] leading-normal text-muted">{t.commentHint}</span>
          <Button size="sm" className="self-start" disabled={isSending} onClick={() => void send(false)}>
            {isSending ? t.sending : t.send}
          </Button>
        </div>
      )}
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </div>
  )
}
