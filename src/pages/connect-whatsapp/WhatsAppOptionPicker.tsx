import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'
import { listChannelOptions, type ChannelOptionId } from './channelOptions'

/** Kept for older imports: the ids of the connect step's options. */
export type WhatsAppConnectionOption = ChannelOptionId

interface ChannelOptionPickerProps {
  selectedOption: ChannelOptionId | null
  onSelect: (option: ChannelOptionId) => void
}

/** The customer channels of screen 05 as a radio group of wide cards, three to a row. */
export function WhatsAppOptionPicker({ selectedOption, onSelect }: ChannelOptionPickerProps) {
  return (
    <fieldset className="m-0 grid grid-cols-1 gap-2.5 border-0 p-0 sm:grid-cols-3">
      <legend className="mb-2 p-0 text-[13px] font-medium text-muted">{messages().channels.whereDoCustomersWrite}</legend>
      {listChannelOptions().map((option) => {
        const isSelected = option.id === selectedOption
        return (
          <label
            key={option.id}
            className={joinClassNames(
              'flex min-w-0 cursor-pointer gap-2.5 rounded-xl p-3.5',
              isSelected ? 'border-2 border-ink' : 'border border-line-strong hover:bg-subtle',
            )}
          >
            <input
              type="radio"
              name="channel-option"
              value={option.id}
              checked={isSelected}
              onChange={() => onSelect(option.id)}
              className="mt-0.5 size-4 shrink-0 accent-ink"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold">{option.title}</span>
              <span className="text-[13px] text-body">{option.description}</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
