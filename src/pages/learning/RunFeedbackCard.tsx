import { useState } from 'react'
import { Link } from 'react-router-dom'
import { recordRunFeedback } from '@/api/learning'
import type { FeedbackOutcome, RunFeedback } from '@/api/learningTypes'
import { Button, Icon, joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { agentPath } from '@/routes'

interface FeedbackCardProps {
  /** The agent the feedback is about: its "What this agent learned" screen is linked afterwards. */
  agentId: string
  /** Records the rating (`recordRunFeedback` for a run, `recordReplyFeedback` for a chatbot reply). */
  onSend: (feedback: RunFeedback) => Promise<FeedbackOutcome>
  /** Sizing where it is shown; the chat column of a run by default. */
  className?: string
}

const maxCommentChars = 500
const chatColumnClassNames = 'box-content max-w-[92%]'

/**
 * "Was this what you wanted?" under something an agent answered. Yes is recorded at once. No
 * opens one question (what should be different next time) whose answer becomes a note that
 * waits for the owner's approval on "What this agent learned"; it is never used by itself.
 */
export function FeedbackCard({ agentId, onSend, className = chatColumnClassNames }: FeedbackCardProps) {
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
      setOutcome(await onSend({ helpful, comment: helpful ? null : comment.trim() || null }))
    } catch (sendError) {
      setError(t.couldNotSend(describeError(sendError)))
    } finally {
      setIsSending(false)
    }
  }

  if (outcome) {
    return (
      <div role="status" className={joinClassNames('flex flex-col gap-1.5 rounded-[14px] border border-line p-4', className)}>
        <span className="font-semibold">{t.thanks}</span>
        {outcome.proposed.length > 0 && (
          <>
            <span className="text-[13px] text-body">{t.proposed}</span>
            <Link to={agentPath('learned', agentId)} className="self-start text-[13px] font-medium">
              {t.openLearned}
            </Link>
          </>
        )}
        {outcome.keptForLater && <span className="text-[13px] text-body">{t.keptForLater}</span>}
        {outcome.notRecorded && <span className="text-[13px] text-amber-strong">{t.notRecorded(outcome.notRecorded)}</span>}
      </div>
    )
  }

  return (
    <div role="group" aria-label={t.heading} className={joinClassNames('flex flex-col gap-3 rounded-[14px] border border-line p-4', className)}>
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

interface RunFeedbackCardProps {
  agentId: string
  /** A finished run: a test, or one that ran for real. */
  runId: string
  className?: string
}

/** {@link FeedbackCard} for a finished run. */
export function RunFeedbackCard({ agentId, runId, className }: RunFeedbackCardProps) {
  return <FeedbackCard agentId={agentId} className={className} onSend={(feedback) => recordRunFeedback(runId, feedback)} />
}
