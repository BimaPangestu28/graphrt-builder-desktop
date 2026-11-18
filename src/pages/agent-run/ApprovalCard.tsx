import { useId, useState } from 'react'
import type { ApprovalAnswer, PendingApproval } from '@/api/runReviewTypes'
import { ApprovalFieldInput } from './ApprovalFieldInput'
import { buildApprovalAnswer, findMissingRequiredFields, initialApprovalValues, splitApprovalPrompt, type ApprovalValues } from './approvalForm'

interface ApprovalCardProps {
  approval: PendingApproval
  onAnswer: (answer: ApprovalAnswer) => void
  /** True while the answer is being sent; every button is disabled. */
  isSubmitting?: boolean
}

const primaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButtonClassNames =
  'h-10 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The amber card shown when a run pauses on a graphrt `human-input` step. It shows exactly
 * what the pause carries: the rendered prompt (first line as the title), the form fields with
 * their defaults (editable) and one button per action, the first one primary. Every action is
 * disabled while a required field is empty, as graphrt would reject the answer.
 */
export function ApprovalCard({ approval, onAnswer, isSubmitting = false }: ApprovalCardProps) {
  const titleId = useId()
  const [values, setValues] = useState<ApprovalValues>(() => initialApprovalValues(approval))
  const { heading, description } = splitApprovalPrompt(approval)
  const missingFields = findMissingRequiredFields(approval, values)
  const isAnswerBlocked = missingFields.length > 0 || isSubmitting

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3.5 rounded-2xl border-2 border-amber-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="m-0 text-[18px] font-semibold">
          {heading}
        </h2>
        {description && <span className="whitespace-pre-line text-[13px] text-body">{description}</span>}
      </div>
      {approval.fields.map((field) => (
        <ApprovalFieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(fieldValue) => setValues((currentValues) => ({ ...currentValues, [field.name]: fieldValue }))}
        />
      ))}
      {missingFields.length > 0 && <p className="m-0 text-[12px] text-amber-strong">Fill in {missingFields.join(', ')} to answer</p>}
      <div className="flex flex-wrap items-center gap-2">
        {approval.actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onAnswer(buildApprovalAnswer(approval, action.id, values))}
            disabled={isAnswerBlocked}
            className={index === 0 ? primaryButtonClassNames : secondaryButtonClassNames}
          >
            {action.title}
          </button>
        ))}
        {approval.actions.length === 0 && <span className="text-[13px] text-body">This step offers no answer to choose</span>}
        <span className="ml-auto text-[12px] text-muted">Paused safely. You can close the app and come back</span>
      </div>
    </section>
  )
}
