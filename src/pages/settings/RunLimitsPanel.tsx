import { useState, type KeyboardEvent } from 'react'
import type { RunLimits } from '@/api/appSettingsTypes'
import { joinClassNames } from '@/components/ui'
import { defaultRunLimits, runLimitFields, type RunLimitField } from '@/lib/runLimits'
import { SettingsGroup, settingsButtonClassNames } from './SettingRows'

interface RunLimitsPanelProps {
  runLimits: RunLimits
  /** Saves the changed limits (the page reports a failed save). */
  onSave: (runLimits: RunLimits) => void
}

type DraftValues = Record<keyof RunLimits, string>

function toDraftValues(runLimits: RunLimits): DraftValues {
  return Object.fromEntries(runLimitFields.map((field) => [field.key, String(runLimits[field.key])])) as DraftValues
}

/** The draft's number when it is a whole number in range, else null. */
function readDraftValue(field: RunLimitField, draftText: string): number | null {
  const trimmed = draftText.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const limitValue = Number(trimmed)
  return limitValue >= field.min && limitValue <= field.max ? limitValue : null
}

function describeRange(field: RunLimitField): string {
  return `${field.min.toLocaleString('en-US')} to ${field.max.toLocaleString('en-US')}`
}

interface RunLimitRowProps {
  field: RunLimitField
  draftText: string
  savedValue: number
  onChangeDraft: (draftText: string) => void
  onCommit: () => void
}

function RunLimitRow({ field, draftText, savedValue, onChangeDraft, onCommit }: RunLimitRowProps) {
  const isInvalid = readDraftValue(field, draftText) === null
  const inputId = `run-limit-${field.key}`
  const isDefault = savedValue === defaultRunLimits[field.key]
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onCommit()
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-chip py-3.5">
      <label htmlFor={inputId} className="flex flex-col gap-0.5">
        <span className="font-medium">{field.title}</span>
        <span className="text-[13px] text-body">
          {field.description}
          {isDefault ? ' · default' : ` · default ${defaultRunLimits[field.key].toLocaleString('en-US')}`}
        </span>
        {isInvalid && (
          <span role="alert" className="text-[12px] text-danger">
            Use a whole number from {describeRange(field)}
          </span>
        )}
      </label>
      <span className="flex shrink-0 items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={1}
          value={draftText}
          aria-invalid={isInvalid}
          onChange={(event) => onChangeDraft(event.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          className={joinClassNames(
            'h-9 w-28 rounded-[9px] border bg-surface px-2.5 text-right font-sans text-[14px] text-ink',
            isInvalid ? 'border-danger' : 'border-line-strong',
          )}
        />
        <span className="w-16 text-[13px] text-body">{field.unit}</span>
      </span>
    </div>
  )
}

/**
 * Settings › Runner › Run limits: the time and work limits every run gets, each editable within
 * its safe range (a value outside it is not saved), with Reset to defaults. A change is saved
 * when the field loses focus or on Enter, and applies to runs started or resumed afterwards.
 */
export function RunLimitsPanel({ runLimits, onSave }: RunLimitsPanelProps) {
  const [draftValues, setDraftValues] = useState<DraftValues>(() => toDraftValues(runLimits))
  const isAtDefaults = runLimitFields.every((field) => runLimits[field.key] === defaultRunLimits[field.key])

  const commitField = (field: RunLimitField) => {
    const limitValue = readDraftValue(field, draftValues[field.key])
    if (limitValue === null || limitValue === runLimits[field.key]) return
    onSave({ ...runLimits, [field.key]: limitValue })
  }

  const resetToDefaults = () => {
    setDraftValues(toDraftValues(defaultRunLimits))
    onSave({ ...defaultRunLimits })
  }

  return (
    <SettingsGroup headingId="settings-run-limits-heading" title="Run limits">
      <p className="m-0 text-[13px] text-body">
        Every run gets these limits, so a stuck step or a loop that never ends stops on its own. A step or run that goes past one stops with an error. Changes
        apply to runs started or continued afterwards.
      </p>
      {runLimitFields.map((field) => (
        <RunLimitRow
          key={field.key}
          field={field}
          draftText={draftValues[field.key]}
          savedValue={runLimits[field.key]}
          onChangeDraft={(draftText) => setDraftValues((current) => ({ ...current, [field.key]: draftText }))}
          onCommit={() => commitField(field)}
        />
      ))}
      <div className="flex items-center justify-between gap-4 py-3.5">
        <span className="text-[13px] text-body">A step's own “Time limit for each try” still wins over the time for one step</span>
        <button type="button" disabled={isAtDefaults} onClick={resetToDefaults} className={joinClassNames(settingsButtonClassNames, 'h-[34px] shrink-0 disabled:cursor-not-allowed disabled:opacity-50')}>
          Reset to defaults
        </button>
      </div>
    </SettingsGroup>
  )
}
