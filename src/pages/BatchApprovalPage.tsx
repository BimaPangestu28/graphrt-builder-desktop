import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { answerApprovals, getRunReview } from '@/api/runReview'
import type { ApprovalAnswer, PendingApproval, RunReview } from '@/api/runReviewTypes'
import { AppShell } from '@/components/layout'
import { useLoadedData, useRunEventSubscription } from '@/hooks/useRunData'
import { agentPath, routePaths } from '@/routes'
import { buildApprovalAnswer, collectAnswersByResumeKey, findMissingRequiredFields, initialApprovalValues, type ApprovalValues } from '@/pages/agent-run/approvalForm'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { RunReviewList } from './batch-approval/RunReviewList'
import { buildRowTitle, describeReviewedRun } from './batch-approval/runReviewModel'
import { toError } from '@/lib/errors'
import { messages } from '@/i18n'

/** Run events after which the review is read again. */
const reviewRefreshEventTypes = new Set(['status_changed', 'run_paused', 'run_succeeded', 'run_failed', 'run_aborted'])

/** "Answer all remaining": the action to give every next question, and the values edited on screen. */
interface AutoAnswer {
  actionId: string
  /** Keyed by `PendingApproval.id`. */
  valuesByApprovalId: Record<string, ApprovalValues>
}

/** Loads the review and reloads it whenever the reviewed run changes status. */
function useRunReview(runId: string | null) {
  const loadedReview = useLoadedData(() => getRunReview(runId), [runId])
  const reviewedRunId = loadedReview.data?.runId ?? runId
  useRunEventSubscription((payload) => {
    if (payload.runId === reviewedRunId && reviewRefreshEventTypes.has(payload.event.type)) loadedReview.reload()
  })
  return loadedReview
}

/**
 * Answers for every question with `actionId` and each one's values (edited or default);
 * null when a question lacks the action or misses a required field.
 */
function buildAutoAnswers(pending: PendingApproval[], autoAnswer: AutoAnswer): { answers: Record<string, ApprovalAnswer> } | { blockedTitle: string } {
  const answers: Array<[PendingApproval, ApprovalAnswer]> = []
  for (const approval of pending) {
    const values = autoAnswer.valuesByApprovalId[approval.id] ?? initialApprovalValues(approval)
    const hasAction = approval.actions.some((action) => action.id === autoAnswer.actionId)
    if (!hasAction || findMissingRequiredFields(approval, values).length > 0) return { blockedTitle: buildRowTitle(approval) }
    answers.push([approval, buildApprovalAnswer(approval, autoAnswer.actionId, values)])
  }
  return { answers: collectAnswersByResumeKey(answers) }
}

/** Sends answers, remembers which questions were answered, and runs "answer all remaining". */
function useReviewAnswering(review: RunReview | null, reload: () => void) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<Error | null>(null)
  const [autoAnswer, setAutoAnswer] = useState<AutoAnswer | null>(null)
  const [autoStopNotice, setAutoStopNotice] = useState<string | null>(null)
  const answeredKeysRef = useRef(new Set<string>())
  const pending = review?.status === 'paused' ? review.pending.filter((approval) => !answeredKeysRef.current.has(approval.resumeKey)) : []

  const submitAnswers = async (answersByResumeKey: Record<string, ApprovalAnswer>) => {
    if (!review) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await answerApprovals(review.runId, answersByResumeKey)
      Object.keys(answersByResumeKey).forEach((resumeKey) => answeredKeysRef.current.add(resumeKey))
    } catch (answerFailure) {
      setSubmitError(toError(answerFailure))
      setAutoAnswer(null)
    } finally {
      setIsSubmitting(false)
      reload()
    }
  }

  useEffect(() => {
    if (!autoAnswer || isSubmitting || pending.length === 0) return
    const autoAnswers = buildAutoAnswers(pending, autoAnswer)
    if ('blockedTitle' in autoAnswers) {
      setAutoAnswer(null)
      setAutoStopNotice(messages().agentRun.autoStopped(autoAnswers.blockedTitle))
      return
    }
    void submitAnswers(autoAnswers.answers)
    // Runs again when a new question arrives (pending changes) or an answer finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnswer, isSubmitting, pending.map((approval) => approval.id).join('\n')])

  const startAutoAnswer = (actionId: string, valuesByApprovalId: Record<string, ApprovalValues>) => {
    setAutoStopNotice(null)
    setAutoAnswer({ actionId, valuesByApprovalId })
  }

  return { pending, isSubmitting, submitError, isAutoAnswering: autoAnswer !== null, autoStopNotice, submitAnswers, startAutoAnswer, stopAutoAnswer: () => setAutoAnswer(null) }
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="box-border flex min-h-[72px] flex-col justify-center gap-0.5 border-b border-line px-6 py-3.5">
      <h1 className="m-0 text-[20px] font-semibold tracking-[-0.3px]">{title}</h1>
      {subtitle && <span className="text-body">{subtitle}</span>}
    </header>
  )
}

/** What the run is doing when nothing waits for an answer right now. */
function RunStateNotice({ review, isAutoAnswering }: { review: RunReview; isAutoAnswering: boolean }) {
  if (review.status === 'running') {
    return <p className="m-0 text-body">{isAutoAnswering ? messages().agentRun.answeringAutomaticallyWaitingForTheNext : messages().agentRun.theRunIsWorkingTheNext}</p>
  }
  if (review.status === 'paused') {
    const kinds = review.otherPauseKinds.join(', ') || 'unknown'
    return <p className="m-0 text-body">{messages().agentRun.thisRunWaitsForSomethingThis}{kinds}).</p>
  }
  const finishedText = { succeeded: messages().agentRun.theRunFinished2, failed: messages().agentRun.theRunDidNotFinish, aborted: messages().agentRun.theRunWasStopped2 }[review.status]
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-body">
        {finishedText} {review.answered.length > 0 && messages().agentRun.youAnsweredCount(review.answered.length)}
      </p>
      <Link to={agentPath('runResult', review.agentId, { runId: review.runId })} className="self-start font-medium">
        {messages().agentRun.seeWhatItDid}
      </Link>
    </div>
  )
}

function NothingToReview() {
  return (
    <>
      <PageHeader title={messages().agentRun.nothingToReview} />
      <div className="flex flex-col gap-2 px-6 py-5">
        <p className="m-0 text-body">{messages().agentRun.noRunIsWaitingForYour}</p>
        <Link to={routePaths.runs} className="self-start font-medium">
          {messages().agentRun.openRuns}
        </Link>
      </div>
    </>
  )
}

/**
 * Screen 19 · Review a run (`/runs/review?runId=`; without `runId`, the latest run waiting for an
 * answer). Lists the `human-input` questions and agent tool calls the run waits on right now, each with its item
 * (when the step runs inside an iteration), its form fields and its actions; the header sends
 * every answer in one resume. graphrt asks about one item at a time in a sequential iteration,
 * so the next question appears after answering; "all remaining" keeps answering each next one
 * the same way while the screen is open.
 */
export function BatchApprovalPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const { data: review, error, isLoading, reload } = useRunReview(runId)
  const answering = useReviewAnswering(review, reload)

  useEffect(() => {
    if (!runId && review) setSearchParams({ runId: review.runId }, { replace: true })
  }, [runId, review, setSearchParams])

  const notices = (
    <>
      {error && <RunErrorNotice title={messages().agentRun.couldNotLoadThisRun} error={error} />}
      {answering.submitError && <RunErrorNotice title={messages().agentRun.couldNotSendTheAnswers} error={answering.submitError} />}
      {answering.autoStopNotice && <p className="m-0 text-[13px] text-amber-strong">{answering.autoStopNotice}</p>}
      {answering.isAutoAnswering && (
        <button type="button" onClick={answering.stopAutoAnswer} className="self-start rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink">
          {messages().agentRun.stopAnsweringAutomatically}
        </button>
      )}
    </>
  )

  return (
    <AppShell mainClassName="flex flex-col">
      {review && answering.pending.length > 0 ? (
        <>
          <RunReviewList
            key={answering.pending.map((approval) => approval.id).join('|')}
            review={review}
            pending={answering.pending}
            isSubmitting={answering.isSubmitting || answering.isAutoAnswering}
            onSubmit={(answers) => void answering.submitAnswers(answers)}
            onAnswerAllRemaining={answering.startAutoAnswer}
          />
          <div className="flex flex-col gap-2 px-6 pb-5">{notices}</div>
        </>
      ) : review ? (
        <>
          <PageHeader title={messages().agentRun.reviewARun} subtitle={describeReviewedRun(review)} />
          <div className="flex flex-col gap-3 px-6 py-5">
            {notices}
            <RunStateNotice review={review} isAutoAnswering={answering.isAutoAnswering} />
          </div>
        </>
      ) : isLoading ? (
        <PageHeader title={messages().agentRun.reviewARun} subtitle={messages().agentRun.loadingTheRun} />
      ) : error ? (
        <>
          <PageHeader title={messages().agentRun.reviewARun} />
          <div className="flex flex-col gap-3 px-6 py-5">{notices}</div>
        </>
      ) : (
        <NothingToReview />
      )}
    </AppShell>
  )
}
