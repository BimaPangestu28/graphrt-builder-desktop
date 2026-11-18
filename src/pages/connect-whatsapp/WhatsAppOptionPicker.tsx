import { joinClassNames } from '@/components/ui'

export type WhatsAppConnectionOption = 'business' | 'personal'

const connectionOptions: Array<{ value: WhatsAppConnectionOption; title: string; description: string }> = [
  {
    value: 'business',
    title: 'WhatsApp Business (official API)',
    description: 'Meta’s Cloud API with an access token. Made for business messaging',
  },
  {
    value: 'personal',
    title: 'Personal WhatsApp (QR)',
    description: 'Links your own number like WhatsApp Web. Low volume only',
  },
]

interface WhatsAppOptionPickerProps {
  selectedOption: WhatsAppConnectionOption | null
  onSelect: (option: WhatsAppConnectionOption) => void
}

/** The two ways to connect WhatsApp on screen 05, as a radio group. */
export function WhatsAppOptionPicker({ selectedOption, onSelect }: WhatsAppOptionPickerProps) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-2.5 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-medium text-muted">How do you want to connect?</legend>
      {connectionOptions.map((option) => {
        const isSelected = option.value === selectedOption
        return (
          <label
            key={option.value}
            className={joinClassNames(
              'flex flex-[1_1_240px] cursor-pointer gap-2.5 rounded-xl p-3.5',
              isSelected ? 'border-2 border-ink' : 'border border-line-strong hover:bg-subtle',
            )}
          >
            <input
              type="radio"
              name="whatsapp-connection-option"
              value={option.value}
              checked={isSelected}
              onChange={() => onSelect(option.value)}
              className="mt-0.5 size-4 accent-ink"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{option.title}</span>
              <span className="text-[13px] text-body">{option.description}</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
