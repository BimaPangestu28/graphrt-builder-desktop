import { useState } from 'react'
import type { ApprovalAnswer, PendingApproval, RunReview } from '@/api/runReviewTypes'
import { buildApprovalAnswer, findMissingRequiredFields, initialApprovalValues, type ApprovalValues } from '@/pages/agent-run/approvalForm'
import { PendingApprovalRow } from './PendingApprovalRow'
import { RunReviewSidePanel } from './RunReviewSidePanel'
import { buildRowTitle, describeReviewedRun, findSharedActionPair, hasItemsAfterThese } from './runReviewModel'

/** How many questions show before "Show N more". */
export const initiallyVisibleCount = 4

const secondaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50'

interface RunReviewListProps {
  review: RunReview
  /** Questions still to answer (the review's pending ones not answered in this session). */
  pending: PendingApproval[]
  isSubmitting: boolean
  onSubmit: (answersByResumeKey: Record<string, ApprovalAnswer>) => void
  /** Answers these with `actionId`, then keeps answering each next item the same way. */
  onAnswerAllRemaining: (actionId: string, valuesByResumeKey: Record<string, ApprovalValues>) => void
}

/** Answers, values and editing state of the questions on screen, keyed by resume key. */
function useReviewAnswers(pending: PendingApproval[]) {
  const [valuesByKey, setValuesByKey] = useState<Record<string, ApprovalValues>>({})
  const [chosenActionByKey, setChosenActionByKey] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(pending[0]?.resumeKey ?? null)

  const valuesFor = (approval: PendingApproval) => valuesByKey[approval.resumeKey] ?? initialApprovalValues(approval)
  const chosenActionFor = (approval: PendingApproval) => chosenActionByKey[approval.resumeKey] ?? approval.actions[0]?.id ?? ''
  const changeValue = (approval: PendingApproval, fieldName: string, fieldValue: string | boolean) =>
    setValuesByKey((current) => ({ ...current, [approval.resumeKey]: { ...valuesFor(approval), [fieldName]: fieldValue } }))
  const chooseAction = (approval: PendingApproval, actionId: string) => setChosenActionByKey((current) => ({ ...current, [approval.resumeKey]: actionId }))
  const chooseForAll = (actionId: string) => setChosenActionByKey(Object.fromEntries(pending.map((approval) => [approval.resumeKey, actionId])))

  return { valuesFor, chosenActionFor, changeValue, chooseAction, chooseForAll, editingKey, setEditingKey }
}

/**
 * The questions a paused run waits on, as a list (screen 19). Each row picks its answer; the
 * header sends every answer at once (one resume). With a shared yes/no pair the rows are
 * checkboxes and "{no} all" answers everything with the second action.
 */
export function RunReviewList({ review, pending, isSubmitting, onSubmit, onAnswerAllRemaining }: RunReviewListProps) {
  const answers = useReviewAnswers(pending)
  const [isShowingAll, setIsShowingAll] = useState(false)
  const actionPair = findSharedActionPair(pending)
  const visiblePending = isShowingAll ? pending : pending.slice(0, initiallyVisibleCount)
  const hiddenCount = pending.length - visiblePending.length
  const selectedCount = actionPair ? pending.filter((approval) => answers.chosenActionFor(approval) === actionPair[0].id).length : pending.length
  const blockedTitles = pending.filter((approval) => findMissingRequiredFields(approval, answers.valuesFor(approval)).length > 0).map(buildRowTitle)
  const canAnswerAllRemaining = actionPair !== null && hasItemsAfterThese(pending)

  const buildAnswers = (actionFor: (approval: PendingApproval) => string) =>
    Object.fromEntries(pending.map((approval) => [approval.resumeKey, buildApprovalAnswer(approval, actionFor(approval), answers.valuesFor(approval))]))
  const valuesByKey = () => Object.fromEntries(pending.map((approval) => [approval.resumeKey, answers.valuesFor(approval)]))
  const isBlocked = isSubmitting || blockedTitles.length > 0

  return (
    <>
      <header className="box-border flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.3px]">Review {pending.length === 1 ? '1 item' : `${pending.length} items`}</h1>
          <span className="text-body">{describeReviewedRun(review)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {actionPair && (
            <button type="button" className={secondaryButtonClassNames} disabled={isBlocked} onClick={() => onSubmit(buildAnswers(() => actionPair[1].id))}>
              {actionPair[1].title} all
            </button>
          )}
          <button
            type="button"
            className={primaryButtonClassNames}
            disabled={isBlocked || (actionPair !== null && selectedCount === 0)}
            onClick={() => onSubmit(buildAnswers(answers.chosenActionFor))}
          >
            {actionPair ? `${actionPair[0].title} ${selectedCount} selected` : `Answer ${pending.length}`}
          </button>
        </div>
      </header>

      <div className="flex flex-auto flex-wrap">
      <section aria-label="Questions" className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-3 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {actionPair ? (
            <label className="flex cursor-pointer items-center gap-2.5 font-medium">
              <input
                type="checkbox"
                checked={selectedCount > 0}
                onChange={() => answers.chooseForAll(selectedCount === pending.length ? actionPair[1].id : actionPair[0].id)}
                className="size-[18px] cursor-pointer accent-ink"
              />
              {selectedCount} of {pending.length} selected
            </label>
          ) : (
            <span className="font-medium">{pending.length} waiting</span>
          )}
          {actionPair && <span className="text-[13px] text-muted">Unticked ones get “{actionPair[1].title}”</span>}
        </div>
        {blockedTitles.length > 0 && <p className="m-0 text-[13px] text-amber-strong">Fill in the required fields of {blockedTitles.join(', ')} first</p>}
        <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-line p-0">
          {visiblePending.map((approval, index) => (
            <PendingApprovalRow
              key={approval.resumeKey}
              approval={approval}
              values={answers.valuesFor(approval)}
              chosenActionId={answers.chosenActionFor(approval)}
              actionPair={actionPair ? [actionPair[0].id, actionPair[1].id] : null}
              isEditing={answers.editingKey === approval.resumeKey}
              isLast={hiddenCount === 0 && index === visiblePending.length - 1}
              onChooseAction={(actionId) => answers.chooseAction(approval, actionId)}
              onStartEditing={() => answers.setEditingKey(approval.resumeKey)}
              onChangeValue={(fieldName, fieldValue) => answers.changeValue(approval, fieldName, fieldValue)}
            />
          ))}
          {hiddenCount > 0 && (
            <li className="flex gap-3.5 px-4 py-3.5 text-muted">
              <span className="w-[18px]" />
              <button
                type="button"
                onClick={() => setIsShowingAll(true)}
                className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
              >
                Show {hiddenCount} more
              </button>
            </li>
          )}
        </ul>
        {canAnswerAllRemaining && actionPair && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-4 py-3">
            <button type="button" className={`${secondaryButtonClassNames} self-start`} disabled={isBlocked} onClick={() => onAnswerAllRemaining(actionPair[0].id, valuesByKey())}>
              {actionPair[0].title} all remaining
            </button>
            <span className="text-[13px] text-body">
              graphrt asks about the next items only after these are answered. This answers these and every next one with “{actionPair[0].title}”, each with its
              own drafted values, while this screen stays open. It stops at any item that needs a field filled in.
            </span>
          </div>
        )}
      </section>
      <RunReviewSidePanel review={review} />
      </div>
    </>
  )
}
