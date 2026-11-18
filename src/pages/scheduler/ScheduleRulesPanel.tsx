import { useState } from 'react'
import { concurrencyOptions, ifMacAsleepOptions } from '@/data/scheduler'

const fieldLabelClassNames = 'text-[12px] font-medium text-ink-2'
const fieldControlClassNames = 'box-border h-10 rounded-[10px] border border-line-strong bg-surface text-[14px] text-ink'

/** Global rules that apply to every schedule: missed runs, quiet hours, concurrency, keeping the Mac awake. */
export function ScheduleRulesPanel() {
  const [ifMacAsleep, setIfMacAsleep] = useState(ifMacAsleepOptions[0])
  const [quietHours, setQuietHours] = useState('21:00 to 07:00')
  const [concurrency, setConcurrency] = useState(concurrencyOptions[0])
  const [keepMacAwake, setKeepMacAwake] = useState(true)

  return (
    <section aria-labelledby="scheduler-rules-heading" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-[18px]">
      <h2 id="scheduler-rules-heading" className="m-0 text-[16px] font-semibold">
        Rules for every schedule
      </h2>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>If the Mac was asleep</span>
        <select value={ifMacAsleep} onChange={(event) => setIfMacAsleep(event.target.value)} className={`${fieldControlClassNames} px-2.5`}>
          {ifMacAsleepOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>Quiet hours, nothing sends to other people</span>
        <input type="text" value={quietHours} onChange={(event) => setQuietHours(event.target.value)} className={`${fieldControlClassNames} px-3`} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClassNames}>Agents running at the same time</span>
        <select value={concurrency} onChange={(event) => setConcurrency(event.target.value)} className={`${fieldControlClassNames} px-2.5`}>
          {concurrencyOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input type="checkbox" checked={keepMacAwake} onChange={(event) => setKeepMacAwake(event.target.checked)} className="size-[18px] accent-brand" />
        Keep the Mac awake while an agent runs
      </label>
    </section>
  )
}
