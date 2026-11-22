import { useId, type ReactNode } from 'react'
import type { WelcomeChoice } from '@/api/types'
import { joinClassNames } from '@/components/ui'

interface WelcomeChoiceCardProps {
  value: WelcomeChoice
  selectedChoice: WelcomeChoice | null
  onSelect: (choice: WelcomeChoice) => void
  title: string
  /** Badges next to the title, e.g. Experimental. */
  badges?: ReactNode
  /** Detection and explanation lines under the title. */
  details: ReactNode
  /** Shown only while the card is selected (the API key fields). */
  expandedContent?: ReactNode
  /** A choice that cannot work yet (e.g. a CLI that is not installed); its links stay usable. */
  isUnavailable?: boolean
  /** A quieter dashed look set a little apart, for Skip. */
  isQuiet?: boolean
}

/**
 * One option of the Welcome "How should graphrt think?" radio group: a card with a native
 * radio (named by the title, described by the details) so arrow keys and screen readers
 * work as usual. Clicking anywhere on the card picks it.
 */
export function WelcomeChoiceCard({ value, selectedChoice, onSelect, title, badges, details, expandedContent, isUnavailable = false, isQuiet = false }: WelcomeChoiceCardProps) {
  const titleId = useId()
  const detailsId = useId()
  const isSelected = selectedChoice === value
  return (
    <div
      onClick={() => !isUnavailable && onSelect(value)}
      className={joinClassNames(
        'flex gap-3.5 rounded-[14px] p-4 transition-colors',
        isSelected ? 'border-2 border-ink bg-surface p-[15px]' : 'border border-line-strong bg-surface',
        isQuiet && !isSelected && 'border-dashed bg-subtle',
        isQuiet && 'mt-3',
        isUnavailable ? 'cursor-default' : 'cursor-pointer hover:border-line-heavy',
      )}
    >
      <input
        type="radio"
        name="welcome-choice"
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
          <span id={titleId} className={joinClassNames('font-semibold', isUnavailable && 'text-muted')}>
            {title}
          </span>
          {badges}
        </span>
        <span id={detailsId} className="flex flex-col gap-1 text-[13px] leading-normal text-body">
          {details}
        </span>
        {isSelected && expandedContent}
      </span>
    </div>
  )
}
