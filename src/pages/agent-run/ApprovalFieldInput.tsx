import { useId } from 'react'
import type { ApprovalField } from '@/api/runReviewTypes'
import { joinClassNames } from '@/components/ui'
import { controlForField } from './approvalForm'

interface ApprovalFieldInputProps {
  field: ApprovalField
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  /** Accessible name when the visible label is hidden (e.g. "Message to place 3"). */
  ariaLabel?: string
  isLabelHidden?: boolean
  /** Extra classes for the text control (the batch review uses a tighter style). */
  controlClassName?: string
  autoFocus?: boolean
}

const textControlClassNames = 'rounded-xl border border-line-strong bg-[#F7FCF9] px-3.5 py-3 text-[14px] leading-[1.55] text-ink outline-brand'

/**
 * One form field of a `human-input` question, with the control its graphrt `type` calls for:
 * textarea (paragraph or long text), number, checkbox or a one-line text input.
 */
export function ApprovalFieldInput({ field, value, onChange, ariaLabel, isLabelHidden = false, controlClassName, autoFocus }: ApprovalFieldInputProps) {
  const inputId = useId()
  const control = controlForField(field)
  const labelText = field.required ? field.label : `${field.label} (optional)`

  if (control === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} aria-label={ariaLabel} className="size-[18px] cursor-pointer accent-ink" />
        {labelText}
      </label>
    )
  }

  const sharedProps = {
    id: inputId,
    value: typeof value === 'string' ? value : '',
    'aria-label': ariaLabel,
    required: field.required,
    autoFocus,
  }
  return (
    <div className="flex flex-col gap-1.5">
      {!isLabelHidden && (
        <label htmlFor={inputId} className="text-[12px] font-medium text-ink-2">
          {labelText}
        </label>
      )}
      {control === 'textarea' ? (
        <textarea {...sharedProps} rows={3} onChange={(event) => onChange(event.target.value)} className={joinClassNames('resize-y', controlClassName ?? textControlClassNames)} />
      ) : (
        <input
          {...sharedProps}
          type={control === 'number' ? 'number' : 'text'}
          onChange={(event) => onChange(event.target.value)}
          className={joinClassNames('h-10 box-border', controlClassName ?? textControlClassNames)}
        />
      )}
    </div>
  )
}
