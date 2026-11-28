import { useId, type ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

interface AbilityChoiceCardProps {
  /** `radio` for one of several choices, `checkbox` for any number (helper agents). */
  type: 'radio' | 'checkbox'
  name: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  title: string
  details: ReactNode
}

/**
 * One choice of an abilities editor: a card around a native radio or checkbox (labelled by
 * its title, described by its details), so arrow keys and screen readers work as usual.
 * The title stays on one line (cut with an ellipsis, full text on hover); details wrap to at
 * most three lines.
 */
export function AbilityChoiceCard({ type, name, checked, disabled = false, onChange, title, details }: AbilityChoiceCardProps) {
  const titleId = useId()
  const detailsId = useId()
  return (
    <label
      className={joinClassNames(
        'box-border flex h-full min-w-0 gap-3 rounded-[12px] bg-surface p-3.5 transition-colors',
        checked ? 'border-2 border-ink p-[13px]' : 'border border-line-strong',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-line-heavy',
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-labelledby={titleId}
        aria-describedby={detailsId}
        className="mt-[2px] size-4 shrink-0 accent-ink"
      />
      <span className="flex min-w-0 flex-auto flex-col gap-1">
        <span id={titleId} title={title} className="truncate text-[14px] font-semibold text-ink">
          {title}
        </span>
        <span id={detailsId} className="line-clamp-3 text-[12.5px] leading-[18px] text-muted">
          {details}
        </span>
      </span>
    </label>
  )
}

/** Choice cards side by side as the panel grows: one column, then two, then three. */
export function abilityChoiceGridClassNames(itemCount: number): string {
  return joinClassNames('m-0 grid min-w-0 grid-cols-1 gap-2.5 border-0 p-0', itemCount >= 2 && '@lg:grid-cols-2', itemCount >= 3 && '@3xl:grid-cols-3')
}
