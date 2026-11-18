import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

const rowClassNames = 'flex items-center justify-between gap-4 py-3.5'
const rowDividerClassNames = 'border-b border-chip'

/** Select box shared by every settings row (36px, 9px radius, light border). */
export const settingsSelectClassNames =
  'h-9 rounded-[9px] border border-line-strong bg-surface px-2.5 font-sans text-[14px] font-normal text-ink'

/** Small white bordered button used inside settings rows (Show in Finder, Export…). */
export const settingsButtonClassNames =
  'cursor-pointer rounded-[9px] border border-line-strong bg-surface px-3.5 font-sans text-[13px] font-medium text-ink hover:bg-subtle'

function RowText({ title, description, isMonospace }: { title: string; description?: string; isMonospace?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{title}</span>
      {description && (
        <span className={joinClassNames('text-[13px] text-body', isMonospace && 'font-mono')}>{description}</span>
      )}
    </span>
  )
}

interface ToggleRowProps {
  title: string
  description?: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => void
  hasDivider?: boolean
}

/** A label row with a checkbox on the right; the whole row toggles it. */
export function ToggleRow({ title, description, isChecked, onToggle, hasDivider = true }: ToggleRowProps) {
  return (
    <label className={joinClassNames(rowClassNames, hasDivider && rowDividerClassNames, 'cursor-pointer')}>
      <RowText title={title} description={description} />
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-[18px] shrink-0 accent-ink"
      />
    </label>
  )
}

interface SelectRowProps<OptionValue extends string> {
  title: string
  description?: string
  value: OptionValue
  options: readonly OptionValue[]
  onSelect: (value: OptionValue) => void
  hasDivider?: boolean
}

/** A label row with a native select on the right. */
export function SelectRow<OptionValue extends string>({
  title,
  description,
  value,
  options,
  onSelect,
  hasDivider = true,
}: SelectRowProps<OptionValue>) {
  return (
    <label className={joinClassNames(rowClassNames, hasDivider && rowDividerClassNames)}>
      <RowText title={title} description={description} />
      <select
        value={value}
        onChange={(event) => onSelect(options.find((option) => option === event.target.value) ?? value)}
        className={settingsSelectClassNames}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

interface ActionRowProps {
  title: string
  description?: string
  isMonospace?: boolean
  action: ReactNode
  hasDivider?: boolean
}

/** A row with text on the left and a free-form action (usually a button) on the right. */
export function ActionRow({ title, description, isMonospace, action, hasDivider = true }: ActionRowProps) {
  return (
    <div className={joinClassNames(rowClassNames, hasDivider && rowDividerClassNames)}>
      <RowText title={title} description={description} isMonospace={isMonospace} />
      {action}
    </div>
  )
}

/** A titled settings group, labelled by its h2. */
export function SettingsGroup({ headingId, title, children }: { headingId: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="m-0 mb-2 text-[16px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}
