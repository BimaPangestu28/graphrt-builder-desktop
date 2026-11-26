import type { RunReview } from '@/api/runReviewTypes'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { describeIterationProgress, summarizeAnswers } from './runReviewModel'
import { messages } from '@/i18n'

function FactRow({ label, value, hasDivider }: { label: string; value: string; hasDivider: boolean }) {
  return (
    <div className={`flex justify-between gap-2 py-2.5 ${hasDivider ? 'border-b border-chip' : ''}`}>
      <dt className="text-body">{label}</dt>
      <dd className="m-0 text-right font-medium">{value}</dd>
    </div>
  )
}

/**
 * Right-hand panel of the run review: facts the run itself reports (agent, start, the step it
 * waits at, iteration progress from graphrt's snapshot, answers so far) and what pausing means.
 */
export function RunReviewSidePanel({ review }: { review: RunReview }) {
  const actionTitles = new Map(review.pending.flatMap((approval) => approval.actions.map((action) => [action.id, action.title] as const)))
  const facts = [
    { label: messages().agentRun.agent, value: review.agentName },
    { label: messages().agentRun.started, value: formatRunDay(review.startedAt) },
    { label: messages().agentRun.waitingAt, value: review.pending[0]?.stepTitle ?? null },
    { label: messages().agentRun.progress, value: describeIterationProgress(review.pending) },
    { label: messages().agentRun.answeredSoFar, value: summarizeAnswers(review, actionTitles) },
  ].filter((fact): fact is { label: string; value: string } => fact.value !== null)

  return (
    <aside className="box-border flex min-w-0 flex-[1_1_300px] flex-col gap-5 border-l border-line bg-subtle p-6">
      <section aria-labelledby="run-facts-h" className="flex flex-col gap-2.5">
        <h2 id="run-facts-h" className="m-0 text-[15px] font-semibold">
          {messages().agentRun.thisRun}
        </h2>
        <dl className="m-0 rounded-xl border border-line bg-surface px-3.5 py-1">
          {facts.map((fact, index) => (
            <FactRow key={fact.label} label={fact.label} value={fact.value} hasDivider={index < facts.length - 1} />
          ))}
        </dl>
      </section>
      <p className="m-0 text-[13px] leading-normal text-body">{messages().agentRun.pausedSafelyYouCanCloseThe2}</p>
    </aside>
  )
}
