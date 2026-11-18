import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { scheduleFrequencyOptions, type ScheduleFrequency } from '@/data/scheduleAgent'

/** Shared look for the dialog's text inputs and selects (40px, 10px radius). */
export const scheduleControlClassNames =
  'box-border h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-brand'

/** Small label stacked above a control. */
export function StackedField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}

/** Fieldset with the bold legend used for "When" and "Each run". */
export function ScheduleFieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
      <legend className="mb-2.5 p-0 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  )
}

/** Four radio tiles; the selected one gets a 2px ink border and bold text. */
export function FrequencyRadioTiles({ value, onChange }: { value: ScheduleFrequency; onChange: (frequency: ScheduleFrequency) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {scheduleFrequencyOptions.map((option) => {
        const isSelected = option.value === value
        return (
          <label
            key={option.value}
            className={joinClassNames(
              'box-border flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-surface',
              isSelected ? 'border-2 border-ink font-semibold' : 'border border-line-strong hover:bg-subtle',
            )}
          >
            <input
              type="radio"
              name="schedule-frequency"
              value={option.value}
              checked={isSelected}
              onChange={() => onChange(option.value)}
              className="accent-brand"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
