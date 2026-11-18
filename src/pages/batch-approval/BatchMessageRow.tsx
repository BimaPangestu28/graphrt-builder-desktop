import { joinClassNames } from '@/components/ui'
import { lowScoreThreshold, type BatchMessage } from '@/data/batchApproval'

interface BatchMessageRowProps {
  batchMessage: BatchMessage
  /** Position in the list (1-based), used for the "place N" accessible names. */
  position: number
  isSelected: boolean
  isEditing: boolean
  isLast: boolean
  onToggleSelected: (messageId: string) => void
  onStartEditing: (messageId: string) => void
  onChangeMessage: (messageId: string, message: string) => void
}

const checkboxClassNames = 'mt-0.5 size-[18px] shrink-0 cursor-pointer accent-ink'

/**
 * One drafted WhatsApp message in the review list: a send checkbox, the place,
 * and either a one-line preview or (while editing) a textarea with the full text.
 */
export function BatchMessageRow(props: BatchMessageRowProps) {
  const { batchMessage, position, isSelected, isEditing, isLast } = props
  const isLowScore = batchMessage.score < lowScoreThreshold

  return (
    <li className={joinClassNames('flex gap-3.5 px-4 py-3.5', isEditing && 'bg-subtle', !isLast && 'border-b border-chip')}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => props.onToggleSelected(batchMessage.id)}
        aria-label={`Send to place ${position}`}
        className={checkboxClassNames}
      />
      <div className={joinClassNames('flex min-w-0 flex-auto flex-col', isEditing ? 'gap-2' : 'gap-1')}>
        <span className="flex flex-wrap items-center gap-2">
          <b className={joinClassNames('font-semibold', !isSelected && 'text-body')}>{batchMessage.placeName}</b>
          {isLowScore ? (
            <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[12px] font-medium text-amber-strong">
              Low score {batchMessage.score}
              {!isSelected && ' · unselected for you'}
            </span>
          ) : (
            <span className="text-[12px] text-muted">
              {batchMessage.placeKind} · score {batchMessage.score}
            </span>
          )}
          {isEditing && <span className="text-[12px] font-medium text-brand-strong">Editing</span>}
        </span>
        {isEditing ? (
          <textarea
            aria-label={`Message to place ${position}`}
            rows={2}
            lang="id"
            autoFocus
            value={batchMessage.message}
            onChange={(event) => props.onChangeMessage(batchMessage.id, event.target.value)}
            className="resize-y rounded-[10px] border border-ink bg-surface px-3 py-2.5 text-[14px] leading-normal text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            lang="id"
            onClick={() => props.onStartEditing(batchMessage.id)}
            aria-label={`Edit message to place ${position}`}
            className={joinClassNames(
              'cursor-text truncate border-0 bg-transparent p-0 text-left text-[14px] leading-normal hover:underline',
              isSelected ? 'text-ink-2' : 'text-muted',
            )}
          >
            {batchMessage.message}
          </button>
        )}
      </div>
    </li>
  )
}
