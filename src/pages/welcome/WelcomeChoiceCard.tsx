import { useId, type ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

interface WelcomeChoiceCardProps<Value extends string> {
  /** Name of the radio group the card belongs to. */
  groupName: string
  value: Value
  selectedValue: Value | null
  onSelect: (value: Value) => void
  title: string
  /** Badges next to the title, e.g. Recommended. */
  badges?: ReactNode
  /** Explanation and detection lines under the title. */
  details: ReactNode
  /** A choice that cannot work yet (e.g. nothing found on this computer); its links stay usable. */
  isUnavailable?: boolean
  /** A quieter dashed look, for "Decide later". */
  isQuiet?: boolean
  /** Takes a whole row of the three-column grid on wide windows (for "Decide later"). */
  isFullRow?: boolean
}

/**
 * The responsive grid the choice cards sit in: one column on narrow windows, two on
 * medium ones, three when they fit. Cards in a row share the tallest card's height.
 */
export const choiceGridClassNames = 'm-0 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2 lg:grid-cols-3'

/**
 * One option of a Welcome wizard radio group: a card with a native radio (named by the
 * title, described by the details) so arrow keys and screen readers work as usual.
 * Clicking anywhere on the card picks it.
 */
export function WelcomeChoiceCard<Value extends string>({
  groupName,
  value,
  selectedValue,
  onSelect,
  title,
  badges,
  details,
  isUnavailable = false,
  isQuiet = false,
  isFullRow = false,
}: WelcomeChoiceCardProps<Value>) {
  const titleId = useId()
  const detailsId = useId()
  const isSelected = selectedValue === value
  return (
    <div
      onClick={() => !isUnavailable && onSelect(value)}
      className={joinClassNames(
        'box-border flex h-full gap-3.5 rounded-[14px] p-4 transition-colors',
        isFullRow && 'lg:col-span-full',
        isSelected ? 'border-2 border-ink bg-surface p-[15px]' : 'border border-line-strong bg-surface',
        isQuiet && !isSelected && 'border-dashed bg-subtle',
        isUnavailable ? 'cursor-default' : 'cursor-pointer hover:border-line-heavy',
      )}
    >
      <input
        type="radio"
        name={groupName}
        value={value}
        checked={isSelected}
        disabled={isUnavailable}
        onChange={() => onSelect(value)}
        aria-labelledby={titleId}
        aria-describedby={detailsId}
        className="mt-[3px] size-[18px] shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
      />
      <span className="flex min-w-0 flex-auto flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span id={titleId} className={joinClassNames('text-[15px] font-semibold', isUnavailable && 'text-muted')}>
            {title}
          </span>
          {badges}
        </span>
        <span id={detailsId} className="flex flex-col gap-1 text-[13px] leading-normal text-body">
          {details}
        </span>
      </span>
    </div>
  )
}
