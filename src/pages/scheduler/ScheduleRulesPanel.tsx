import { useState } from 'react'
import { isDesktopApp } from '@/api/client'
import { concurrencyOptions, ifMacAsleepOptions } from '@/lib/scheduleCalendar'
import { missedRunPolicyByOption, toMissedRunPolicy } from '@/lib/schedule'
import { useScheduleRules } from './useScheduleRules'
import { messages } from '@/i18n'

const fieldLabelClassNames = 'text-[12px] font-medium text-ink-2'
const fieldControlClassNames = 'box-border h-10 rounded-[10px] border border-line-strong bg-surface text-[14px] text-ink'

function findMissedRunOption(policy: string): string {
  return ifMacAsleepOptions.find((option) => missedRunPolicyByOption[option] === policy) ?? ifMacAsleepOptions[0]
}

/** The design's choices, plus the stored limit when it is not one of them (set elsewhere). */
function listConcurrencyChoices(maxConcurrentRuns: number) {
  const isKnown = concurrencyOptions.some((option) => option.maxConcurrentRuns === maxConcurrentRuns)
  return isKnown ? concurrencyOptions : [...concurrencyOptions, { label: messages().schedule.upTo(maxConcurrentRuns), maxConcurrentRuns }]
}

/**
 * Quiet hours are part of the design but nothing enforces them yet, so only the browser
 * preview shows the field; the desktop app does not offer a rule it would not keep.
 */
function QuietHoursPreviewField() {
  const [quietHours, setQuietHours] = useState('21:00 to 07:00')
  return (
    <label className="flex flex-col gap-1.5">
      <span className={fieldLabelClassNames}>{messages().schedule.quietHoursNothingSendsToOther}</span>
      <input type="text" value={quietHours} onChange={(event) => setQuietHours(event.target.value)} className={`${fieldControlClassNames} px-3`} />
    </label>
  )
}

/**
 * Rules that apply to every schedule. Each one is stored and enforced: the missed-run default
 * and keep-awake are app settings, the concurrency limit is a scheduler rule.
 */
export function ScheduleRulesPanel() {
  const { values, error, saveRule } = useScheduleRules()
  const maxConcurrentRuns = values?.maxConcurrentRuns ?? concurrencyOptions[0].maxConcurrentRuns

  return (
    <section aria-labelledby="scheduler-rules-heading" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-[18px]">
      <h2 id="scheduler-rules-heading" className="m-0 text-[16px] font-semibold">
        {messages().schedule.rulesForEverySchedule}
      </h2>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>{messages().schedule.ifTheComputerWasAsleep}</span>
        <select
          value={findMissedRunOption(values?.missedRunDefaultPolicy ?? 'run_once')}
          disabled={!values}
          aria-describedby="missed-run-rule-hint"
          onChange={(event) => void saveRule('missedRunDefaultPolicy', toMissedRunPolicy(event.target.value))}
          className={`${fieldControlClassNames} px-2.5`}
        >
          {ifMacAsleepOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <span id="missed-run-rule-hint" className="-mt-2 text-[12px] text-muted">
        {messages().schedule.newSchedulesStartWithThisEach}
      </span>
      {!isDesktopApp() && <QuietHoursPreviewField />}
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>{messages().schedule.agentsRunningAtTheSameTime}</span>
        <select
          value={String(maxConcurrentRuns)}
          disabled={!values}
          aria-describedby="concurrency-rule-hint"
          onChange={(event) => void saveRule('maxConcurrentRuns', Number(event.target.value))}
          className={`${fieldControlClassNames} px-2.5`}
        >
          {listConcurrencyChoices(maxConcurrentRuns).map((option) => (
            <option key={option.maxConcurrentRuns} value={String(option.maxConcurrentRuns)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span id="concurrency-rule-hint" className="-mt-2 text-[12px] text-muted">
        {messages().schedule.aScheduleThatComesDueBeyond}
      </span>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={values?.keepAwakeWhileRunning ?? true}
          disabled={!values}
          onChange={(event) => void saveRule('keepAwakeWhileRunning', event.target.checked)}
          className="size-[18px] accent-brand"
        />
        {messages().schedule.keepTheComputerAwakeWhileAn}
      </label>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {messages().schedule.couldNotSaveTheRule}{' '}{error.message}
        </p>
      )}
    </section>
  )
}
